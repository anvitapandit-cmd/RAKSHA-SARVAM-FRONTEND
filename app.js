/* Raksha frontend. Plain JavaScript, no build step. */
// When index.html is opened straight from disk, talk to the local backend.
const API = location.protocol === 'file:' ? 'http://localhost:8000' : '';
const $ = (s, e = document) => e.querySelector(s);
const $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const r = await fetch(API + path, opts);
  let data = null;
  try { data = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok) {
    const d = data && (data.detail || data.message);
    throw new Error(typeof d === 'string' ? d : (d ? JSON.stringify(d) : r.statusText));
  }
  return data;
}
const jsend = (p, body, method = 'POST') =>
  api(p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const LEVEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const STATUS = { new: 'Unverified', verified: 'Verified by a human', false_alarm: 'Marked false alarm', resolved: 'Resolved' };
const LANGNAME = { en: 'English', hi: 'हिन्दी', mr: 'मराठी' };
const INCIDENT_LABELS = {
  flood: 'Flood / waterlogging', fire: 'Fire', landslide: 'Landslide / mudslide', collapse: 'Building / wall collapse',
  medical: 'Medical emergency', electrical: 'Electrical hazard', tree_road: 'Fallen tree / road blocked',
  earthquake: 'Earthquake', other: 'Unclassified emergency'
};

const state = { sarvam: false, gps: null, recBlob: null, selected: null, fitted: false, lastSitrep: null, current: null };

const lvlTag = l => `<span class="tag lvl-${l}">${LEVEL[l] || l}</span>`;
function ago(ts) {
  const m = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} d ago`;
}

/* ---------------- status ---------------- */
async function checkHealth() {
  try {
    const h = await api('/api/health');
    state.sarvam = h.sarvam;
    $('#status .dot').classList.toggle('on', h.sarvam);
    $('#status-text').textContent = h.sarvam ? 'Sarvam AI connected' : 'Offline mode · add SARVAM_API_KEY for voice';
  } catch (e) {
    $('#status-text').textContent = 'Backend not reachable';
  }
}

/* ---------------- tabs ---------------- */
function showTab(name) {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  if (name === 'center') {
    initMap();
    loadCenter();
    setTimeout(() => state.map && state.map.invalidateSize(), 120);
  }
  window.scrollTo({ top: 0 });
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

/* ---------------- speech output ---------------- */
let currentAudio = null;
async function speak(text, lang, btn) {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (btn) btn.disabled = true;
  try {
    const j = await jsend('/api/tts', { text, lang });
    if (j.audio) {
      currentAudio = new Audio('data:audio/wav;base64,' + j.audio);
      await currentAudio.play();
      return;
    }
  } catch (e) { /* fall through to browser voice */ }
  finally { if (btn) btn.disabled = false; }
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' }[lang] || 'en-IN';
    speechSynthesis.speak(u);
  }
}

/* ---------------- recorder + WAV encoding ---------------- */
class Recorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.rec = new MediaRecorder(this.stream);
    this.chunks = [];
    this.rec.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.rec.start();
    this.t0 = Date.now();
  }
  stop() {
    return new Promise((resolve, reject) => {
      this.rec.onstop = async () => {
        this.stream.getTracks().forEach(t => t.stop());
        try {
          const blob = new Blob(this.chunks, { type: this.rec.mimeType || 'audio/webm' });
          resolve(await toWav(blob));
        } catch (e) { reject(e); }
      };
      this.rec.stop();
    });
  }
}
async function toWav(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const audio = await ctx.decodeAudioData(buf);
  ctx.close();
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * 16000)), 16000);
  const src = off.createBufferSource();
  src.buffer = audio; src.connect(off.destination); src.start();
  const rendered = await off.startRendering();
  const pcm = rendered.getChannelData(0);
  return { blob: encodeWav(pcm, 16000), seconds: Math.round(audio.duration) };
}
function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([v], { type: 'audio/wav' });
}

/* ---------------- REPORT tab ---------------- */
const SAMPLES = [
  { label: 'मराठी · पूर', lang: 'mr', text: 'कर्वे रोडवर खूप पाणी शिरले आहे, तळमजल्यावरील घरांमध्ये पाणी घुसले आहे. ५ जण अडकले आहेत, लहान मुले पण आहेत. तातडीने मदत हवी आहे.' },
  { label: 'हिन्दी · आग', lang: 'hi', text: 'वाकड में एक गोदाम में आग लग गई है, बहुत धुआं फैल रहा है, दो लोग अंदर फंसे हैं। कृपया जल्दी मदद भेजिए।' },
  { label: 'English · collapse', lang: 'en', text: 'A wall collapsed near Katraj, two people are buried under the rubble and one is bleeding. We need an ambulance urgently.' },
  { label: 'Vague · needs follow-up', lang: 'en', text: 'Water is coming into our house, please help quickly.' },
  { label: 'हिन्दी · vague', lang: 'hi', text: 'हमारे इलाके में पानी भर रहा है, मदद चाहिए।' }
];
$('#sample-chips').innerHTML = SAMPLES.map((s, i) => `<button class="chip" data-i="${i}" type="button">${esc(s.label)}</button>`).join('');
$('#sample-chips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  const s = SAMPLES[+b.dataset.i];
  $('#report-text').value = s.text;
  $('#lang').value = s.lang;
});

$('#btn-gps').addEventListener('click', () => {
  if (!navigator.geolocation) { $('#rec-status').textContent = 'Location is not available in this browser.'; return; }
  $('#rec-status').textContent = 'Getting your location…';
  navigator.geolocation.getCurrentPosition(p => {
    state.gps = { lat: p.coords.latitude, lng: p.coords.longitude };
    $('#rec-status').textContent = 'Location attached to this report.';
  }, () => { $('#rec-status').textContent = 'Could not read your location. You can mention the area in words.'; });
});

const rec = new Recorder();
let recording = false;
$('#btn-rec').addEventListener('click', async () => {
  const btn = $('#btn-rec');
  if (!recording) {
    if (!state.sarvam) { $('#rec-status').textContent = 'Voice needs a Sarvam API key. Add it to .env, or type your report.'; return; }
    try {
      await rec.start();
      recording = true; state.recBlob = null;
      btn.classList.add('recording'); $('#rec-label').textContent = 'Stop recording';
      $('#rec-status').textContent = 'Listening… speak in Marathi, Hindi or English.';
    } catch (e) { $('#rec-status').textContent = 'Microphone blocked. Allow mic access (works on localhost or https).'; }
  } else {
    recording = false;
    btn.classList.remove('recording'); $('#rec-label').textContent = 'Record again';
    $('#rec-status').textContent = 'Processing audio…';
    try {
      const r = await rec.stop();
      state.recBlob = r.blob;
      $('#rec-status').textContent = `Voice note ready (${r.seconds}s). Press Submit to transcribe and analyse.`;
    } catch (e) { $('#rec-status').textContent = 'Could not process the recording. Try again or type.'; }
  }
});

$('#submit-report').addEventListener('click', submitReport);
async function submitReport() {
  const text = $('#report-text').value.trim();
  if (!text && !state.recBlob) { $('#submit-msg').textContent = 'Type or record a report first.'; return; }
  const fd = new FormData();
  fd.append('text', text);
  fd.append('lang', $('#lang').value);
  if (state.recBlob) fd.append('audio', state.recBlob, 'report.wav');
  if (state.gps) { fd.append('lat', state.gps.lat); fd.append('lng', state.gps.lng); }
  const btn = $('#submit-report');
  btn.disabled = true; $('#submit-msg').textContent = 'Analysing…';
  try {
    const r = await api('/api/reports', { method: 'POST', body: fd });
    $('#submit-msg').textContent = '';
    state.recBlob = null; state.gps = null;
    $('#rec-status').textContent = ''; $('#rec-label').textContent = 'Record voice';
    $('#report-text').value = '';
    state.current = r;
    renderResult(r);
  } catch (e) {
    $('#submit-msg').textContent = e.message;
  } finally { btn.disabled = false; }
}

function renderResult(r) {
  $('#result-empty').hidden = true;
  const body = $('#result-body');
  body.hidden = false;
  const loc = r.location_name && r.loc_conf >= 0.5 ? r.location_name : (r.location_name || 'Not yet known');
  const conf = Math.round((r.confidence || 0) * 100);
  const translated = r.english_text && r.english_text.toLowerCase() !== r.raw_text.toLowerCase()
    ? `<h4>English translation (Sarvam)</h4><blockquote>${esc(r.english_text)}</blockquote>` : '';
  body.innerHTML = `
    <div class="res-head">${lvlTag(r.level)}<h2>${esc(r.incident_label)}</h2></div>
    <p class="mute small" style="margin-top:8px">Report #${r.id} · ${ago(r.created_at)} · ${r.source === 'voice' ? 'voice, transcribed by Sarvam' : 'typed'} · ${LANGNAME[r.lang] || r.lang}</p>
    <div class="kv">
      <div><div class="k">Location</div><div class="v">${esc(loc)}</div></div>
      <div><div class="k">Priority score</div><div class="v">${r.score} / 100</div></div>
      <div><div class="k">People reported affected</div><div class="v">${r.people ?? 'Not stated'}</div></div>
      <div><div class="k">Confidence in extraction</div><div class="v">${conf}%<div class="bar"><i style="width:${conf}%"></i></div></div></div>
    </div>
    <h4>Why this priority</h4>
    <ul class="why">${(r.why || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${r.resource_names && r.resource_names.length ? `<h4>Resources likely needed</h4><div>${r.resource_names.map(x => `<span class="pill">${esc(x)}</span>`).join('')}</div>` : ''}
    ${translated}
    <div class="notice"><strong>${esc(STATUS[r.status])}.</strong> This is an unverified citizen report. Raksha organises it; a person decides what to do.</div>
    ${r.followup_question ? `
      <div class="followup">
        <div class="q">${esc(r.followup_question)}</div>
        <div class="row"><input type="text" id="fu-text" placeholder="Your answer…"><button class="btn" id="fu-send" type="button">Send</button></div>
      </div>` : ''}
    <h4>Reply to the reporter (${LANGNAME[r.reply_lang] || r.reply_lang})</h4>
    <blockquote lang="${esc(r.reply_lang)}">${esc(r.reply_text)}</blockquote>
    <div class="row"><button class="btn ghost" id="btn-play" type="button">Listen to reply</button></div>
  `;
  $('#btn-play').onclick = e => speak(r.reply_text, r.reply_lang, e.target);
  const send = $('#fu-send');
  if (send) {
    const go = async () => {
      const t = $('#fu-text').value.trim(); if (!t) return;
      send.disabled = true;
      try {
        const upd = await jsend(`/api/reports/${r.id}/followup`, { text: t, lang: r.lang });
        state.current = upd; renderResult(upd);
      } catch (e) { send.disabled = false; alert(e.message); }
    };
    send.onclick = go;
    $('#fu-text').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }
}

/* ---------------- CONTROL ROOM ---------------- */
$('#f-incident').insertAdjacentHTML('beforeend',
  Object.entries(INCIDENT_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));
['#f-level', '#f-incident', '#f-status'].forEach(s => $(s).addEventListener('change', loadCenter));

$('#btn-seed').addEventListener('click', async e => {
  e.target.disabled = true;
  try { await api('/api/seed', { method: 'POST' }); state.fitted = false; state.selected = null; await loadCenter(); }
  finally { e.target.disabled = false; }
});
$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('Delete all reports?')) return;
  await api('/api/reset', { method: 'POST' }); state.selected = null; state.fitted = false; hideDetail(); await loadCenter();
});

function initMap() {
  if (state.map) return;
  if (typeof L === 'undefined') {
    $('#map').innerHTML = '<div class="none"><p class="serif big">Map unavailable.</p><p>The map library needs internet access. Reports and everything else still work.</p></div>';
    return;
  }
  state.map = L.map('map', { zoomControl: true }).setView([18.5204, 73.8567], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 19
  }).addTo(state.map);
  state.layer = L.layerGroup().addTo(state.map);
}

function jitter(id) {
  const a = ((id * 9301 + 49297) % 233280) / 233280, b = ((id * 7919 + 1237) % 104729) / 104729;
  return [(a - 0.5) * 0.0026, (b - 0.5) * 0.0026];
}

async function loadCenter() {
  if (!$('#tab-center').classList.contains('active')) return;
  const q = new URLSearchParams();
  if ($('#f-level').value) q.set('level', $('#f-level').value);
  if ($('#f-incident').value) q.set('incident', $('#f-incident').value);
  if ($('#f-status').value) q.set('status', $('#f-status').value);
  let stats, rows;
  try { [stats, rows] = await Promise.all([api('/api/stats'), api('/api/reports?' + q)]); }
  catch (e) { return; }
  renderStats(stats);
  renderList(rows);
  renderMap(rows, stats);
  if (state.selected) {
    const r = rows.find(x => x.id === state.selected);
    if (r) renderDetail(r);
  }
}

function renderStats(s) {
  const cells = [
    [s.active, 'Active reports'], [s.critical, 'Critical'], [s.unverified, 'Awaiting verification'],
    [s.people, 'People reported affected'], [s.hotspots.length, 'Hotspot areas'], [s.incomplete, 'Need follow-up']
  ];
  $('#stats').innerHTML = cells.map(([n, t]) => `<div class="stat"><div class="n">${n}</div><div class="t">${t}</div></div>`).join('');
}

function renderList(rows) {
  const el = $('#list');
  if (!rows.length) {
    el.innerHTML = `<div class="none"><p class="serif big">No reports yet.</p><p>Submit one from the Report tab, or press “Load demo data”.</p></div>`;
    return;
  }
  el.innerHTML = rows.map(r => `
    <div class="item ${r.id === state.selected ? 'sel' : ''}" data-id="${r.id}">
      <div class="t1">${lvlTag(r.level)}<span class="mute small">#${r.id} · score ${r.score} · ${ago(r.created_at)}</span>
        ${r.cluster_size > 1 ? `<span class="tag">×${r.cluster_size} nearby</span>` : ''}
        ${r.missing.length ? `<span class="tag lvl-low">incomplete</span>` : ''}</div>
      <div class="t2">${esc(r.incident_label)}</div>
      <div class="t3">${esc(r.location_name || 'Location unknown')} · ${esc(STATUS[r.status])}</div>
      <div class="t4" lang="${esc(r.lang)}">${esc(r.raw_text)}</div>
    </div>`).join('');
}
$('#list').addEventListener('click', e => {
  const it = e.target.closest('.item'); if (!it) return;
  selectReport(+it.dataset.id);
});

async function selectReport(id) {
  state.selected = id;
  $$('.item').forEach(i => i.classList.toggle('sel', +i.dataset.id === id));
  try { renderDetail(await api('/api/reports/' + id)); } catch (e) { /* ignore */ }
}

function hideDetail() { $('#detail').hidden = true; }

function renderDetail(r) {
  const d = $('#detail');
  d.hidden = false;
  const conf = Math.round((r.confidence || 0) * 100);
  const eng = r.english_text && r.english_text.toLowerCase() !== r.raw_text.toLowerCase()
    ? `<h4>English translation</h4><blockquote>${esc(r.english_text)}</blockquote>` : '';
  const closed = r.status === 'false_alarm' || r.status === 'resolved';
  d.innerHTML = `
    <div class="res-head">${lvlTag(r.level)}<h2>${esc(r.incident_label)}</h2></div>
    <p class="mute small" style="margin-top:6px">Report #${r.id} · ${ago(r.created_at)} · ${r.source === 'voice' ? 'voice' : 'typed'} · ${LANGNAME[r.lang] || r.lang} · ${esc(STATUS[r.status])}</p>
    <div class="kv">
      <div><div class="k">Location</div><div class="v">${esc(r.location_name || 'Unknown')}</div></div>
      <div><div class="k">Priority score</div><div class="v">${r.score} / 100</div></div>
      <div><div class="k">People reported affected</div><div class="v">${r.people ?? 'Not stated'}</div></div>
      <div><div class="k">Confidence · corroboration</div><div class="v">${conf}% · ${r.cluster_size > 1 ? r.cluster_size + ' reports in this cluster' : 'single report'}<div class="bar"><i style="width:${conf}%"></i></div></div></div>
    </div>
    <h4>Original report</h4><blockquote class="orig" lang="${esc(r.lang)}">${esc(r.raw_text)}</blockquote>
    ${eng}
    <h4>Why this priority</h4><ul class="why">${(r.why || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${r.resource_names.length ? `<h4>Resources likely needed</h4><div>${r.resource_names.map(x => `<span class="pill">${esc(x)}</span>`).join('')}</div>` : ''}
    ${r.missing.length ? `<h4>Missing information</h4><div>${r.missing.map(x => `<span class="pill">${esc(x)}</span>`).join('')}</div>` : ''}
    <div class="actions">
      ${r.status !== 'verified' && !closed ? `<button class="btn sm" data-act="verified">Mark verified</button>` : ''}
      ${!closed ? `<button class="btn sm ghost" data-act="false_alarm">False alarm</button><button class="btn sm ghost" data-act="resolved">Resolved</button>` : `<button class="btn sm ghost" data-act="new">Reopen</button>`}
      <button class="btn sm ghost" data-act="listen">Listen to reply sent</button>
    </div>`;
  d.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'listen') return speak(r.reply_text, r.reply_lang, b);
    b.disabled = true;
    await jsend(`/api/reports/${r.id}/status`, { status: b.dataset.act }, 'PATCH');
    await loadCenter();
    try { renderDetail(await api('/api/reports/' + r.id)); } catch (err) { /* ignore */ }
  };
}

function renderMap(rows, stats) {
  if (!state.map) return;
  state.layer.clearLayers();
  const pts = [];
  (stats.hotspots || []).forEach(h => {
    if (h.lat == null) return;
    L.circle([h.lat, h.lng], { radius: 650, color: '#0a0a0a', weight: 1, dashArray: '5 6', fillOpacity: 0.04, interactive: false }).addTo(state.layer);
  });
  const size = { critical: 13, high: 10, medium: 7, low: 5 };
  const fill = { critical: 0.95, high: 0.6, medium: 0.25, low: 0.03 };
  rows.forEach(r => {
    if (r.lat == null || r.loc_conf < 0.5) return;
    const [dy, dx] = jitter(r.id);
    const p = [r.lat + dy, r.lng + dx];
    pts.push(p);
    const m = L.circleMarker(p, {
      radius: size[r.level], color: '#0a0a0a', weight: r.id === state.selected ? 4 : 2,
      fillColor: '#0a0a0a', fillOpacity: fill[r.level]
    }).addTo(state.layer);
    m.bindTooltip(`#${r.id} · ${LEVEL[r.level]} · ${r.incident_label}`);
    m.on('click', () => selectReport(r.id));
  });
  if (pts.length && !state.fitted) {
    state.map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
    state.fitted = true;
  }
}

setInterval(() => { if (!document.hidden) loadCenter(); }, 6000);

/* ---------------- ASSISTANT ---------------- */
const ASK = [
  'Summarise all the flood reports',
  'Which reports need immediate human review?',
  'Where are the hotspots?',
  'What resources are needed?',
  'How many reports are unverified?',
  'कर्वे रोडवर काय परिस्थिती आहे?'
];
$('#ask-chips').innerHTML = ASK.map(q => `<button class="chip" type="button">${esc(q)}</button>`).join('');
$('#ask-chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) ask(b.textContent); });

function addMsg(who, text) {
  const chat = $('#chat');
  chat.insertAdjacentHTML('beforeend', `<div class="msg ${who === 'You' ? 'me' : ''}"><div class="who">${who}</div><div class="body">${esc(text)}</div></div>`);
  chat.scrollTop = chat.scrollHeight;
}
addMsg('Raksha', 'Ask me about the live reports. For example: which reports need immediate review, where the hotspots are, or what resources are needed. You can ask in English, Hindi or Marathi.');

async function ask(q) {
  q = (q || '').trim(); if (!q) return;
  addMsg('You', q);
  $('#ask-text').value = '';
  try {
    const r = await jsend('/api/assistant', { question: q, lang: 'auto' });
    addMsg('Raksha', r.answer);
  } catch (e) { addMsg('Raksha', 'Sorry, something went wrong: ' + e.message); }
}
$('#btn-ask').addEventListener('click', () => ask($('#ask-text').value));
$('#ask-text').addEventListener('keydown', e => { if (e.key === 'Enter') ask($('#ask-text').value); });

const askRec = new Recorder();
let askRecording = false;
$('#btn-ask-mic').addEventListener('click', async e => {
  const btn = e.target;
  if (!askRecording) {
    if (!state.sarvam) { addMsg('Raksha', 'Voice questions need a Sarvam API key in .env. You can type instead.'); return; }
    try { await askRec.start(); askRecording = true; btn.textContent = 'Stop'; btn.classList.add('recording'); }
    catch (err) { addMsg('Raksha', 'Microphone blocked. Allow mic access (works on localhost or https).'); }
  } else {
    askRecording = false; btn.textContent = 'Voice'; btn.classList.remove('recording');
    try {
      const r = await askRec.stop();
      const fd = new FormData(); fd.append('audio', r.blob, 'q.wav'); fd.append('lang', 'auto');
      const t = await api('/api/transcribe', { method: 'POST', body: fd });
      if (t.transcript) ask(t.transcript); else addMsg('Raksha', 'I could not hear anything. Try again.');
    } catch (err) { addMsg('Raksha', 'Could not transcribe: ' + err.message); }
  }
});

/* ---------------- SITREP ---------------- */
$('#btn-sitrep').addEventListener('click', genSitrep);
$('#sitrep-lang').addEventListener('change', () => { if (state.lastSitrep) genSitrep(); });
async function genSitrep() {
  const lang = $('#sitrep-lang').value;
  const s = await api('/api/sitrep?lang=' + lang);
  state.lastSitrep = s;
  const doc = $('#sitrep-doc');
  doc.setAttribute('lang', lang);
  doc.innerHTML = `
    <h2>${esc(s.title)}</h2>
    <p class="meta">Generated ${esc(s.generated)}</p>
    <p class="headline">${esc(s.headline)}</p>
    ${(s.sections || []).map(sec => `<h4>${esc(sec.heading)}</h4><ul>${sec.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
    ${(s.notes || []).map(n => `<p style="margin-top:16px">${esc(n)}</p>`).join('')}
    <p class="disc">${esc(s.disclaimer)}</p>`;
  ['#btn-sitrep-listen', '#btn-sitrep-copy', '#btn-sitrep-print'].forEach(i => $(i).disabled = !!s.empty);
}
$('#btn-sitrep-listen').addEventListener('click', e => state.lastSitrep && speak(state.lastSitrep.speech, state.lastSitrep.lang, e.target));
$('#btn-sitrep-copy').addEventListener('click', async e => {
  if (!state.lastSitrep) return;
  try { await navigator.clipboard.writeText(state.lastSitrep.text); e.target.textContent = 'Copied'; setTimeout(() => e.target.textContent = 'Copy', 1500); } catch (err) { /* ignore */ }
});
$('#btn-sitrep-print').addEventListener('click', () => window.print());

/* ---------------- boot ---------------- */
checkHealth();
setInterval(checkHealth, 30000);
