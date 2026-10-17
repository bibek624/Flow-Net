// Flare resident app. Plain JS, no build step.
import { icon, paintIcons } from '/icons.js';
import { addBasemap } from '/tiles.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const DEMO_LOCATION = { lat: 34.0224, lng: -118.2851, accuracy: 50, demo: true }; // USC campus

const state = {
  screen: 'home',
  config: null,
  categories: [],
  loc: null,
  address: '',
  chips: new Set(),
  help: { trapped: false, hurt: false, silent: false },
  helpReportId: null,
  lastReportId: null,
  pendingLocalId: null,
  cam: null,
  nearby: [],
  alert: null,
  nws: [],
};

const catOf = (key) => state.categories.find((c) => c.key === key) || { label: key || 'Report', color: 'other', icon: 'other' };

// ---------- Navigation ----------

function go(screen) {
  if (state.screen === 'voice' && screen !== 'voice') voice.reset();
  state.screen = screen;
  for (const s of $$('[data-screen]')) {
    const on = s.dataset.screen === screen;
    s.hidden = !on;
    s.classList.toggle('enter', on);
  }
  window.scrollTo(0, 0);
  if (screen === 'camera') camera.reset();
  if (screen === 'text') setTimeout(() => $('[data-text]').focus(), 50);
  if (screen === 'help') renderHelp();
  if (screen === 'home') setTimeout(() => minimap.refresh(), 50);
}

function toast(msg, ms = 3200) {
  const el = $('[data-toast]');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), ms);
}

// ---------- Location ----------

const accText = () => (state.loc?.accuracy >= 1 ? `accurate to ${Math.round(state.loc.accuracy)} m` : 'GPS location');

function renderLoc() {
  $('[data-loc-pill]').textContent = state.loc ? (state.loc.demo ? 'Demo location' : 'Location on') : 'Finding you…';
  const where = state.address || (state.loc ? `${state.loc.lat.toFixed(4)}, ${state.loc.lng.toFixed(4)}` : '');
  $('[data-loc-line]').textContent = state.loc ? `${where} attached${state.loc.demo ? ' (demo, location is off)' : ''}` : 'Finding your location…';
  $('[data-loc-share]').textContent = state.loc ? `${where} · ${state.loc.demo ? 'demo location' : accText()}` : 'Finding you…';
}

function locate({ fresh = false } = {}) {
  return new Promise((resolve) => {
    if (!fresh && state.loc && !state.loc.demo && Date.now() - state.loc.at < 120000) return resolve(state.loc);
    if (!navigator.geolocation) return resolve(useDemoLocation());
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() };
        renderLoc();
        lookupAddress();
        resolve(state.loc);
      },
      () => resolve(state.loc && !state.loc.demo ? state.loc : useDemoLocation()),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}

function useDemoLocation() {
  state.loc = { ...DEMO_LOCATION, at: Date.now() };
  state.address = 'USC campus';
  renderLoc();
  return state.loc;
}

async function lookupAddress() {
  try {
    const r = await fetch(`/api/geocode?lat=${state.loc.lat}&lng=${state.loc.lng}`);
    const { address } = await r.json();
    if (address) {
      state.address = address;
      renderLoc();
    }
  } catch {}
}

// ---------- Sending ----------

// A report is plain fields plus optional files. Location is captured when the
// person taps Send, so a report saved offline still says where it came from.
async function buildPayload(fields, files = {}) {
  const loc = await locate();
  const out = { fields: { ...fields, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, address: state.address }, files: {} };
  for (const [k, f] of Object.entries(files)) if (f) out.files[k] = { blob: f, name: f.name || k };
  return out;
}

class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function post(payload) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(payload.fields)) if (v !== undefined && v !== null && v !== '') fd.append(k, Array.isArray(v) ? JSON.stringify(v) : v);
  for (const [k, f] of Object.entries(payload.files)) fd.append(k, f.blob, f.name);
  const res = await fetch('/api/reports', { method: 'POST', body: fd });
  if (!res.ok) throw new HttpError((await res.json().catch(() => ({}))).error || `Upload failed (${res.status})`, res.status);
  return (await res.json()).id;
}

const sendReport = async (fields, files) => post(await buildPayload(fields, files));

// No signal or server down: keep the report and send it later. A 4xx means the
// report itself is wrong, so retrying would not help.
const retryable = (err) => !(err instanceof HttpError) || err.status >= 500;

async function submit(button, fields, files) {
  button.disabled = true;
  const label = button.innerHTML;
  button.textContent = 'Sending…';
  let payload;
  try {
    payload = await buildPayload(fields, files);
    const id = await post(payload);
    navigator.vibrate?.(30);
    sent.start(id);
    go('sent');
    return true;
  } catch (err) {
    if (payload && retryable(err)) {
      const localId = await outbox.add(payload);
      sent.queued(localId);
      go('sent');
      return true;
    }
    toast(`${err.message}. Check your connection and tap Send again.`);
    return false;
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

// ---------- Outbox: reports saved on the phone until they can be sent ----------

const outbox = {
  db: null,
  memory: new Map(), // used when IndexedDB is unavailable (private mode)
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('resident-outbox', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('reports', { keyPath: 'localId' });
        req.onsuccess = () => resolve((this.db = req.result));
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    if (!db) return fn(null);
    return new Promise((resolve) => {
      const t = db.transaction('reports', mode);
      const store = t.objectStore('reports');
      const out = fn(store);
      t.oncomplete = () => resolve(out?.result ?? out);
      t.onerror = () => resolve(null);
    });
  },
  async add(payload) {
    const entry = { localId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, savedAt: Date.now(), payload };
    const ok = await this.tx('readwrite', (store) => (store ? store.put(entry) : this.memory.set(entry.localId, entry)));
    if (ok === null) this.memory.set(entry.localId, entry);
    renderOutbox();
    return entry.localId;
  },
  async list() {
    const stored = (await this.tx('readonly', (store) => (store ? store.getAll() : null))) || [];
    return [...stored, ...this.memory.values()].sort((a, b) => a.savedAt - b.savedAt);
  },
  async remove(localId) {
    this.memory.delete(localId);
    await this.tx('readwrite', (store) => store?.delete(localId));
  },
  flushing: false,
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const entry of await this.list()) {
        try {
          const id = await post(entry.payload);
          await this.remove(entry.localId);
          if (state.pendingLocalId === entry.localId && state.screen === 'sent') sent.start(id);
          toast('Saved report sent.');
        } catch (err) {
          if (retryable(err)) break; // still offline, try again later
          await this.remove(entry.localId); // the server will never accept this one
        }
      }
    } finally {
      this.flushing = false;
      renderOutbox();
    }
  },
};

async function renderOutbox() {
  const n = (await outbox.list()).length;
  const el = $('[data-outbox]');
  el.hidden = n === 0;
  $('[data-outbox-text]').textContent = `${n} report${n === 1 ? '' : 's'} saved on this phone. ${navigator.onLine ? 'Tap to send now.' : 'Will send when you have signal.'}`;
}

// ---------- Camera ----------

function downscaleImage(file, maxSide = 1600) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        resolve(blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// Grabs one frame so the AI and the dashboard can see the video without playing it.
function videoFrame(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let done = false;
    const finish = (thumb, duration) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve({ thumb, duration });
    };
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => finish(b ? new File([b], 'frame.jpg', { type: 'image/jpeg' }) : null, v.duration), 'image/jpeg', 0.8);
    };
    v.onerror = () => finish(null, null);
    setTimeout(() => finish(null, v.duration || null), 5000);
    v.src = url;
    v.load();
  });
}

const camera = {
  reset() {
    state.cam = null;
    const preview = $('[data-cam-preview]');
    $$('img, video', preview).forEach((n) => n.remove());
    $('[data-cam-empty]').hidden = false;
    $('[data-cam-pick]').hidden = false;
    $('[data-cam-send]').hidden = true;
    $('[data-cam-caption]').value = '';
    $('[data-cam-label]').textContent = 'Camera';
    $$('[data-cam-input]').forEach((i) => (i.value = ''));
  },
  async pick(kind, file) {
    if (!file) return;
    const preview = $('[data-cam-preview]');
    $('[data-cam-empty]').hidden = true;
    $('[data-cam-pick]').hidden = true;
    $('[data-cam-send]').hidden = false;
    $('[data-cam-label]').textContent = kind === 'photo' ? 'Photo' : 'Video';
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind === 'photo' ? 'img' : 'video');
    el.src = url;
    if (kind === 'video') Object.assign(el, { controls: true, playsInline: true, muted: true });
    preview.append(el);
    if (kind === 'photo') {
      state.cam = { kind, media: await downscaleImage(file) };
    } else {
      if (file.size > 80 * 1024 * 1024) toast('This video is large and may take a while to send. Shorter clips upload faster.');
      const { thumb, duration } = await videoFrame(file);
      state.cam = { kind, media: file, thumb, duration };
    }
  },
};

// ---------- Voice ----------

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

const voice = {
  recorder: null, chunks: [], stream: null, ctx: null, analyser: null, rec: null,
  startedAt: 0, timer: null, raf: null, blob: null, duration: 0, finalText: '', recording: false,

  setUI() {
    const rec = this.recording;
    $('[data-mic-pulse]').hidden = !rec;
    $('[data-mic-icon]').hidden = rec;
    $('[data-mic-stop]').hidden = !rec;
    const ready = !rec && (this.blob || $('[data-transcript]').value.trim());
    $('[data-voice-hint]').textContent = rec ? 'Tap to stop' : this.blob ? 'Edit the words if needed, then send' : 'Tap to start';
    const actions = $('[data-voice-actions]');
    actions.style.opacity = ready ? 1 : 0.35;
    actions.style.pointerEvents = ready ? 'auto' : 'none';
    $('[data-transcript-label]').textContent = rec || !this.blob ? 'Live transcript' : 'Transcript (you can edit it)';
  },

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast('Microphone is off. Allow it in Settings, or use Text instead.');
      return;
    }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    this.chunks = [];
    this.blob = null;
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.onstop = () => {
      this.blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/mp4' });
      this.setUI();
    };
    this.recorder.start(250);
    this.recording = true;
    this.startedAt = Date.now();
    this.finalText = '';
    $('[data-transcript]').value = '';
    this.timer = setInterval(() => {
      const t = (Date.now() - this.startedAt) / 1000;
      $('[data-voice-time]').textContent = fmt(t);
      if (t >= 90) this.stop();
    }, 200);
    this.meter();
    this.listen();
    this.setUI();
  },

  meter() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;
      src.connect(this.analyser);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const bars = $$('[data-bars] span');
      const tick = () => {
        this.analyser.getByteFrequencyData(data);
        bars.forEach((b, i) => {
          const v = data[(i % (data.length - 2)) + 1] / 255;
          b.style.height = `${4 + Math.round(v * 50)}px`;
          b.style.opacity = 0.45 + v * 0.55;
        });
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
  },

  // Live words on screen where the browser supports it. iOS Safari does.
  listen() {
    if (!SpeechRec) {
      $('[data-transcript]').placeholder = 'Live words are not supported on this browser. Your recording will still be sent. You can type a short note here.';
      return;
    }
    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript.trim() + ' ';
        else interim += r[0].transcript;
      }
      $('[data-transcript]').value = (this.finalText + interim).trim();
    };
    rec.onend = () => { if (this.recording) try { rec.start(); } catch {} };
    rec.onerror = () => {};
    try { rec.start(); this.rec = rec; } catch {}
  },

  stop() {
    if (!this.recording) return;
    this.recording = false;
    this.duration = (Date.now() - this.startedAt) / 1000;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    try { this.rec?.stop(); } catch {}
    try { this.recorder?.stop(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close?.();
    $$('[data-bars] span').forEach((b) => { b.style.height = '4px'; b.style.opacity = 0.45; });
    this.setUI();
  },

  reset() {
    // Throw away a recording in progress: its late "stopped" event must not bring it back.
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
    }
    this.stop();
    this.recorder = null;
    this.blob = null;
    this.finalText = '';
    $('[data-transcript]').value = '';
    $('[data-voice-time]').textContent = '0:00';
    this.setUI();
  },
};

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ---------- Sent screen: status that checks in as the system confirms ----------

const sent = {
  poll: null,
  queued(localId) {
    state.pendingLocalId = localId;
    clearInterval(this.poll);
    $('[data-sent-title]').textContent = 'Saved on your phone.';
    $('[data-sent-lead]').textContent = "No signal right now. It sends by itself as soon as you're back online. If you are in danger, call 911.";
    const steps = Object.fromEntries($$('[data-step]').map((s) => [s.dataset.step, s]));
    for (const s of Object.values(steps)) s.className = 'step';
    steps.sent.classList.add('active');
    $('[data-sent-time]').textContent = 'Waiting for signal';
    $('[data-sent-loc]').textContent = state.address || (state.loc ? `${state.loc.lat.toFixed(4)}, ${state.loc.lng.toFixed(4)}` : '');
    steps.loc.classList.add('done');
    $('[data-sent-type]').hidden = true;
    $('[data-sent-type-wait]').hidden = false;
    $('[data-sent-type-wait]').textContent = 'After it sends';
    $('[data-sent-nearby]').textContent = 'Matching with nearby reports';
    $('[data-sent-nearby-sub]').textContent = '';
    $('[data-sent-review]').textContent = 'After it sends';
  },
  start(id) {
    state.lastReportId = id;
    state.pendingLocalId = null;
    clearInterval(this.poll);
    $('[data-sent-title]').textContent = 'Got it.';
    $('[data-sent-lead]').textContent = 'Your report is helping confirm this.';
    const steps = Object.fromEntries($$('[data-step]').map((s) => [s.dataset.step, s]));
    for (const s of Object.values(steps)) s.className = 'step';
    steps.sent.classList.add('done');
    $('[data-sent-time]').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    $('[data-sent-loc]').textContent = `${state.address || `${state.loc.lat.toFixed(4)}, ${state.loc.lng.toFixed(4)}`}${state.loc.demo ? ' (demo)' : ` · ${accText()}`}`;
    steps.loc.classList.add('done');
    steps.type.classList.add('active');
    $('[data-sent-type]').hidden = true;
    $('[data-sent-type-wait]').hidden = false;
    $('[data-sent-type-wait]').textContent = 'Checking…';
    $('[data-sent-nearby]').textContent = 'Matching with nearby reports';
    $('[data-sent-nearby-sub]').textContent = '';
    $('[data-sent-review]').textContent = 'Waiting for a responder';
    const startedAt = Date.now();
    const check = async () => {
      if (Date.now() - startedAt > 15 * 60 * 1000) return clearInterval(this.poll);
      try {
        const data = await (await fetch(`/api/reports/${id}`)).json();
        const r = data.report;
        if (r.status === 'triaged') {
          steps.type.className = 'step done';
          $('[data-sent-type-wait]').hidden = true;
          const tag = $('[data-sent-type]');
          tag.hidden = false;
          tag.textContent = data.incident?.title || catOf(r.category).label;
        }
        if (data.incident) {
          steps.nearby.className = 'step done';
          $('[data-sent-nearby]').textContent =
            data.others_nearby > 0 ? `${data.others_nearby} other${data.others_nearby === 1 ? '' : 's'} reported this nearby` : 'First report of this nearby';
          $('[data-sent-nearby-sub]').textContent =
            data.incident.confidence === 'Confirmed' ? 'Part of a confirmed incident' : data.others_nearby > 0 ? `Responders see it as ${data.incident.confidence.toLowerCase()}` : 'Responders can see it on their map';
          steps.review.classList.add(r.reviewed ? 'done' : 'active');
        }
        if (r.reviewed) {
          steps.review.className = 'step done';
          $('[data-sent-review]').textContent = 'A responder has seen this';
          clearInterval(this.poll);
        }
      } catch {}
    };
    check();
    this.poll = setInterval(check, 2000);
  },
};

// ---------- Help ----------

function renderHelp() {
  const silent = state.help.silent;
  $('[data-connect-title]').textContent = silent ? 'Text with a responder' : 'Connect me to a person';
  $('[data-connect-sub]').textContent = silent ? 'Silent. No call or sound.' : 'A responder sees you on the map';
  $('[data-connect-icon]').innerHTML = icon(silent ? 'text' : 'user', 28);
  const defs = state.config?.profile.helpFlags || [['trapped', "I'm trapped"], ['hurt', 'Someone is hurt'], ['silent', "I can't speak safely"]];
  const box = $('[data-toggles]');
  box.innerHTML = '';
  for (const [k, label] of defs) {
    const row = document.createElement('button');
    row.className = `toggle-row${state.help[k] ? ' on' : ''}`;
    row.innerHTML = `<span>${esc(label)}</span><span class="switch"></span>`;
    row.onclick = () => {
      state.help[k] = !state.help[k];
      renderHelp();
    };
    box.append(row);
  }
  const sharing = Boolean(state.helpReportId);
  $('.live-dot:not(.small)').classList.toggle('on', sharing);
  $('.sharing-title').textContent = sharing ? 'Sharing your location with responders' : 'Your location is sent when you ask for help';
}

const helpPoll = { t: null };
async function sendHelp(button) {
  const flags = Object.entries(state.help).filter(([, v]) => v).map(([k]) => k);
  const labels = Object.fromEntries(state.config?.profile.helpFlags || []);
  const text = flags.map((f) => labels[f]).filter(Boolean).join('. ');
  button.disabled = true;
  try {
    const id = await sendReport({ kind: 'help', flags, text: text || 'Asked to be connected to a responder.' });
    state.helpReportId = id;
    renderHelp();
    const box = $('[data-help-status]');
    box.hidden = false;
    $('[data-silent-box]').hidden = !state.help.silent;
    $('[data-help-status-title]').textContent = 'Request sent';
    const started = Date.now();
    clearInterval(helpPoll.t);
    const check = async () => {
      const mins = Math.floor((Date.now() - started) / 60000);
      try {
        const { report } = await (await fetch(`/api/reports/${id}`)).json();
        if (report.help_status === 'assigned') {
          $('[data-help-status-title]').textContent = 'A responder is on it';
          $('[data-help-status-sub]').textContent = state.help.silent ? 'Stay where you are if it is safe. Keep this screen open.' : 'Keep your phone nearby.';
        } else if (report.help_status === 'resolved') {
          $('[data-help-status-title]').textContent = 'Marked resolved by a responder';
          $('[data-help-status-sub]').textContent = `If you still need help, call ${emergencyNumber()}.`;
          clearInterval(helpPoll.t);
        } else {
          $('[data-help-status-sub]').textContent = `Responders can see you on their map. Waiting ${mins < 1 ? 'under a minute' : `${mins} min`}. If you are in danger right now, call ${emergencyNumber()}.`;
        }
      } catch {}
    };
    check();
    helpPoll.t = setInterval(check, 3000);
  } catch (err) {
    toast(retryable(err) ? `No connection. Call ${emergencyNumber()} now if you can. Your request was not sent.` : `${err.message}. Call ${emergencyNumber()} if you can.`);
  } finally {
    button.disabled = false;
  }
}

const emergencyNumber = () => state.config?.profile.emergencyNumber || '911';

// ---------- Situation: alerts, nearby incidents, weather warnings ----------

const distText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1609.34).toFixed(1)} mi`);

async function checkSituation() {
  if (!state.loc) return;
  const q = `lat=${state.loc.lat}&lng=${state.loc.lng}`;
  const [alerts, nearby, context] = await Promise.all([
    fetch(`/api/alerts/active?${q}`).then((r) => r.json()).catch(() => null),
    fetch(`/api/nearby?${q}&radius_km=8`).then((r) => r.json()).catch(() => null),
    fetch(`/api/context?${q}`).then((r) => r.json()).catch(() => null),
  ]);
  if (alerts) state.alert = alerts.alerts[0] || null;
  if (nearby) state.nearby = nearby.incidents;
  if (context) state.nws = context.nws || [];
  renderSituation();
}

function renderSituation() {
  // Alert banner
  const a = state.alert;
  const banner = $('[data-alert]');
  banner.hidden = !a;
  if (a) {
    $('[data-alert-level]').textContent = `${a.level} · ${new Date(a.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    $('[data-alert-title]').textContent = a.title;
    $('[data-alert-msg]').textContent = a.message;
  }

  // Status strip and page tint
  const near = state.nearby;
  const inZone = near.find((i) => i.in_zone);
  const closest = near[0];
  const level = a || inZone ? 'danger' : near.length ? 'watch' : 'calm';
  const strip = $('[data-strip]');
  strip.dataset.level = level;
  $('#app').dataset.threat = level === 'calm' ? 'none' : level;
  const dot = $('[data-strip-dot]');
  dot.className = `live-dot small ${level === 'danger' ? 'on' : 'green'}`;
  if (level === 'danger') {
    $('[data-strip-label]').textContent = a ? 'Alert for your location' : 'You are in an incident area';
    $('[data-strip-title]').textContent = a ? a.title : `${inZone.title} · ${distText(inZone.distance_m)} away`;
    $('[data-strip-sub]').textContent = a ? 'Follow the alert above. Report what you see if it is safe.' : `${inZone.report_count} people have reported this. Responders can see it. Report what you see if it is safe.`;
  } else if (level === 'watch') {
    $('[data-strip-label]').textContent = 'Near you';
    $('[data-strip-title]').textContent = `${near.length} active incident${near.length === 1 ? '' : 's'} within 5 mi`;
    $('[data-strip-sub]').textContent = `Closest: ${closest.title}, ${distText(closest.distance_m)} away, ${closest.report_count} report${closest.report_count === 1 ? '' : 's'}.`;
  } else {
    $('[data-strip-label]').textContent = 'Near you';
    $('[data-strip-title]').textContent = 'All quiet within 5 mi';
    $('[data-strip-sub]').textContent = 'No active incidents reported near you right now.';
  }
  const nws = state.nws[0];
  $('[data-strip-nws]').hidden = !nws;
  if (nws) {
    const until = nws.expires ? ` until ${new Date(nws.expires).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
    $('[data-strip-nws-text]').textContent = `${nws.event}${until} · National Weather Service`;
  }

  // Near-you list
  const box = $('[data-nearby]');
  box.hidden = near.length === 0;
  $('[data-note]').hidden = near.length > 0;
  $('[data-nearby-list]').innerHTML = near
    .slice(0, 3)
    .map((i) => `<div class="near-row"><span class="near-icon" style="background:var(--c-${esc(i.color || 'other')})">${icon(i.icon || 'other', 20)}</span>
      <div class="near-main"><div class="near-title">${esc(i.title)}${i.in_zone ? '<span class="near-zone">You are in the area</span>' : ''}</div>
      <div class="near-sub">${i.report_count} report${i.report_count === 1 ? '' : 's'} · ${esc(i.confidence)}</div></div>
      <div class="near-dist">${distText(i.distance_m)}</div></div>`)
    .join('');

  minimap.render();
}

// A small live map on the home screen: you, and what is happening around you.
const minimap = {
  map: null, layer: null, you: null,
  ensure() {
    if (this.map || !window.L || !state.loc) return;
    this.map = L.map('minimap', { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, tap: false });
    const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
    this.tiles = addBasemap(this.map, dark ? 'dark' : 'light');
    this.layer = L.layerGroup().addTo(this.map);
    this.you = L.marker([state.loc.lat, state.loc.lng], { icon: L.divIcon({ className: '', html: '<div class="minimap-you"></div>', iconSize: [16, 16] }), interactive: false }).addTo(this.map);
  },
  render() {
    const box = $('[data-minimap]');
    const show = Boolean(state.loc) && state.nearby.length > 0;
    box.hidden = !show;
    if (!show) return;
    this.ensure();
    if (!this.map) return;
    this.layer.clearLayers();
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const pts = [[state.loc.lat, state.loc.lng]];
    for (const i of state.nearby) {
      if (i.zone) L.polygon(i.zone, { color: css('--red'), weight: 1, dashArray: '4 4', fillColor: css('--red'), fillOpacity: i.in_zone ? 0.12 : 0.06, interactive: false }).addTo(this.layer);
      L.circleMarker([i.lat, i.lng], { radius: 7 + Math.min(i.report_count, 20) * 0.35, weight: 2, color: '#fff', fillColor: css(`--c-${i.color || 'other'}`), fillOpacity: 0.95, interactive: false }).addTo(this.layer);
      pts.push([i.lat, i.lng]);
    }
    this.you.setLatLng([state.loc.lat, state.loc.lng]);
    this.map.fitBounds(L.latLngBounds(pts).pad(0.35), { animate: false, maxZoom: 14 });
    setTimeout(() => this.map.invalidateSize(), 30);
  },
  refresh() {
    if (this.map) { this.map.invalidateSize(); this.render(); }
  },
  retheme() {
    if (!this.map) return;
    this.map.remove();
    this.map = null;
    this.render();
  },
};

// ---------- Theme: system, light, or dark ----------

function currentTheme() {
  try { return localStorage.getItem('resident-theme') || 'system'; } catch { return 'system'; }
}

function applyTheme(theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try { theme === 'system' ? localStorage.removeItem('resident-theme') : localStorage.setItem('resident-theme', theme); } catch {}
  $('[data-theme-icon]').innerHTML = icon(theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'auto', 18);
  $('[data-action="theme"]').setAttribute('aria-label', `Theme: ${theme}. Tap to change.`);
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const m of $$('meta[name="theme-color"]')) m.setAttribute('content', dark ? '#0D0F13' : '#F5F4F1');
  minimap.retheme();
}

// ---------- Config: what this deployment lets people report ----------

function applyConfig(c) {
  state.config = c;
  state.categories = c.profile.categories;
  $$('[data-app-name]').forEach((el) => (el.textContent = c.app_name));
  $('[data-org]').textContent = c.profile.org;
  document.title = `${c.app_name} · Report what you see`;
  $('[data-emergency-number]').textContent = c.profile.emergencyNumber;
  $('[data-call]').href = `tel:${c.profile.emergencyNumber}`;
  const chipBox = $('[data-chips]');
  chipBox.innerHTML = '';
  for (const cat of state.categories) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `${icon(cat.icon, 18)}<span>${esc(cat.label)}</span>`;
    b.onclick = () => {
      state.chips.has(cat.label) ? state.chips.delete(cat.label) : state.chips.add(cat.label);
      b.classList.toggle('on', state.chips.has(cat.label));
    };
    chipBox.append(b);
  }
}

// ---------- Wire up ----------

function init() {
  paintIcons();
  $('[data-bars]').innerHTML = '<span></span>'.repeat(32);

  document.addEventListener('click', (e) => {
    const goEl = e.target.closest('[data-go]');
    if (goEl) return go(goEl.dataset.go);
    const act = e.target.closest('[data-action]')?.dataset.action;
    if (!act) return;
    const btn = e.target.closest('[data-action]');
    if (act === 'theme') {
      const next = { system: 'light', light: 'dark', dark: 'system' }[currentTheme()];
      applyTheme(next);
      return toast(next === 'system' ? 'Theme follows your phone' : `${next[0].toUpperCase()}${next.slice(1)} theme`, 1400);
    }
    if (act === 'flush-outbox') {
      toast(navigator.onLine ? 'Sending…' : 'Still offline. It will send when you have signal.', 1800);
      return outbox.flush();
    }
    if (act === 'relocate') locate({ fresh: true }).then(() => { toast(state.loc.demo ? 'Location is off. Using a demo location.' : 'Location updated.'); checkSituation(); });
    if (act === 'cam-retake') camera.reset();
    if (act === 'cam-send') {
      if (!state.cam) return toast('Still preparing the file. Try again in a second.');
      submit(btn, { kind: state.cam.kind, text: $('[data-cam-caption]').value.trim(), duration: state.cam.duration }, { media: state.cam.media, thumb: state.cam.thumb });
    }
    if (act === 'voice-toggle') voice.recording ? voice.stop() : voice.start();
    if (act === 'voice-redo') voice.reset();
    if (act === 'voice-cancel') { voice.reset(); go('home'); }
    if (act === 'voice-send') {
      const transcript = $('[data-transcript]').value.trim();
      if (!voice.blob && !transcript) return;
      const ext = voice.blob?.type.includes('webm') ? 'webm' : 'm4a';
      const media = voice.blob ? new File([voice.blob], `voice.${ext}`, { type: voice.blob.type.split(';')[0] }) : null;
      submit(btn, { kind: 'voice', transcript, duration: Math.round(voice.duration) }, { media }).then((ok) => ok && voice.reset());
    }
    if (act === 'text-send') {
      const text = $('[data-text]').value.trim();
      if (!text && !state.chips.size) return toast('Type what you see, or tap a chip.');
      submit(btn, { kind: 'text', text, chips: [...state.chips] }).then((ok) => {
        if (!ok) return;
        $('[data-text]').value = '';
        state.chips.clear();
        $$('.chip').forEach((c) => c.classList.remove('on'));
      });
    }
    if (act === 'help-send') sendHelp(btn);
    if (act === 'silent-send') {
      const text = $('[data-silent-text]').value.trim();
      if (!text) return;
      sendReport({ kind: 'text', text: `[Silent help request] ${text}` })
        .then(() => { $('[data-silent-text]').value = ''; toast('Sent. A responder will see it.'); })
        .catch(() => toast('Could not send. Try again.'));
    }
  });

  $('[data-transcript]').addEventListener('input', () => voice.setUI());
  for (const input of $$('[data-cam-input]')) input.addEventListener('change', () => camera.pick(input.dataset.camInput, input.files[0]));

  applyTheme(currentTheme());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(currentTheme()));

  fetch('/api/config').then((r) => r.json()).then(applyConfig).catch(() => {});
  locate().then(checkSituation);
  setInterval(checkSituation, 12000);
  window.addEventListener('online', () => outbox.flush());
  window.addEventListener('offline', renderOutbox);
  setInterval(() => outbox.flush(), 20000);
  renderOutbox().then(() => outbox.flush());
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  voice.setUI();
}

init();
