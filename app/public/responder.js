// Flare responder dashboard: live map, urgent queue, incident list, detail
// panel, impact numbers, and the alert preview that waits for a person to approve.
import { icon, paintIcons } from '/icons.js';
import { addBasemap } from '/tiles.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CONF = {
  Unconfirmed: { c: 'var(--gray)', bg: 'var(--gray-soft)', rank: 0 },
  Likely: { c: 'var(--likely)', bg: 'var(--likely-soft)', rank: 1 },
  Confirmed: { c: 'var(--green)', bg: 'var(--green-soft)', rank: 2 },
};
const KIND_ICON = { photo: 'camera', video: 'video', voice: 'microphone', text: 'text', help: 'phone' };
const FLAG_LABEL = { trapped: 'Trapped', hurt: 'Injured', silent: "Can't speak safely" };

const state = {
  config: null,
  data: null,
  impact: null,
  selected: null,
  detail: null,
  filters: { q: '', type: '', conf: 0 },
  layers: { reports: true, incidents: true, urgent: true, zones: true },
  theme: 'dark',
  fitted: false,
  flash: new Set(),
  hover: null,
};

const cats = () => state.config?.profile.categories || [];
const catOf = (key) => cats().find((c) => c.key === key) || { key, label: key || 'Other', color: 'other', icon: 'other' };
const catColor = (key) => `var(--c-${catOf(key).color})`;

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
const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

function toast(msg) {
  const el = $('[data-toast]');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3200);
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
const residentsFor = (poly) => Math.max(100, Math.round((areaM2(poly) / 1e6) * (state.config?.pop_density_per_km2 || 3200) / 100) * 100);

// ---------- Map ----------


const map = L.map('map', { zoomControl: true, attributionControl: true, maxZoom: 16 }).setView([34.06, -118.3], 11);
let tiles = addBasemap(map, 'dark');
const groups = { zones: L.layerGroup().addTo(map), reports: L.layerGroup().addTo(map), incidents: L.layerGroup().addTo(map), urgent: L.layerGroup().addTo(map) };

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function drawZones(visible) {
  groups.zones.clearLayers();
  if (!state.layers.zones) return;
  for (const inc of visible) {
    if (!inc.zone?.polygon || (inc.id !== state.selected && inc.id !== state.hover)) continue;
    const sel = inc.id === state.selected;
    L.polygon(inc.zone.polygon, { color: cssVar('--red'), weight: sel ? 2 : 1, dashArray: '6 6', fillColor: cssVar('--red'), fillOpacity: sel ? 0.12 : 0.06 })
      .bindTooltip(`Suggested alert zone · ~${inc.zone.residents_est.toLocaleString()} people`, { sticky: true })
      .addTo(groups.zones);
  }
}

function drawMap() {
  const d = state.data;
  if (!d) return;
  Object.values(groups).forEach((g) => g.clearLayers());
  const visible = visibleIncidents();
  const visIds = new Set(visible.map((i) => i.id));
  drawZones(visible);

  if (state.layers.reports) {
    for (const inc of visible) {
      for (const p of inc.points) {
        if (p.urgent) continue;
        L.circleMarker([p.lat, p.lng], { radius: 4, weight: 1, color: cssVar('--bg'), fillColor: cssVar(`--c-${catOf(p.category).color}`), fillOpacity: 0.95 })
          .bindTooltip(`<b>${esc(catOf(p.category).label)}</b> · ${time(p.created_at)}<br>${esc(p.title || '')}`)
          .on('click', () => select(inc.id))
          .addTo(groups.reports);
      }
    }
    for (const r of d.pending_reports) {
      L.circleMarker([r.lat, r.lng], { radius: 5, weight: 2, color: cssVar('--faint'), fillOpacity: 0 }).bindTooltip('New report, being checked').addTo(groups.reports);
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
        .on('mouseover', () => { state.hover = inc.id; drawZones(visibleIncidents()); })
        .on('mouseout', () => { state.hover = null; drawZones(visibleIncidents()); })
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

function renderImpact() {
  const m = state.impact;
  if (!m) return;
  const set = (k, v) => ($(`[data-kpi="${k}"]`).textContent = v);
  set('fold', `${m.reports_total} → ${m.incidents_total}`);
  set('fold-sub', m.dedup_pct ? `${m.dedup_pct}% fewer items to triage` : 'Each report is its own incident so far');
  set('dups', m.duplicates_folded);
  set('dups-sub', `${m.with_media_pct}% of reports carry a photo or video`);
  set('triage', m.median_triage_s == null ? '—' : `${m.median_triage_s} s`);
  set('triage-sub', m.ai ? 'Report to category, with Claude' : 'Report to category (keyword mode)');
  set('review', m.median_review_min == null ? '—' : `${m.median_review_min} min`);
  set('review-sub', `${m.reviewed_pct}% of reports seen by a person`);
  if (m.last_alert) {
    set('alert', `~${compact(m.last_alert.residents_est)} of ${compact(m.population)}`);
    set('alert-sub', `Last alert reached ${((m.last_alert.residents_est / m.population) * 100).toFixed(2)}% of ${m.population_label}`);
  } else {
    set('alert', `0 of ${compact(m.population)}`);
    set('alert-sub', `No alerts sent. Zone, not county-wide.`);
  }
  const svg = $('[data-spark]');
  const max = Math.max(1, ...m.per_minute);
  const pts = m.per_minute.map((v, i) => `${(i / (m.per_minute.length - 1)) * 180},${28 - (v / max) * 24 - 2}`).join(' ');
  svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/><polygon points="0,28 ${pts} 180,28" fill="var(--accent-soft)"/>`;
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
        <div class="urg-top"><span class="urg-name">${esc(u.contact_name || 'Resident')}</span><span class="urg-wait num" data-wait="${u.created_at}">${wait(u.created_at)}</span></div>
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
      return `<div class="inc${i.id === state.selected ? ' sel' : ''}${state.flash.has(i.id) ? ' flash' : ''}" data-inc="${i.id}">
        <div class="cat-icon" style="background:${catColor(i.category)}">${icon(catOf(i.category).icon, 20)}</div>
        <div class="inc-main">
          <div class="inc-top"><span class="inc-title">${esc(i.title)}</span><span class="conf" style="color:${c.c};background:${c.bg}">${i.confidence}</span></div>
          <div class="inc-place">${esc(i.place || 'Location from reports')}</div>
          <div class="inc-meta">
            <span>${i.report_count} report${i.report_count === 1 ? '' : 's'}</span>
            ${i.counts.photo ? `<span class="m">${icon('camera', 13)}${i.counts.photo}</span>` : ''}
            ${i.counts.video ? `<span class="m">${icon('video', 13)}${i.counts.video}</span>` : ''}
            ${i.counts.voice ? `<span class="m">${icon('microphone', 13)}${i.counts.voice}</span>` : ''}
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
  if (inc) map.flyTo([inc.lat, inc.lng], Math.min(16, Math.max(map.getZoom(), 14)), { duration: 0.6 });
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
  const noun = state.config?.profile.reporterNoun || 'resident';

  $('[data-detail-body]').innerHTML = `
    <div class="d-head">
      <div class="cat-icon" style="background:${catColor(d.category)}">${icon(catOf(d.category).icon, 20)}</div>
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
        <div class="faint small">Built from ${d.report_count} ${noun} reports. Check the reports before acting.</div>
        ${urgent.map((u) => `<div class="callout"><b>${esc(u.contact_name || 'Someone')}</b> (${(u.flags || []).map((f) => FLAG_LABEL[f].toLowerCase()).join(', ') || 'asked for help'}) is inside this area and asked for help.</div>`).join('')}
      </div>
    </div>

    ${z ? `<div class="d-section">
      <div class="d-label">Suggested alert zone</div>
      <div class="zone-box"><div><b>~${z.residents_est.toLocaleString()} people</b> · ${z.area_km2} km²<div class="faint small">${esc(z.basis)}${z.wind ? ` · wind ${Math.round(z.wind.speed_kmh)} km/h from ${Math.round(z.wind.from_deg)}°` : ''}</div></div></div>
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
      <ul class="tl">${d.events.map((e) => `<li><time class="num">${time(e.created_at)}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>
    </div>`;
  $('[data-action="confirm"]').disabled = d.confirmed;
  $('[data-action="confirm"]').textContent = d.confirmed ? 'Confirmed' : 'Confirm';
}

// ---------- Alert modal ----------

const modal = { map: null, poly: null, base: null, scale: 1, level: 1, templates: [] };

function openAlert() {
  const d = state.detail;
  if (!d) return;
  if (!d.zone?.polygon) return toast('The alert zone is still being calculated. Try again in a moment.');
  modal.base = d.zone.polygon;
  modal.scale = 1;
  modal.templates = d.alert_templates;
  modal.level = Math.min(1, modal.templates.length - 1);
  $('[data-modal-sub]').textContent = `${d.title} · ${d.place || ''} · ${d.confidence}`;
  $('[data-zone-basis]').textContent = `Suggested from report spread. ${d.zone.basis}.`;
  $('[data-zone-scale]').value = 100;
  $('[data-levels]').innerHTML = modal.templates.map((t, i) => `<button data-level="${i}">${esc(t[0])}</button>`).join('');
  $('[data-modal]').hidden = false;
  setLevel(modal.level);
  if (!modal.map) {
    modal.map = L.map('alertmap', { zoomControl: false, attributionControl: true, maxZoom: 16 });
    modal.tiles = addBasemap(modal.map, state.theme);
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
  const n = residentsFor(poly);
  $('[data-residents]').textContent = `~${n.toLocaleString()}`;
  const pop = state.config?.profile.population;
  $('[data-reach-vs]').textContent = pop ? `instead of all ${compact(pop)} in ${state.config.profile.populationLabel}` : '';
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
    toast(`Alert sent to ~${residentsFor(poly).toLocaleString()} people in the zone.`);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Context: weather service warnings ----------

async function refreshContext() {
  try {
    const { nws } = await api('/api/context');
    const band = $('[data-nws]');
    const a = nws?.[0];
    band.hidden = !a;
    if (a) {
      $('[data-nws-event]').textContent = a.event;
      const until = a.expires ? ` · until ${new Date(a.expires).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
      $('[data-nws-text]').textContent = `${a.headline || a.area || ''}${until} · ${a.sender || 'National Weather Service'}${nws.length > 1 ? ` · +${nws.length - 1} more` : ''}`;
    }
  } catch {}
}

// ---------- Refresh loop ----------

async function refresh() {
  try {
    const [data, impact] = await Promise.all([api('/api/state'), api('/api/impact')]);
    state.data = data;
    state.impact = impact;
  } catch {
    return;
  }
  renderStats();
  renderImpact();
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

// New reports briefly light up their incident so the eye catches the change.
function flashIncident(id) {
  state.flash.add(id);
  setTimeout(() => {
    state.flash.delete(id);
    $(`.inc[data-inc="${id}"]`)?.classList.remove('flash');
  }, 2600);
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data);
      if (evt.type === 'report' && evt.incident_id) flashIncident(evt.incident_id);
      if (evt.type === 'reset') { state.fitted = false; state.data = null; loadConfig().then(closeDetail); }
    } catch {}
    scheduleRefresh();
  };
  es.onerror = () => {}; // EventSource reconnects on its own
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  $('[data-action="theme"]').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 16);
  tiles.remove();
  tiles = addBasemap(map, theme);
  if (modal.map) {
    modal.tiles.remove();
    modal.tiles = addBasemap(modal.map, theme);
  }
  try { localStorage.setItem('responder-theme', theme); } catch {}
  drawMap();
}

// ---------- Config: profile, categories, legend ----------

async function loadConfig() {
  const c = await api('/api/config');
  state.config = c;
  $$('[data-app-name]').forEach((el) => (el.textContent = c.app_name));
  $('[data-org]').textContent = c.profile.org;
  document.title = `${c.app_name} · Responder · ${c.profile.name}`;
  const sel = $('[data-profile-select]');
  sel.innerHTML = c.profiles.map((p) => `<option value="${p.key}"${p.key === c.profile.key ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
  const badge = $('[data-ai-badge]');
  badge.textContent = c.ai ? 'AI triage on' : 'AI off · keyword triage';
  badge.classList.toggle('off', !c.ai);
  $('[data-action="replay"]').title = `Replay ${c.profile.replayLabel}, one report at a time`;
  const typeSel = $('[data-type-filter]');
  typeSel.innerHTML = '<option value="">All types</option>' + c.profile.categories.filter((k) => k.key !== 'smoke').map((k) => `<option value="${k.key}">${k.key === 'fire' && c.profile.categories.some((x) => x.key === 'smoke') ? 'Fire and smoke' : esc(k.label)}</option>`).join('');
  state.filters.type = '';
  $('[data-legend]').innerHTML =
    c.profile.categories.map((k) => `<span><i style="background:${catColor(k.key)}"></i>${esc(k.label)}</span>`).join('') +
    Object.entries(CONF).map(([k, v]) => `<span><i style="background:transparent;border:2px solid ${v.c}"></i>${k}</span>`).join('') +
    '<span><i style="background:var(--red)"></i>Urgent help</span>';
  if (!state.fitted) map.setView(c.profile.center, c.profile.zoom, { animate: false });
  refreshContext();
}

// ---------- Wire up ----------

function init() {
  paintIcons();
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
  $('[data-profile-select]').addEventListener('change', async (e) => {
    const key = e.target.value;
    if (!confirm(`Switch this deployment to the ${e.target.selectedOptions[0].textContent} profile? The demo reloads with that scenario.`)) {
      e.target.value = state.config.profile.key;
      return;
    }
    try {
      await api('/api/profile', { method: 'POST', body: { key } });
      state.fitted = false;
      state.data = null;
      closeDetail();
      await loadConfig();
      toast(`Now running as ${state.config.profile.org}.`);
      refresh();
    } catch (err) {
      toast(err.message);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('[data-modal]').hidden) $('[data-modal]').hidden = true;
    else if (state.selected) closeDetail();
  });
  $('[data-modal]').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });

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
      toast(act === 'assigned' ? 'Responder assigned. The person sees that someone is on it.' : 'Marked safe.');
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
        toast('Confirmed. People who reported it see that a person reviewed it.');
      }
      if (action === 'dispatch') {
        const unit = prompt('Hand off to which unit or agency?', 'Engine 12');
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
        const r = await api('/api/demo/replay', { method: 'POST' });
        toast(`Replaying ${r.label}. Watch reports arrive and group together.`);
      }
      if (action === 'reset') {
        if (!confirm('Clear all reports and reload the demo incidents?')) return;
        await api('/api/demo/reset', { method: 'POST' });
        state.fitted = false;
        state.data = null;
        closeDetail();
        toast('Demo reset.');
      }
    } catch (err) {
      toast(err.message);
    }
  });

  const clock = () => ($('[data-clock]').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  clock();
  setInterval(clock, 10000);
  setInterval(() => $$('[data-wait]').forEach((el) => (el.textContent = wait(Number(el.dataset.wait)))), 1000);
  setInterval(refresh, 30000); // safety net if the stream drops
  setInterval(refreshContext, 5 * 60 * 1000);
  loadConfig().then(refresh).catch(refresh);
  connectStream();
}

init();
