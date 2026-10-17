// What happens to a report after it arrives:
// save -> street name -> AI triage -> join or start an incident -> refresh
// incident summary and impact zone. Each step broadcasts so the dashboard
// updates live.

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { insert, update, get, all, logEvent } from './db.js';
import { CATEGORIES } from './categories.js';
import { distanceM, centroid } from './geo.js';
import { triageReport, summarizeIncident } from './triage.js';
import { computeZone } from './zone.js';
import { reverseGeocode } from './external.js';

export const bus = new EventEmitter();
bus.setMaxListeners(200);

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

const MERGE_WINDOW_MS = 6 * 3600 * 1000;

export function confidenceOf(incident, reports) {
  if (incident.confirmed) return 'Confirmed';
  const withMedia = reports.filter((r) => r.kind === 'photo' || r.kind === 'video').length;
  if (reports.length >= 3 || (reports.length >= 2 && withMedia >= 1)) return 'Likely';
  return 'Unconfirmed';
}

export function incidentReports(id) {
  return all('SELECT * FROM reports WHERE incident_id = ? ORDER BY created_at ASC', id);
}

function findIncident(report) {
  const fam = CATEGORIES[report.category].family;
  const candidates = all(
    "SELECT * FROM incidents WHERE status = 'active' AND updated_at > ?",
    report.created_at - MERGE_WINDOW_MS,
  ).filter((i) => CATEGORIES[i.category].family === fam);
  let best = null;
  for (const inc of candidates) {
    const d = distanceM([report.lat, report.lng], [inc.lat, inc.lng]);
    const limit = Math.max(CATEGORIES[inc.category].mergeM, CATEGORIES[report.category].mergeM);
    if (d <= limit && (!best || d < best.d)) best = { inc, d };
  }
  return best?.inc ?? null;
}

// People asking for help belong to whatever is happening around them,
// whatever words they used.
function nearestIncident(report, maxM = 1500) {
  let best = null;
  for (const inc of all("SELECT * FROM incidents WHERE status = 'active'")) {
    const d = distanceM([report.lat, report.lng], [inc.lat, inc.lng]);
    if (d <= maxM && (!best || d < best.d)) best = { inc, d };
  }
  return best?.inc ?? null;
}

// Assigns a triaged report to an incident and refreshes the incident's stats.
export function cluster(report, { place } = {}) {
  let inc = report.urgent ? nearestIncident(report) : null;
  if (inc) {
    report.category = inc.category;
    update('reports', report.id, { category: inc.category });
  } else {
    inc = findIncident(report);
  }
  if (!inc) {
    inc = {
      id: newId('inc'),
      created_at: report.created_at,
      updated_at: report.created_at,
      category: report.category,
      title: CATEGORIES[report.category].label,
      place: place || report.address || '',
      lat: report.lat,
      lng: report.lng,
      report_count: 0,
      severity: report.severity || 2,
    };
    insert('incidents', inc);
    logEvent(inc.id, `New incident from a ${report.kind} report`, report.created_at);
  }
  update('reports', report.id, { incident_id: inc.id });
  refreshIncidentStats(inc.id);
  return get('incidents', inc.id);
}

export function refreshIncidentStats(id) {
  const inc = get('incidents', id);
  const reports = incidentReports(id);
  if (!reports.length) return;
  const pts = reports.filter((r) => r.lat != null).map((r) => [r.lat, r.lng]);
  const [lat, lng] = centroid(pts);
  // The incident takes the category most reports agree on; fire wins ties with smoke.
  const counts = {};
  for (const r of reports) counts[r.category] = (counts[r.category] || 0) + 1;
  const category = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] === 'fire' ? -1 : 1))[0][0];
  update('incidents', id, {
    lat,
    lng,
    category,
    report_count: reports.length,
    severity: Math.max(...reports.map((r) => r.severity || 1)),
    updated_at: Math.max(...reports.map((r) => r.created_at)),
    place: inc.place || reports.find((r) => r.address)?.address || '',
  });
}

// Summaries and zones cost an API call, so batch bursts of reports.
const pending = new Map();
export function scheduleRefresh(incidentId, delayMs = 2500) {
  clearTimeout(pending.get(incidentId));
  pending.set(
    incidentId,
    setTimeout(() => {
      pending.delete(incidentId);
      refreshSummaryAndZone(incidentId).catch((e) => console.warn('[refresh]', e.message));
    }, delayMs),
  );
}

export async function refreshSummaryAndZone(incidentId) {
  const inc = get('incidents', incidentId);
  if (!inc) return;
  const reports = incidentReports(incidentId);
  const [sum, zone] = await Promise.all([summarizeIncident(inc, reports), computeZone(inc, reports)]);
  update('incidents', incidentId, {
    summary: sum.summary,
    summary_source: sum.source,
    title: sum.title || inc.title,
    zone,
  });
  bus.emit('change', { type: 'incident', id: incidentId });
}

export async function ingest(report, { skipGeocode = false } = {}) {
  insert('reports', report);
  bus.emit('change', { type: 'report', id: report.id });

  // Street name and triage run side by side so a slow lookup never delays triage.
  const geocode = !report.address && report.lat != null && !skipGeocode
    ? reverseGeocode(report.lat, report.lng).then((address) => {
        if (!address) return;
        report.address = address;
        update('reports', report.id, { address });
      })
    : Promise.resolve();
  const [t] = await Promise.all([triageReport(report), geocode]);
  Object.assign(report, {
    category: t.category,
    severity: t.severity,
    title: t.title,
    ai_summary: t.summary,
    triage_source: t.source,
    status: 'triaged',
  });
  update('reports', report.id, {
    category: report.category,
    severity: report.severity,
    title: report.title,
    ai_summary: report.ai_summary,
    triage_source: report.triage_source,
    status: 'triaged',
  });

  const inc = cluster(report);
  logEvent(inc.id, `${report.urgent ? 'Help request' : `${report.kind[0].toUpperCase()}${report.kind.slice(1)} report`}: ${report.title}`, report.created_at);
  bus.emit('change', { type: 'report', id: report.id, incident_id: inc.id });
  scheduleRefresh(inc.id);
  return get('reports', report.id);
}
