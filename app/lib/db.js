import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,             -- photo | video | voice | text | help
  text TEXT DEFAULT '',
  transcript TEXT DEFAULT '',
  chips TEXT DEFAULT '[]',
  flags TEXT DEFAULT '[]',        -- trapped | hurt | silent
  lat REAL, lng REAL, accuracy_m REAL,
  address TEXT DEFAULT '',
  media_path TEXT, media_type TEXT, thumb_path TEXT, media_duration_s REAL,
  category TEXT, severity INTEGER, title TEXT, ai_summary TEXT,
  triage_source TEXT,             -- claude | keywords | seed
  status TEXT DEFAULT 'received', -- received | triaged
  incident_id TEXT,
  reviewed INTEGER DEFAULT 0,
  urgent INTEGER DEFAULT 0,
  help_status TEXT,               -- waiting | assigned | resolved (urgent only)
  contact_name TEXT, contact_info TEXT,
  source TEXT DEFAULT 'resident'  -- resident | seed
);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  category TEXT NOT NULL,
  title TEXT, place TEXT DEFAULT '',
  lat REAL, lng REAL,
  report_count INTEGER DEFAULT 0,
  severity INTEGER DEFAULT 2,
  confirmed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',   -- active | resolved
  summary TEXT DEFAULT '',
  summary_source TEXT,
  zone TEXT                       -- JSON from lib/zone.js
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  incident_id TEXT,
  level TEXT, title TEXT, message TEXT,
  polygon TEXT,                   -- JSON [[lat,lng],...]
  residents_est INTEGER,
  channels TEXT DEFAULT '[]',
  approved_by TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  incident_id TEXT,
  text TEXT
);
CREATE INDEX IF NOT EXISTS reports_incident ON reports(incident_id);
CREATE INDEX IF NOT EXISTS reports_created ON reports(created_at);
`);

const JSON_COLS = ['chips', 'flags', 'zone', 'polygon', 'channels'];

export function parseRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const c of JSON_COLS) if (typeof out[c] === 'string') out[c] = JSON.parse(out[c] || 'null');
  return out;
}

export function insert(table, obj) {
  const cols = Object.keys(obj);
  const vals = cols.map((c) => (JSON_COLS.includes(c) && obj[c] != null ? JSON.stringify(obj[c]) : obj[c]));
  db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
}

export function update(table, id, obj) {
  const cols = Object.keys(obj);
  if (!cols.length) return;
  const vals = cols.map((c) => (JSON_COLS.includes(c) && obj[c] != null ? JSON.stringify(obj[c]) : obj[c]));
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...vals, id);
}

export function get(table, id) {
  return parseRow(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params).map(parseRow);
}

export function logEvent(incidentId, text, at = Date.now()) {
  db.prepare('INSERT INTO events (created_at, incident_id, text) VALUES (?, ?, ?)').run(at, incidentId, text);
}

export function resetAll() {
  db.exec('DELETE FROM reports; DELETE FROM incidents; DELETE FROM alerts; DELETE FROM events;');
}
