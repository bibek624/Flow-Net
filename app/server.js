import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { all, get, update, insert, logEvent, resetAll } from './lib/db.js';
import { bus, ingest, newId, confidenceOf, incidentReports, refreshSummaryAndZone } from './lib/pipeline.js';
import { pointInPolygon, distanceM } from './lib/geo.js';
import { reverseGeocode } from './lib/external.js';
import { aiEnabled } from './lib/triage.js';
import { POP_DENSITY_PER_KM2 } from './lib/zone.js';
import { loadBaseline, startReplay, stopReplay, replayRunning } from './scripts/scenario.js';

const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'Beacon';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '1mb' }));
// HTML, JS, and CSS always revalidate so a fix reaches every phone on the next load.
app.use(express.static(path.resolve('public'), {
  extensions: ['html'],
  setHeaders: (res, file) => {
    if (/\.(html|js|css|webmanifest)$/.test(file)) res.set('Cache-Control', 'no-cache');
  },
}));
app.use('/vendor/leaflet', express.static(path.resolve('node_modules/leaflet/dist'), { maxAge: '7d' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
};
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${newId(file.fieldname)}.${EXT[file.mimetype.split(';')[0]] || 'bin'}`),
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image|video|audio)\//.test(file.mimetype)),
});

const publicPath = (p) => (p ? `/uploads/${path.basename(p)}` : null);
const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const list = (v) => {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return String(v).split(',').map((s) => s.trim()).filter(Boolean); }
};

function serializeReport(r) {
  return {
    id: r.id, created_at: r.created_at, kind: r.kind, text: r.text, transcript: r.transcript,
    chips: r.chips, flags: r.flags, lat: r.lat, lng: r.lng, accuracy_m: r.accuracy_m, address: r.address,
    media_url: publicPath(r.media_path), media_type: r.media_type, thumb_url: publicPath(r.thumb_path),
    media_duration_s: r.media_duration_s, category: r.category, severity: r.severity, title: r.title,
    ai_summary: r.ai_summary, triage_source: r.triage_source, status: r.status, incident_id: r.incident_id,
    reviewed: !!r.reviewed, urgent: !!r.urgent, help_status: r.help_status,
    contact_name: r.contact_name, contact_info: r.contact_info,
  };
}

function serializeIncident(inc, { withReports = false } = {}) {
  const reports = incidentReports(inc.id);
  const count = (k) => reports.filter((r) => r.kind === k).length;
  const urgent = reports.filter((r) => r.urgent && r.help_status !== 'resolved');
  const out = {
    ...inc,
    confirmed: !!inc.confirmed,
    confidence: confidenceOf(inc, reports),
    first_at: reports[0]?.created_at ?? inc.created_at,
    latest_at: reports.at(-1)?.created_at ?? inc.updated_at,
    counts: { photo: count('photo'), video: count('video'), voice: count('voice'), text: count('text'), help: count('help') },
    urgent_count: urgent.length,
    unreviewed: reports.filter((r) => !r.reviewed).length,
    points: reports.filter((r) => r.lat != null).map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, kind: r.kind, category: r.category, title: r.title, created_at: r.created_at, urgent: !!r.urgent })),
  };
  if (withReports) {
    out.reports = reports.map(serializeReport);
    out.events = all('SELECT created_at, text FROM events WHERE incident_id = ? ORDER BY created_at ASC', inc.id);
  }
  return out;
}

function priority(i) {
  const conf = { Unconfirmed: 0, Likely: 1, Confirmed: 2 }[i.confidence];
  return i.severity * 10 + Math.log2(i.report_count + 1) * 6 + i.urgent_count * 25 + conf * 4;
}

function markReviewed(incidentId) {
  for (const r of incidentReports(incidentId)) if (!r.reviewed) update('reports', r.id, { reviewed: 1 });
}

// ---------- Resident API ----------

app.post('/api/reports', upload.fields([{ name: 'media', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), async (req, res) => {
  const b = req.body || {};
  const media = req.files?.media?.[0];
  const thumb = req.files?.thumb?.[0];
  const kind = ['photo', 'video', 'voice', 'text', 'help'].includes(b.kind) ? b.kind : 'text';
  const flags = list(b.flags).filter((f) => ['trapped', 'hurt', 'silent'].includes(f));
  const urgent = kind === 'help';
  const report = {
    id: newId('rep'),
    created_at: Date.now(),
    kind,
    text: String(b.text || '').slice(0, 2000),
    transcript: String(b.transcript || '').slice(0, 4000),
    chips: list(b.chips).slice(0, 10),
    flags,
    lat: num(b.lat),
    lng: num(b.lng),
    accuracy_m: num(b.accuracy),
    address: String(b.address || '').slice(0, 200),
    media_path: media?.path ?? null,
    media_type: media?.mimetype ?? null,
    thumb_path: thumb?.path ?? null,
    media_duration_s: num(b.duration),
    urgent: urgent ? 1 : 0,
    help_status: urgent ? 'waiting' : null,
    contact_name: b.contact_name ? String(b.contact_name).slice(0, 80) : null,
    contact_info: b.contact_info ? String(b.contact_info).slice(0, 80) : null,
  };
  if (report.lat == null || report.lng == null) return res.status(400).json({ error: 'Location is required.' });
  res.status(201).json({ id: report.id });
  ingest(report).catch((err) => console.error('[ingest]', err));
});

app.get('/api/reports/:id', (req, res) => {
  const r = get('reports', req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const inc = r.incident_id ? get('incidents', r.incident_id) : null;
  const reports = inc ? incidentReports(inc.id) : [];
  res.json({
    report: serializeReport(r),
    incident: inc && { id: inc.id, title: inc.title, category: inc.category, report_count: inc.report_count, confidence: confidenceOf(inc, reports), status: inc.status },
    others_nearby: inc ? Math.max(0, inc.report_count - 1) : 0,
  });
});

app.get('/api/alerts/active', (req, res) => {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  const since = Date.now() - 6 * 3600 * 1000;
  const alerts = all('SELECT * FROM alerts WHERE created_at > ? ORDER BY created_at DESC', since).filter(
    (a) => lat == null || lng == null || (a.polygon && pointInPolygon([lat, lng], a.polygon)),
  );
  res.json({ alerts: alerts.map(({ id, created_at, level, title, message }) => ({ id, created_at, level, title, message })) });
});

app.get('/api/nearby', (req, res) => {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng required' });
  const radius = Math.min(20000, (num(req.query.radius_km) ?? 5) * 1000);
  const incidents = all("SELECT * FROM incidents WHERE status = 'active'")
    .map((inc) => ({ inc, d: distanceM([lat, lng], [inc.lat, inc.lng]) }))
    .filter(({ d }) => d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(({ inc, d }) => ({
      id: inc.id,
      title: inc.title,
      category: inc.category,
      place: inc.place,
      report_count: inc.report_count,
      confidence: confidenceOf(inc, incidentReports(inc.id)),
      distance_m: Math.round(d),
      in_zone: Boolean(inc.zone?.polygon && pointInPolygon([lat, lng], inc.zone.polygon)),
      latest_at: inc.updated_at,
    }));
  res.json({ incidents });
});

app.get('/api/geocode', async (req, res) => {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng required' });
  res.json({ address: await reverseGeocode(lat, lng) });
});

// ---------- Responder API ----------

app.get('/api/config', (req, res) => {
  res.json({ app_name: APP_NAME, ai: aiEnabled(), pop_density_per_km2: POP_DENSITY_PER_KM2, replay_running: replayRunning() });
});

app.get('/api/state', (req, res) => {
  const incidents = all("SELECT * FROM incidents WHERE status = 'active'")
    .map((i) => serializeIncident(i))
    .map((i) => ({ ...i, priority: priority(i) }))
    .sort((a, b) => b.priority - a.priority);
  const urgent = all("SELECT * FROM reports WHERE urgent = 1 AND help_status != 'resolved' ORDER BY created_at ASC").map(serializeReport);
  const loose = all("SELECT * FROM reports WHERE incident_id IS NULL AND created_at > ? ORDER BY created_at DESC", Date.now() - 3600 * 1000).map(serializeReport);
  const hourAgo = Date.now() - 3600 * 1000;
  res.json({
    now: Date.now(),
    incidents,
    urgent,
    pending_reports: loose,
    alerts: all('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 20'),
    stats: {
      active: incidents.length,
      reports_last_hour: all('SELECT id FROM reports WHERE created_at > ?', hourAgo).length,
      urgent: urgent.filter((u) => u.help_status === 'waiting').length,
      awaiting_review: all('SELECT id FROM reports WHERE reviewed = 0').length,
    },
  });
});

app.get('/api/incidents/:id', (req, res) => {
  const inc = get('incidents', req.params.id);
  if (!inc) return res.status(404).json({ error: 'Not found' });
  res.json(serializeIncident(inc, { withReports: true }));
});

function incidentAction(fn) {
  return async (req, res) => {
    const inc = get('incidents', req.params.id);
    if (!inc) return res.status(404).json({ error: 'Not found' });
    await fn(inc, req.body || {});
    markReviewed(inc.id);
    bus.emit('change', { type: 'incident', id: inc.id });
    res.json(serializeIncident(get('incidents', inc.id), { withReports: true }));
  };
}

app.post('/api/incidents/:id/review', incidentAction((inc) => logEvent(inc.id, 'Reviewed by a responder')));
app.post('/api/incidents/:id/confirm', incidentAction((inc) => {
  update('incidents', inc.id, { confirmed: 1 });
  logEvent(inc.id, 'Confirmed by a responder');
}));
app.post('/api/incidents/:id/resolve', incidentAction((inc) => {
  update('incidents', inc.id, { status: 'resolved' });
  logEvent(inc.id, 'Marked resolved');
}));
app.post('/api/incidents/:id/dispatch', incidentAction((inc, b) => {
  logEvent(inc.id, `Handed off to ${String(b.unit || 'field units').slice(0, 60)}`);
}));
app.post('/api/incidents/:id/refresh', incidentAction((inc) => refreshSummaryAndZone(inc.id)));

app.post('/api/alerts', (req, res) => {
  const b = req.body || {};
  const inc = b.incident_id ? get('incidents', b.incident_id) : null;
  if (!Array.isArray(b.polygon) || b.polygon.length < 3) return res.status(400).json({ error: 'Alert needs an area.' });
  if (!b.message) return res.status(400).json({ error: 'Alert needs a message.' });
  const alert = {
    id: newId('alt'),
    created_at: Date.now(),
    incident_id: inc?.id ?? null,
    level: String(b.level || 'Advisory').slice(0, 40),
    title: String(b.title || 'Emergency alert').slice(0, 80),
    message: String(b.message).slice(0, 360),
    polygon: b.polygon.map((p) => [Number(p[0]), Number(p[1])]),
    residents_est: num(b.residents_est),
    channels: list(b.channels),
    approved_by: String(b.approved_by || 'Supervisor').slice(0, 80),
  };
  insert('alerts', alert);
  if (inc) {
    logEvent(inc.id, `Alert sent: ${alert.title} (~${alert.residents_est ?? '?'} residents)`);
    markReviewed(inc.id);
  }
  bus.emit('change', { type: 'alert', id: alert.id });
  res.status(201).json(alert);
});

app.post('/api/help/:id/status', (req, res) => {
  const r = get('reports', req.params.id);
  if (!r || !r.urgent) return res.status(404).json({ error: 'Not found' });
  const status = ['waiting', 'assigned', 'resolved'].includes(req.body?.status) ? req.body.status : 'assigned';
  update('reports', r.id, { help_status: status, reviewed: 1 });
  if (r.incident_id) logEvent(r.incident_id, `Help request ${status === 'assigned' ? 'assigned to a responder' : status}`);
  bus.emit('change', { type: 'help', id: r.id });
  res.json(serializeReport(get('reports', r.id)));
});

// ---------- Live updates (Server-Sent Events) ----------

app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  bus.on('change', send);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('change', send);
  });
});

// ---------- Demo controls ----------

app.post('/api/demo/reset', async (req, res) => {
  stopReplay();
  resetAll();
  if (req.body?.baseline !== false) await loadBaseline();
  bus.emit('change', { type: 'reset' });
  res.json({ ok: true });
});

app.post('/api/demo/replay', (req, res) => {
  startReplay();
  res.json({ ok: true });
});

if (process.env.SEED_ON_START !== 'false' && all('SELECT id FROM incidents').length === 0) {
  await loadBaseline();
  console.log('Loaded demo incidents (set SEED_ON_START=false to start empty).');
}

app.listen(PORT, () => {
  console.log(`${APP_NAME} running on http://localhost:${PORT}`);
  console.log(`  Resident app:   http://localhost:${PORT}/`);
  console.log(`  Responder view: http://localhost:${PORT}/responder`);
  console.log(`  AI triage:      ${aiEnabled() ? 'Claude' : 'keyword fallback (set ANTHROPIC_API_KEY to enable Claude)'}`);
});
