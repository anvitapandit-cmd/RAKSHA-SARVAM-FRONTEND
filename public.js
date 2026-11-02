/* Raksha: Public View tab.
   Loaded after app.js and reuses its helpers ($, $$, api, jsend, esc, ago, speak, Recorder, state, jitter,
   INCIDENT_LABELS). Read-only: the public can look and ask, never change anything. */
(() => {
  const pub = { map: null, layer: null, data: null, selected: null, fitted: false, hl: new Set(), lastIds: '' };
  const LANG_TIP = () => { const v = $('#p-lang').value; return v === 'auto' ? 'en' : v; };
  const UI = {
    en: { tips: 'What you can do', unver: 'Unverified citizen report. Treat with caution.', ver: 'Verified by a person in the control room.', numbers: 'Emergency numbers' },
    hi: { tips: 'आप क्या कर सकते हैं', unver: 'असत्यापित नागरिक रिपोर्ट। सावधानी रखें।', ver: 'कंट्रोल रूम में एक व्यक्ति ने सत्यापित किया है।', numbers: 'आपातकालीन नंबर' },
    mr: { tips: 'तुम्ही काय करू शकता', unver: 'पडताळणी न झालेला नागरिक अहवाल. सावधगिरी बाळगा.', ver: 'नियंत्रण कक्षातील व्यक्तीने पडताळले आहे.', numbers: 'आपत्कालीन क्रमांक' },
  };

  const statusTag = r => r.verified ? '<span class="tag pv">Verified</span>' : '<span class="tag lvl-low">Unverified</span>';

  /* ---------- map ---------- */
  function initMap() {
    if (pub.map) return;
    const el = $('#pmap');
    if (typeof L === 'undefined') {
      el.innerHTML = '<div class="none"><p class="serif big">Map unavailable.</p><p>The map library needs internet access. The list below still works.</p></div>';
      return;
    }
    pub.map = L.map('pmap', { zoomControl: true }).setView([18.5204, 73.8567], 12);
    L.tileLayer('   https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO', maxZoom: 19
    }).addTo(pub.map);
    pub.layer = L.layerGroup().addTo(pub.map);
  }

  /* ---------- data ---------- */
  async function load() {
    if (!$('#tab-public').classList.contains('active')) return;
    try { pub.data = await api('/api/public'); } catch (e) { return; }
    render();
  }

  function visible() {
    if (!pub.data) return [];
    const inc = $('#p-incident').value, ver = $('#p-verified').value, q = $('#p-search').value.trim().toLowerCase();
    return pub.data.reports.filter(r =>
      (!inc || r.incident === inc) &&
      (!ver || (ver === 'verified' ? r.verified : !r.verified)) &&
      (!q || `${r.area} ${r.text} ${r.english} ${r.incident_label}`.toLowerCase().includes(q)));
  }

  function render() {
    const rows = visible();
    renderStats();
    renderList(rows);
    renderMap(rows);
    if (pub.selected) {
      const r = pub.data.reports.find(x => x.id === pub.selected);
      if (r) renderDetail(r); else { pub.selected = null; $('#pdetail').hidden = true; }
    }
  }

  function renderStats() {
    const s = pub.data.stats;
    const cells = [[s.total, 'Active reports'], [s.verified, 'Verified by a person'], [s.unverified, 'Awaiting verification'], [pub.data.hotspots.length, 'Areas with several reports']];
    $('#p-stats').innerHTML = cells.map(([n, t]) => `<div class="stat"><div class="n">${n}</div><div class="t">${t}</div></div>`).join('');
  }

  function renderList(rows) {
    const el = $('#p-list');
    const keep = el.scrollTop;
    if (!rows.length) {
      el.innerHTML = pub.data.reports.length
        ? `<div class="none"><p class="serif big">Nothing matches these filters.</p></div>`
        : `<div class="none"><p class="serif big">No active reports right now.</p><p>That does not mean everywhere is safe. Follow official updates, and call 112 in an emergency.</p><p class="small" style="margin-top:10px">Demo: load sample data from the Control Room tab.</p></div>`;
      return;
    }
    el.innerHTML = rows.map(r => `
      <div class="item ${r.id === pub.selected ? 'sel' : ''} ${pub.hl.has(r.id) ? 'hl' : ''}" data-id="${r.id}">
        <div class="t1">${statusTag(r)}<span class="mute small">${ago(r.created_at)}</span>
          ${r.cluster_size > 1 ? `<span class="tag">×${r.cluster_size} nearby</span>` : ''}
          ${r.channel === 'voice' ? '<span class="tag lvl-low">voice</span>' : ''}</div>
        <div class="t2">${esc(r.incident_label)}</div>
        <div class="t3">${esc(r.area || 'Location not yet known')}</div>
        <div class="t4" lang="${esc(r.lang)}">${esc(r.text)}</div>
      </div>`).join('');
    el.scrollTop = keep;
  }

  function renderMap(rows) {
    if (!pub.map) return;
    pub.layer.clearLayers();
    (pub.data.hotspots || []).forEach(h => {
      if (h.lat == null) return;
      L.circle([h.lat, h.lng], { radius: 650, color: '#0a0a0a', weight: 1, dashArray: '5 6', fillOpacity: 0.04, interactive: false }).addTo(pub.layer);
    });
    const pts = [], hlPts = [];
    rows.forEach(r => {
      if (r.lat == null) return;
      const [dy, dx] = jitter(r.id);
      const p = [r.lat + dy, r.lng + dx];
      pts.push(p);
      const hl = pub.hl.has(r.id), sel = r.id === pub.selected;
      if (hl) hlPts.push(p);
      const m = L.circleMarker(p, {
        radius: 6 + Math.min(7, 2 * (r.cluster_size - 1)) + (hl ? 3 : 0),
        color: '#0a0a0a', weight: sel || hl ? 4 : 2,
        fillColor: r.verified ? '#0a0a0a' : '#ffffff', fillOpacity: r.verified ? 0.95 : 0.92
      }).addTo(pub.layer);
      m.bindTooltip(`${r.incident_label} · ${r.area || 'location unknown'} · ${r.verified ? 'verified' : 'unverified'}`);
      m.on('click', () => select(r.id, false));
    });
    if (hlPts.length) {
      pub.map.fitBounds(hlPts, { padding: [60, 60], maxZoom: 14 });
    } else if (pts.length && !pub.fitted) {
      pub.map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
      pub.fitted = true;
    }
  }

  function select(id, pan = true) {
    pub.selected = id;
    const r = pub.data.reports.find(x => x.id === id);
    if (!r) return;
    $$('#p-list .item').forEach(i => i.classList.toggle('sel', +i.dataset.id === id));
    renderDetail(r);
    if (pan && pub.map && r.lat != null) pub.map.setView([r.lat, r.lng], Math.max(pub.map.getZoom(), 14), { animate: true });
    const it = $(`#p-list .item[data-id="${id}"]`);
    if (it) it.scrollIntoView({ block: 'nearest' });
  }

  function renderDetail(r) {
    const d = $('#pdetail');
    d.hidden = false;
    const L10 = UI[LANG_TIP()];
    const tips = ((pub.data.safety[r.incident] || pub.data.safety.other || {})[LANG_TIP()]) || '';
    const lang = LANG_TIP();
    d.innerHTML = `
      <div class="res-head">${statusTag(r)}<h2>${esc(r.incident_label)}</h2></div>
      <p class="mute small" style="margin-top:6px">${esc(r.area || 'Location not yet known')} · ${ago(r.created_at)} · ${r.channel === 'voice' ? 'voice report' : 'typed report'}${r.cluster_size > 1 ? ` · ${r.cluster_size} similar reports nearby` : ''}</p>
      <div class="notice">${esc(r.verified ? L10.ver : L10.unver)}</div>
      <h4>What was reported</h4>
      <blockquote class="orig" lang="${esc(r.lang)}">${esc(r.text)}</blockquote>
      ${r.english ? `<h4>English</h4><blockquote>${esc(r.english)}</blockquote>` : ''}
      ${r.needs.length ? `<h4>Help being asked for</h4><div>${r.needs.map(x => `<span class="pill">${esc(x)}</span>`).join('')}</div>` : ''}
      <h4>${esc(L10.tips)}</h4>
      <p lang="${lang}">${esc(tips)}</p>
      <p class="mute small" style="margin-top:10px" lang="${lang}">${esc(pub.data.disclaimer[lang])}</p>
      <p class="small" style="margin-top:10px" lang="${lang}"><strong>${esc(L10.numbers)}:</strong> 112 · 100 · 101 · 108</p>
      <div class="actions"><button class="btn sm ghost" id="p-listen" type="button">Listen to advice</button></div>`;
    $('#p-listen').onclick = e => speak(`${tips} ${pub.data.disclaimer[lang]}`, lang, e.target);
  }

  /* ---------- events ---------- */
  $('#p-incident').insertAdjacentHTML('beforeend', Object.entries(INCIDENT_LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));
  ['#p-incident', '#p-verified'].forEach(s => $(s).addEventListener('change', () => { pub.hl.clear(); render(); }));
  $('#p-search').addEventListener('input', () => { pub.hl.clear(); render(); });
  $('#p-lang').addEventListener('change', () => { if (pub.selected && pub.data) { const r = pub.data.reports.find(x => x.id === pub.selected); if (r) renderDetail(r); } });
  $('#p-list').addEventListener('click', e => { const it = e.target.closest('.item'); if (it) select(+it.dataset.id); });
  $('#p-report-btn').addEventListener('click', () => $$('.tabs button').find(b => b.dataset.tab === 'report').click());
  $('#p-showall').addEventListener('click', () => { pub.hl.clear(); pub.fitted = false; render(); });

  // runs after app.js's own tab handler, so #tab-public is already active here
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && b.dataset.tab === 'public') {
      initMap(); load();
      setTimeout(() => pub.map && pub.map.invalidateSize(), 120);
    }
  });
  setInterval(() => { if (!document.hidden) load(); }, 6000);

  /* ---------- public Q&A (text or voice) ---------- */
  const PASK = [
    'What is happening right now?',
    'Is there flooding near Kothrud?',
    'Which areas are affected?',
    'What should I do in a flood?',
    'Are these reports verified?',
    'कर्वे रोडवर काय परिस्थिती आहे?',
    'Emergency numbers'
  ];
  $('#pask-chips').innerHTML = PASK.map(q => `<button class="chip" type="button">${esc(q)}</button>`).join('');
  $('#pask-chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) ask(b.textContent); });

  function addMsg(who, text, listenLang) {
    const chat = $('#pchat');
    const id = 'pm' + Math.random().toString(36).slice(2, 8);
    chat.insertAdjacentHTML('beforeend',
      `<div class="msg ${who === 'You' ? 'me' : ''}"><div class="who">${who}</div><div class="body">${esc(text)}${listenLang ? `<div><button class="btn sm ghost msg-listen" id="${id}" type="button">Listen</button></div>` : ''}</div></div>`);
    chat.scrollTop = chat.scrollHeight;
    if (listenLang) $('#' + id).onclick = e => speak(text, listenLang, e.target);
  }
  addMsg('Raksha', 'Ask what is happening in your area, which places are affected, what to do, or which numbers to call. I can only describe citizen reports. I cannot confirm that anywhere is safe. You can ask in English, Hindi or Marathi, by typing or by voice.');

  function highlight(ids) {
    pub.hl = new Set(ids || []);
    pub.fitted = false;
    if (pub.data) render();
  }

  async function ask(q) {
    q = (q || '').trim(); if (!q) return;
    addMsg('You', q);
    $('#pask-text').value = '';
    try {
      const r = await jsend('/api/public/ask', { question: q, lang: $('#p-lang').value });
      addMsg('Raksha', r.answer, r.lang || 'en');
      if (!pub.data) await load();
      highlight(r.report_ids);
      if ((r.report_ids || []).length) $('#pmap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { addMsg('Raksha', 'Sorry, something went wrong: ' + e.message); }
  }
  $('#btn-pask').addEventListener('click', () => ask($('#pask-text').value));
  $('#pask-text').addEventListener('keydown', e => { if (e.key === 'Enter') ask($('#pask-text').value); });

  const pRec = new Recorder();
  let pRecording = false;
  $('#btn-pask-mic').addEventListener('click', async e => {
    const btn = e.target;
    if (!pRecording) {
      if (!state.sarvam) { addMsg('Raksha', 'Voice questions need a Sarvam API key in .env. You can type your question instead.'); return; }
      try { await pRec.start(); pRecording = true; btn.textContent = 'Stop'; btn.classList.add('recording'); }
      catch (err) { addMsg('Raksha', 'Microphone blocked. Allow mic access (works on localhost or https).'); }
    } else {
      pRecording = false; btn.textContent = 'Voice'; btn.classList.remove('recording');
      try {
        const r = await pRec.stop();
        const fd = new FormData(); fd.append('audio', r.blob, 'q.wav'); fd.append('lang', $('#p-lang').value);
        const t = await api('/api/transcribe', { method: 'POST', body: fd });
        if (t.transcript) ask(t.transcript); else addMsg('Raksha', 'I could not hear anything. Please try again.');
      } catch (err) { addMsg('Raksha', 'Could not transcribe: ' + err.message); }
    }
  });
})();