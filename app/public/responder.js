// Responder dashboard: live map, urgent queue, incident list, detail panel,
// and the alert preview that waits for a person to approve.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (body, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  fire: '<path d="M12 22c4 0 7-2.8 7-7 0-3.5-2.4-6.2-4.3-8.3-.4 2.2-1.5 3.6-2.7 4.3.2-3.3-1.3-6.4-4-9 .3 3.6-3 5.8-3 11 0 5.2 3 9 7 9z"/>',
  smoke: '<path d="M4 15h11a3 3 0 1 0-3-3M4 19h15a3 3 0 1 1-3 3M4 11h6a3 3 0 1 0-3-3"/>',
  flood: '<path d="M2 8c2 0 2-1.5 4-1.5S8 8 10 8s2-1.5 4-1.5S16 8 18 8s2-1.5 4-1.5M2 13c2 0 2-1.5 4-1.5S8 13 10 13s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5"/>',
  power: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/><path d="M3 3l18 18"/>',
  gas: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h4"/>',
  road: '<path d="M3 20h18M6 20l3-14h6l3 14M12 8v2M12 13v2"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
  camera: '<path d="M4 8.5h3l1.8-2.5h6.4L17 8.5h3V19H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  text: '<path d="M4 5h16v11H9.5L4 20z"/>',
  phone: '<path d="M5 4h3.5l2 5-2.5 1.5a11 11 0 0 0 5.5 5.5l1.5-2.5 5 2V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
};
const icon = (name, size) => svg(ICONS[name] || ICONS.other, size);

const CAT = {
  fire: 'Fire', smoke: 'Smoke', flood: 'Flood', power: 'Power out', gas: 'Gas smell', road: 'Road blocked', other: 'Other',
};
const catColor = (c) => `var(--c-${CAT[c] ? c : 'other'})`;
const CONF = {
  Unconfirmed: { c: 'var(--amber)', bg: 'var(--amber-soft)', rank: 0 },
  Likely: { c: 'var(--likely)', bg: 'var(--likely-soft)', rank: 1 },
  Confirmed: { c: 'var(--green)', bg: 'var(--green-soft)', rank: 2 },
};
const KIND_ICON = { photo: 'camera', video: 'video', voice: 'mic', text: 'text', help: 'phone' };
const FLAG_LABEL = { trapped: 'Trapped', hurt: 'Injured', silent: "Can't speak safely" };

const state = {
  config: { app_name: 'Beacon', ai: false, pop_density_per_km2: 3200 },
  data: null,
  selected: null,
  detail: null,
  filters: { q: '', type: '', conf: 0 },
  layers: { reports: true, incidents: true, urgent: true, zones: true },
  theme: 'dark',
  fitted: false,
};

// ---------- Helpers ----------

const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function ago(ms) {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
const wait = (ms) => {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const soft = (c) => `color-mix(in oklch, ${c} 18%, transparent)`;

function toast(msg) {
  const el = $('[data-toast]');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return res.json();
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function areaM2(poly) {
  if (!poly || poly.length < 3) return 0;
  const lat0 = rad(poly.reduce((s, p) => s + p[0], 0) / poly.length);
  const xy = poly.map((p) => [rad(p[1]) * R * Math.cos(lat0), rad(p[0]) * R]);
  let s = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
function scalePolygon(poly, f) {
  const c = [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return poly.map((p) => [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f]);
}
const residentsFor = (poly) => Math.round((areaM2(poly) / 1e6) * state.config.pop_density_per_km2 / 100) * 100;

// ---------- Map ----------

const TILE = (theme) => `https://{s}.basemaps.cartocdn.com/${theme === 'dark' ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`;
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const map = L.map('map', { zoomControl: true, attributionControl: true }).setView([34.06, -118.3], 12);
let tiles = L.tileLayer(TILE('dark'), { attribution: ATTR, subdomains: 'abcd', maxZoom: 19 }).addTo(map);
const groups = {
  zones: L.layerGroup().addTo(map),
  reports: L.layerGroup().addTo(map),
  incidents: L.layerGroup().addTo(map),
  urgent: L.layerGroup().addTo(map),
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawMap() {
  const d = state.data;
  if (!d) return;
  Object.values(groups).forEach((g) => g.clearLayers());
  const visible = visibleIncidents();
  const visIds = new Set(visible.map((i) => i.id));

  if (state.layers.zones) {
    for (const inc of visible) {
      if (!inc.zone?.polygon) continue;
      const sel = inc.id === state.selected;
      if (!sel && inc.id !== state.hover) continue;
      L.polygon(inc.zone.polygon, {
        color: cssVar('--red'), weight: sel ? 2 : 1, dashArray: '6 6', fillColor: cssVar('--red'), fillOpacity: sel ? 0.12 : 0.06,
      }).bindTooltip(`Suggested alert zone · ~${inc.zone.residents_est.toLocaleString()} residents`, { sticky: true }).addTo(groups.zones);
    }
  }
  if (state.layers.reports) {
    for (const inc of visible) {
      for (const p of inc.points) {
        if (p.urgent) continue;
        L.circleMarker([p.lat, p.lng], { radius: 4, weight: 1, color: cssVar('--bg'), fillColor: cssVar(`--c-${CAT[p.category] ? p.category : 'other'}`), fillOpacity: 0.95 })
          .bindTooltip(`<b>${esc(CAT[p.category] || 'Report')}</b> · ${time(p.created_at)}<br>${esc(p.title || '')}`)
          .on('click', () => select(inc.id))
          .addTo(groups.reports);
      }
    }
    for (const r of d.pending_reports) {
      L.circleMarker([r.lat, r.lng], { radius: 5, weight: 2, color: cssVar('--faint'), fillOpacity: 0 })
        .bindTooltip('New report, being checked').addTo(groups.reports);
    }
  }
  if (state.layers.incidents) {
    for (const inc of visible) {
      const size = 30 + Math.min(inc.report_count, 20) * 1.4;
      const sel = inc.id === state.selected;
      const html = `<div class="cluster${sel ? ' sel' : ''}" style="width:${size}px;height:${size}px;border-color:${CONF[inc.confidence].c};background:color-mix(in oklch, ${catColor(inc.category)} 45%, var(--bg))">${inc.report_count}</div>`;
      L.marker([inc.lat, inc.lng], { icon: L.divIcon({ html, className: '', iconSize: [size, size] }), zIndexOffset: sel ? 900 : 500 })
        .bindTooltip(`<b>${esc(inc.title)}</b> · ${inc.confidence}<br>${esc(inc.place)}<br>latest ${time(inc.latest_at)}`, { direction: 'top', offset: [0, -size / 2] })
        .on('click', () => select(inc.id))
        .on('mouseover', () => { state.hover = inc.id; drawZonesOnly(); })
        .on('mouseout', () => { state.hover = null; drawZonesOnly(); })
        .addTo(groups.incidents);
    }
  }
  if (state.layers.urgent) {
    for (const u of d.urgent) {
      if (u.incident_id && !visIds.has(u.incident_id) && state.filters.type) continue;
      const html = '<div class="urgent-pin"><span class="pulse"></span><span class="core"></span></div>';
      L.marker([u.lat, u.lng], { icon: L.divIcon({ html, className: '', iconSize: [22, 22] }), zIndexOffset: 1000 })
        .bindTooltip(`<b>Urgent help · ${esc(u.contact_name || 'Resident')}</b> · ${wait(u.created_at)} waiting<br>${esc(u.text)}<br>${(u.flags || []).map((f) => FLAG_LABEL[f]).join(', ')}`)
        .on('click', () => u.incident_id && select(u.incident_id))
        .addTo(groups.urgent);
    }
  }
  if (!state.fitted && visible.length) {
    state.fitted = true;
    map.fitBounds(L.latLngBounds(visible.map((i) => [i.lat, i.lng])).pad(0.2));
  }
}

function drawZonesOnly() {
  // Hovering only changes zones, so skip a full redraw.
  groups.zones.clearLayers();
  if (!state.layers.zones || !state.data) return;
  for (const inc of visibleIncidents()) {
    if (!inc.zone?.polygon || (inc.id !== state.selected && inc.id !== state.hover)) continue;
    const sel = inc.id === state.selected;
    L.polygon(inc.zone.polygon, { color: cssVar('--red'), weight: sel ? 2 : 1, dashArray: '6 6', fillColor: cssVar('--red'), fillOpacity: sel ? 0.12 : 0.06 }).addTo(groups.zones);
  }
}

// ---------- Lists ----------

function visibleIncidents() {
  const { q, type, conf } = state.filters;
  return (state.data?.incidents || []).filter(
    (i) => (!type || i.category === type || (type === 'fire' && i.category === 'smoke')) &&
      CONF[i.confidence].rank >= conf &&
      (!q || `${i.title} ${i.place} ${i.summary}`.toLowerCase().includes(q.toLowerCase())),
  );
}

function renderStats() {
  for (const [k, v] of Object.entries(state.data.stats)) {
    const el = $(`[data-stat="${k}"]`);
    if (el) el.textContent = v;
  }
}

function renderUrgent() {
  const list = state.data.urgent;
  $('[data-urgent-count]').textContent = list.filter((u) => u.help_status === 'waiting').length;
  const box = $('[data-urgent-list]');
  if (!list.length) {
    box.innerHTML = '<div class="empty">No one is waiting for help.</div>';
    return;
  }
  box.innerHTML = list
    .map((u) => {
      const phone = /\d{3}.*\d{4}/.test(u.contact_info || '') ? u.contact_info.replace(/[^\d+]/g, '') : null;
      const assigned = u.help_status === 'assigned';
      return `<div class="urg" data-urg="${u.id}" data-inc="${u.incident_id || ''}">
        <div class="urg-top"><span class="urg-name">${esc(u.contact_name || 'Resident')}</span><span class="urg-wait" data-wait="${u.created_at}">${wait(u.created_at)}</span></div>
        <div class="urg-sub">${esc(u.contact_info || 'No contact given')} · ${esc(u.address || 'Location shared')}</div>
        <div class="urg-text">“${esc(u.text)}”</div>
        <div class="flags">${(u.flags || []).map((f) => `<span class="flag">${FLAG_LABEL[f]}</span>`).join('')}${assigned ? '<span class="flag ok">Responder assigned</span>' : ''}</div>
        <div class="urg-actions">
          ${phone && !(u.flags || []).includes('silent') ? `<a href="tel:${phone}">Call back</a>` : '<button data-urg-act="text">Text back</button>'}
          ${assigned ? `<button data-urg-act="resolved">Mark safe</button>` : `<button class="primary" data-urg-act="assigned">Assign responder</button>`}
        </div>
      </div>`;
    })
    .join('');
}

function renderIncidents() {
  const list = visibleIncidents();
  $('[data-inc-count]').textContent = list.length;
  const box = $('[data-inc-list]');
  if (!list.length) {
    box.innerHTML = '<div class="empty">No incidents match these filters.</div>';
    return;
  }
  box.innerHTML = list
    .map((i) => {
      const c = CONF[i.confidence];
      return `<div class="inc${i.id === state.selected ? ' sel' : ''}" data-inc="${i.id}">
        <div class="cat-icon" style="color:${catColor(i.category)};background:${soft(catColor(i.category))}">${icon(i.category)}</div>
        <div class="inc-main">
          <div class="inc-top"><span class="inc-title">${esc(i.title)}</span><span class="conf" style="color:${c.c};background:${c.bg}">${i.confidence}</span></div>
          <div class="inc-place">${esc(i.place || 'Location from reports')}</div>
          <div class="inc-meta">
            <span>${i.report_count} report${i.report_count === 1 ? '' : 's'}</span>
            ${i.counts.photo ? `<span class="m">${icon('camera', 13)}${i.counts.photo}</span>` : ''}
            ${i.counts.video ? `<span class="m">${icon('video', 13)}${i.counts.video}</span>` : ''}
            ${i.counts.voice ? `<span class="m">${icon('mic', 13)}${i.counts.voice}</span>` : ''}
            ${i.urgent_count ? `<span class="m urgent">${icon('phone', 13)}${i.urgent_count}</span>` : ''}
            <span style="margin-left:auto">${ago(i.first_at)}</span>
          </div>
        </div>
      </div>`;
    })
    .join('');
}

// ---------- Detail ----------

async function select(id) {
  state.selected = id;
  $('[data-detail]').hidden = false;
  renderIncidents();
  drawMap();
  await loadDetail();
  const inc = state.detail;
  if (inc) map.flyTo([inc.lat, inc.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
}

async function loadDetail() {
  if (!state.selected) return;
  try {
    state.detail = await api(`/api/incidents/${state.selected}`);
    renderDetail();
  } catch {
    closeDetail();
  }
}

function closeDetail() {
  state.selected = null;
  state.detail = null;
  $('[data-detail]').hidden = true;
  renderIncidents();
  drawMap();
}

function renderDetail() {
  const d = state.detail;
  if (!d) return;
  const c = CONF[d.confidence];
  const media = d.reports.filter((r) => (r.kind === 'photo' || r.kind === 'video') && r.media_url);
  const voices = d.reports.filter((r) => r.kind === 'voice');
  const texts = d.reports.filter((r) => r.kind === 'text' && r.text);
  const urgent = d.reports.filter((r) => r.urgent && r.help_status !== 'resolved');
  const aiLabel = d.summary_source === 'claude' ? 'AI summary' : d.summary_source === 'seed' ? 'Summary (demo data)' : 'Summary (auto, AI off)';
  const z = d.zone;

  $('[data-detail-body]').innerHTML = `
    <div class="d-head">
      <div class="cat-icon" style="color:${catColor(d.category)};background:${soft(catColor(d.category))}">${icon(d.category, 20)}</div>
      <div>
        <div class="row"><span class="d-title">${esc(d.title)}</span><span class="conf" style="color:${c.c};background:${c.bg}">${d.confidence}</span></div>
        <div class="d-meta">${esc(d.place || '')}</div>
        <div class="d-meta">First report ${time(d.first_at)} · Latest ${time(d.latest_at)} · ${d.report_count} reports</div>
      </div>
      <button class="icon-btn d-close" data-action="close-detail" aria-label="Close">${icon('x', 16)}</button>
    </div>

    <div class="d-section">
      <div class="d-label">${icon('sparkle', 13)} ${aiLabel}</div>
      <div class="ai-box">
        <p>${esc(d.summary || 'Summarizing…')}</p>
        <div class="faint small">Built from ${d.report_count} resident reports. Check the reports before acting.</div>
        ${urgent.map((u) => `<div class="callout"><b>${esc(u.contact_name || 'A resident')}</b> (${(u.flags || []).map((f) => FLAG_LABEL[f].toLowerCase()).join(', ') || 'asked for help'}) is inside this area and asked for help.</div>`).join('')}
      </div>
    </div>

    ${z ? `<div class="d-section">
      <div class="d-label">Suggested alert zone</div>
      <div class="zone-box"><div><b>~${z.residents_est.toLocaleString()} residents</b> · ${z.area_km2} km²<div class="faint small">${esc(z.basis)}${z.wind ? ` · wind ${Math.round(z.wind.speed_kmh)} km/h from ${Math.round(z.wind.from_deg)}°` : ''}</div></div></div>
    </div>` : ''}

    <div class="d-section">
      <div class="d-label">Photos and video · ${media.length}</div>
      ${media.length ? `<div class="media-grid">${media.map((m) => `<a class="m" href="${m.media_url}" target="_blank" rel="noopener" title="${esc(m.text || m.title || '')}"><img src="${m.thumb_url || m.media_url}" alt="${esc(m.title || 'Resident media')}" loading="lazy"><span class="badge">${m.kind === 'video' ? `▶ ${Math.round(m.media_duration_s || 0)}s` : 'photo'} · ${time(m.created_at)}</span></a>`).join('')}</div>`
        : '<div class="empty">No photos or video yet.</div>'}
    </div>

    <div class="d-section">
      <div class="d-label">Voice notes · ${voices.length}</div>
      ${voices.map((v) => `<div class="voice-note"><div class="note-meta"><span>${v.media_duration_s ? `${Math.round(v.media_duration_s)}s · ` : ''}${time(v.created_at)}</span><span>${esc(v.address || '')}</span></div>
        <div>“${esc(v.transcript || v.ai_summary || '(no transcript)')}”</div>${v.media_url ? `<audio controls preload="none" src="${v.media_url}"></audio>` : ''}</div>`).join('') || '<div class="empty">No voice notes.</div>'}
    </div>

    <div class="d-section">
      <div class="d-label">Text reports · ${texts.length}</div>
      ${texts.slice().reverse().map((t) => `<div class="text-note"><div>${esc(t.text)}</div><div class="note-meta"><span>${time(t.created_at)}</span><span>${t.chips?.length ? esc(t.chips.join(', ')) : ''}</span></div></div>`).join('') || '<div class="empty">No text reports.</div>'}
    </div>

    <div class="d-section">
      <div class="d-label">Timeline · oldest first</div>
      <ul class="tl">${d.events.map((e) => `<li><time>${time(e.created_at)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>
    </div>`;
  $('[data-action="confirm"]').disabled = d.confirmed;
  $('[data-action="confirm"]').textContent = d.confirmed ? 'Confirmed' : 'Confirm';
}

// ---------- Alert modal ----------

function alertTemplates(inc) {
  const where = inc.place ? `near ${inc.place}` : 'in this area';
  const t = {
    fire: [
      ['Advisory', 'Smoke advisory', `Smoke has been reported ${where}. Keep windows closed and stay ready for updates. Call 911 only if you need help now.`],
      ['Prepare to leave', 'Fire alert: Prepare to leave', `Fire crews are responding to smoke and flames ${where}. If you live in this area, get ready to leave: pack essentials, charge your phone, and watch for updates. Call 911 only if you need help now.`],
      ['Evacuate now', 'Evacuate now', `Leave now. A fire is spreading ${where}. Follow directions from officials and avoid the fire area. Call 911 only if you need help now.`],
    ],
    flood: [
      ['Advisory', 'Flooding advisory', `Flooding has been reported ${where}. Do not drive or walk through water. Call 911 only if you need help now.`],
      ['Avoid area', 'Flooding: Avoid the area', `Roads are flooded ${where}. Stay off the roads and move valuables off the floor. Call 911 only if you need help now.`],
      ['Move to higher ground', 'Move to higher ground now', `Water is rising ${where}. Move to higher ground now. Do not enter flood water. Call 911 only if you need help now.`],
    ],
    gas: [
      ['Advisory', 'Gas smell reported', `A strong gas smell has been reported ${where}. Crews are checking. Avoid open flames. Call 911 only if you need help now.`],
      ['Avoid area', 'Gas leak: Avoid the area', `Avoid the area ${where}. Do not use lighters or switches if you smell gas. Call 911 only if you need help now.`],
      ['Evacuate now', 'Evacuate now', `Leave the area ${where} now and move upwind. Do not use phones or switches near the smell. Call 911 only if you need help now.`],
    ],
    default: [
      ['Advisory', `${CAT[inc.category]} advisory`, `${CAT[inc.category]} reported ${where}. Stay alert for updates. Call 911 only if you need help now.`],
      ['Avoid area', `${CAT[inc.category]}: Avoid the area`, `Please avoid the area ${where} while crews respond. Call 911 only if you need help now.`],
      ['Shelter in place', 'Stay where you are', `Stay indoors ${where} until further notice. Call 911 only if you need help now.`],
    ],
  };
  return t[inc.category === 'smoke' ? 'fire' : inc.category] || t.default;
}

const modal = { map: null, poly: null, base: null, scale: 1, level: 1, templates: [] };

function openAlert() {
  const d = state.detail;
  if (!d) return;
  if (!d.zone?.polygon) return toast('The alert zone is still being calculated. Try again in a moment.');
  modal.base = d.zone.polygon;
  modal.scale = 1;
  modal.templates = alertTemplates(d);
  modal.level = Math.min(1, modal.templates.length - 1);
  $('[data-modal-sub]').textContent = `${d.title} · ${d.place || ''} · ${d.confidence}`;
  $('[data-zone-basis]').textContent = `Suggested from report spread. ${d.zone.basis}.`;
  $('[data-zone-scale]').value = 100;
  $('[data-levels]').innerHTML = modal.templates.map((t, i) => `<button data-level="${i}">${esc(t[0])}</button>`).join('');
  $('[data-modal]').hidden = false;
  setLevel(modal.level);
  if (!modal.map) {
    modal.map = L.map('alertmap', { zoomControl: false, attributionControl: true });
    modal.tiles = L.tileLayer(TILE(state.theme), { attribution: ATTR, subdomains: 'abcd' }).addTo(modal.map);
  }
  setTimeout(() => {
    modal.map.invalidateSize();
    drawAlertZone(true);
  }, 30);
}

function drawAlertZone(fit = false) {
  const poly = scalePolygon(modal.base, modal.scale);
  if (modal.poly) modal.poly.remove();
  modal.poly = L.polygon(poly, { color: cssVar('--red'), weight: 2, fillColor: cssVar('--red'), fillOpacity: 0.15 }).addTo(modal.map);
  if (fit) modal.map.fitBounds(modal.poly.getBounds().pad(0.3));
  $('[data-residents]').textContent = `~${residentsFor(poly).toLocaleString()}`;
  $('[data-zone-scale-label]').textContent = `${Math.round(modal.scale * 100)}%`;
}

function setLevel(i) {
  modal.level = i;
  $$('[data-level]').forEach((b) => b.classList.toggle('on', Number(b.dataset.level) === i));
  $('[data-msg]').value = modal.templates[i][2];
  updatePreview();
}

function updatePreview() {
  const msg = $('[data-msg]').value;
  $('[data-msg-len]').textContent = `${msg.length} / 360`;
  $('[data-notif-title]').textContent = modal.templates[modal.level][1];
  $('[data-notif-msg]').textContent = msg;
}

async function sendAlert(btn) {
  const d = state.detail;
  const poly = scalePolygon(modal.base, modal.scale);
  btn.disabled = true;
  try {
    await api('/api/alerts', {
      method: 'POST',
      body: {
        incident_id: d.id,
        level: modal.templates[modal.level][0],
        title: modal.templates[modal.level][1],
        message: $('[data-msg]').value.trim(),
        polygon: poly,
        residents_est: residentsFor(poly),
        channels: $$('[data-channel]').filter((c) => c.checked).map((c) => c.dataset.channel),
        approved_by: 'Duty supervisor',
      },
    });
    $('[data-modal]').hidden = true;
    toast(`Alert sent to ~${residentsFor(poly).toLocaleString()} residents in the zone.`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Refresh loop ----------

async function refresh() {
  try {
    state.data = await api('/api/state');
  } catch {
    return;
  }
  renderStats();
  renderUrgent();
  renderIncidents();
  drawMap();
  if (state.selected) {
    if (!state.data.incidents.some((i) => i.id === state.selected)) closeDetail();
    else loadDetail();
  }
}

let refreshTimer = null;
const scheduleRefresh = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 250);
};

function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = scheduleRefresh;
  es.onerror = () => {}; // EventSource reconnects on its own
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  $('[data-action="theme"]').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 16);
  tiles.setUrl(TILE(theme));
  modal.tiles?.setUrl(TILE(theme));
  try { localStorage.setItem('responder-theme', theme); } catch {}
  drawMap();
}

// ---------- Wire up ----------

function init() {
  $$('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon, 16)));
  $('[data-type-filter]').innerHTML += Object.entries(CAT).filter(([k]) => k !== 'smoke').map(([k, v]) => `<option value="${k}">${k === 'fire' ? 'Fire and smoke' : v}</option>`).join('');
  $('[data-legend]').innerHTML =
    Object.entries(CAT).map(([k, v]) => `<span><i style="background:${catColor(k)}"></i>${v}</span>`).join('') +
    Object.entries(CONF).map(([k, v]) => `<span><i style="background:transparent;border:2px solid ${v.c}"></i>${k}</span>`).join('') +
    '<span><i style="background:var(--red)"></i>Urgent help</span>';
  const layerDefs = [['reports', 'Reports'], ['incidents', 'Incidents'], ['urgent', 'Urgent'], ['zones', 'Alert zones']];
  const renderLayers = () => {
    $('[data-layers]').innerHTML = layerDefs.map(([k, l]) => `<button class="layer${state.layers[k] ? ' on' : ''}" data-layer="${k}">${l}</button>`).join('');
  };
  renderLayers();

  let saved = 'dark';
  try { saved = localStorage.getItem('responder-theme') || 'dark'; } catch {}
  setTheme(saved);

  $('[data-search]').addEventListener('input', (e) => { state.filters.q = e.target.value; renderIncidents(); drawMap(); });
  $('[data-type-filter]').addEventListener('change', (e) => { state.filters.type = e.target.value; renderIncidents(); drawMap(); });
  $('[data-conf-filter]').addEventListener('change', (e) => { state.filters.conf = Number(e.target.value); renderIncidents(); drawMap(); });
  $('[data-zone-scale]').addEventListener('input', (e) => { modal.scale = Number(e.target.value) / 100; drawAlertZone(); });
  $('[data-msg]').addEventListener('input', updatePreview);

  document.addEventListener('click', async (e) => {
    const t = e.target;
    const layer = t.closest('[data-layer]');
    if (layer) { state.layers[layer.dataset.layer] = !state.layers[layer.dataset.layer]; renderLayers(); return drawMap(); }
    const lvl = t.closest('[data-level]');
    if (lvl) return setLevel(Number(lvl.dataset.level));
    const urgAct = t.closest('[data-urg-act]');
    if (urgAct) {
      const card = urgAct.closest('[data-urg]');
      const act = urgAct.dataset.urgAct;
      if (act === 'text') return toast('Two-way texting is the next step. For now, assign a responder to follow up.');
      if (act === 'resolved' && !confirm('Mark this person as safe? This removes them from the urgent queue.')) return;
      await api(`/api/help/${card.dataset.urg}/status`, { method: 'POST', body: { status: act } });
      toast(act === 'assigned' ? 'Responder assigned. The resident sees that someone is on it.' : 'Marked safe.');
      return refresh();
    }
    if (t.closest('a[href^="tel:"]')) return;
    const inc = t.closest('[data-inc]');
    if (inc && inc.dataset.inc) return select(inc.dataset.inc);
    const action = t.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const btn = t.closest('[data-action]');
    try {
      if (action === 'theme') setTheme(state.theme === 'dark' ? 'light' : 'dark');
      if (action === 'close-detail') closeDetail();
      if (action === 'close-modal') $('[data-modal]').hidden = true;
      if (action === 'alert') openAlert();
      if (action === 'send-alert') sendAlert(btn);
      if (action === 'confirm') {
        state.detail = await api(`/api/incidents/${state.selected}/confirm`, { method: 'POST' });
        renderDetail();
        toast('Confirmed. Residents who reported it see that a person reviewed it.');
      }
      if (action === 'dispatch') {
        const unit = prompt('Hand off to which unit or agency?', 'Fire Station 35');
        if (!unit) return;
        state.detail = await api(`/api/incidents/${state.selected}/dispatch`, { method: 'POST', body: { unit } });
        renderDetail();
        toast(`Logged hand-off to ${unit}.`);
      }
      if (action === 'resolve') {
        if (!confirm('Mark this incident resolved? It leaves the active list.')) return;
        await api(`/api/incidents/${state.selected}/resolve`, { method: 'POST' });
        closeDetail();
        toast('Incident resolved.');
      }
      if (action === 'replay') {
        await api('/api/demo/replay', { method: 'POST' });
        toast('Replaying a new brush fire near Baldwin Hills. Watch reports arrive and group together.');
        map.flyTo([34.0085, -118.3505], 14);
      }
      if (action === 'reset') {
        if (!confirm('Clear all reports and reload the demo incidents?')) return;
        await api('/api/demo/reset', { method: 'POST' });
        state.fitted = false;
        closeDetail();
        toast('Demo reset.');
      }
    } catch (err) {
      toast(err.message);
    }
  });

  api('/api/config').then((c) => {
    state.config = c;
    $$('[data-app-name]').forEach((el) => (el.textContent = c.app_name));
    document.title = `${c.app_name} · Responder`;
    const badge = $('[data-ai-badge]');
    badge.textContent = c.ai ? 'AI triage on' : 'AI off · keyword triage';
    badge.classList.toggle('off', !c.ai);
  });

  const clock = () => ($('[data-clock]').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  clock();
  setInterval(clock, 10000);
  setInterval(() => $$('[data-wait]').forEach((el) => (el.textContent = wait(Number(el.dataset.wait)))), 1000);
  setInterval(refresh, 30000); // safety net if the stream drops
  refresh();
  connectStream();
}

init();
