// Demo data for the active profile. Baseline: incidents already in progress.
// Replay: a new incident comes in live, one report every few seconds, through
// the same pipeline real reports use (including Claude triage when a key is set).
// All names, numbers, and reports are made up for the demo.

import path from 'node:path';
import { insert, update, logEvent, all } from '../lib/db.js';
import { cluster, ingest, newId, bus, refreshIncidentStats } from '../lib/pipeline.js';
import { computeZone } from '../lib/zone.js';
import { offset } from '../lib/geo.js';
import { activeProfile, category } from '../lib/categories.js';

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stand-in pictures for seeded photo and video reports (public/demo/*.jpg).
const DEMO_DIR = path.resolve('public/demo');
const demoMedia = (cat) => path.join(DEMO_DIR, `${['fire', 'smoke', 'flood', 'drone', 'security', 'hazmat'].includes(cat) ? cat : 'other'}.jpg`);

const shortTitle = (text) => text.split(' ').slice(0, 6).join(' ').replace(/[.,;:]$/, '');

export async function loadBaseline() {
  const profile = activeProfile();
  const R = rng(7);
  const now = Date.now();
  const at = (minAgo) => now - minAgo * 60000;
  const scatter = (center, spreadM) => offset(center, spreadM * Math.sqrt(R()), R() * 360);

  for (const scene of profile.scenario.baseline) {
    let incId = null;
    const add = (r, place) => {
      insert('reports', r);
      const inc = cluster(r, { place });
      incId = inc.id;
      const what = r.urgent ? 'Help request' : { voice: 'Voice note', photo: 'Photo', video: 'Video' }[r.kind] || 'Text report';
      logEvent(inc.id, `${what}: ${r.title}`, r.created_at);
    };
    for (const [minAgo, kind, cat, severity, text] of scene.reports) {
      const [lat, lng] = scatter(scene.center, scene.spreadM);
      const isMedia = kind === 'photo' || kind === 'video';
      const reviewedAt = scene.reviewedMin ? at(minAgo) + scene.reviewedMin * 60000 : null;
      add({
        id: newId('rep'), created_at: at(minAgo), triaged_at: at(minAgo) + 2500, kind, category: cat, severity,
        text: kind === 'text' || isMedia ? text : '', transcript: kind === 'voice' ? text : '',
        title: shortTitle(text), ai_summary: text,
        lat, lng, accuracy_m: 10, address: scene.place, status: 'triaged', triage_source: 'seed', source: 'seed',
        media_duration_s: kind === 'voice' ? 8 + Math.round(R() * 25) : kind === 'video' ? 12 + Math.round(R() * 30) : null,
        media_path: isMedia ? demoMedia(cat) : null, media_type: isMedia ? 'image/jpeg' : null,
        thumb_path: kind === 'video' ? demoMedia(cat) : null,
        reviewed: reviewedAt && reviewedAt < now ? 1 : 0, reviewed_at: reviewedAt && reviewedAt < now ? reviewedAt : null,
      }, scene.place);
    }
    if (scene.help) {
      const [minAgo, name, contact, flags, text] = scene.help;
      const [lat, lng] = scatter(scene.center, scene.spreadM * 0.6);
      add({
        id: newId('rep'), created_at: at(minAgo), triaged_at: at(minAgo) + 1500, kind: 'help', category: scene.category, severity: 5,
        text, title: shortTitle(text), ai_summary: text,
        flags, lat, lng, accuracy_m: 8, address: scene.place, status: 'triaged', triage_source: 'seed', source: 'seed',
        urgent: 1, help_status: 'waiting', contact_name: name, contact_info: contact,
      }, scene.place);
    }
    refreshIncidentStats(incId);
    update('incidents', incId, { title: scene.title, summary: scene.summary, summary_source: 'seed', confirmed: scene.confirmed ? 1 : 0, place: scene.place });
    if (scene.confirmed) logEvent(incId, 'Confirmed by a responder', at(Math.max(1, (scene.reviewedMin || 3))));
  }

  // Zones need wind data, so fill them in without holding up startup.
  for (const inc of all("SELECT * FROM incidents WHERE status = 'active'")) {
    const reports = all('SELECT * FROM reports WHERE incident_id = ?', inc.id);
    computeZone(inc, reports).then((zone) => {
      if (!all('SELECT id FROM incidents WHERE id = ?', inc.id).length) return;
      update('incidents', inc.id, { zone });
      bus.emit('change', { type: 'incident', id: inc.id });
    });
  }
}

let replayTimer = null;
export const replayRunning = () => Boolean(replayTimer);

export function stopReplay() {
  clearInterval(replayTimer);
  replayTimer = null;
}

export function startReplay(intervalMs = Number(process.env.REPLAY_INTERVAL_MS || 4000)) {
  stopReplay();
  const { replay } = activeProfile().scenario;
  const R = rng(Date.now() & 0xffff);
  let i = 0;
  const next = () => {
    if (i >= replay.reports.length) return stopReplay();
    const [kind, text, flags] = replay.reports[i++];
    const [lat, lng] = offset(replay.center, 450 * Math.sqrt(R()), R() * 360);
    const isMedia = kind === 'photo' || kind === 'video';
    const guessCat = category(activeProfile().categories.find((c) => c.keywords?.test(text))?.key || 'other').key;
    ingest(
      {
        id: newId('rep'), created_at: Date.now(), kind,
        text: kind === 'voice' ? '' : text, transcript: kind === 'voice' ? text : '',
        flags: flags || [], lat, lng, accuracy_m: 12, address: replay.place,
        urgent: kind === 'help' ? 1 : 0, help_status: kind === 'help' ? 'waiting' : null,
        contact_name: kind === 'help' ? replay.helper[0] : null, contact_info: kind === 'help' ? replay.helper[1] : null,
        media_duration_s: kind === 'voice' ? 14 : kind === 'video' ? 20 : null,
        media_path: isMedia ? demoMedia(guessCat) : null, media_type: isMedia ? 'image/jpeg' : null,
        thumb_path: kind === 'video' ? demoMedia(guessCat) : null,
        source: 'seed',
      },
      { skipGeocode: true },
    ).catch((e) => console.error('[replay]', e));
  };
  next();
  replayTimer = setInterval(next, intervalMs);
}
