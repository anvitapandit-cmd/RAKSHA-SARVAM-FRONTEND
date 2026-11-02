/* Raksha: live simulation (demo only).
   Adds a floating button that posts a made-up emergency report every few seconds through the normal
   /api/reports endpoint, so pins appear live on the Public View and Control Room maps.
   Every report here is FAKE. Remove this file and its <script> tag to get rid of it. */
(() => {
  const EVERY = window.SIM_MS || 9000;   // milliseconds between reports
  const MAX = 80;                        // safety cap per run

  // [English name, Devanagari name]; the first six repeat so they form a visible hotspot
  const PLACES = [
    ['Karve Road', 'कर्वे रोड'], ['Karve Road', 'कर्वे रोड'], ['Kothrud', 'कोथरूड'], ['Kothrud', 'कोथरूड'],
    ['Ambil Odha', 'आंबिल ओढ'], ['Sinhagad Road', 'सिंहगड रोड'],
    ['Nal Stop', 'नळ स्टॉप'], ['Deccan', 'डेक्कन'], ['Shivajinagar', 'शिवाजीनगर'], ['Warje', 'वारजे'],
    ['Baner', 'बाणेर'], ['Aundh', 'औंध'], ['Hadapsar', 'हडपसर'], ['Kharadi', 'खराडी'], ['Swargate', 'स्वारगेट'],
    ['Katraj', 'कात्रज'], ['Sangamwadi', 'संगमवाडी'], ['Bhide Bridge', 'भिडे पूल'], ['Hinjewadi', 'हिंजवडी'],
    ['Wakad', 'वाकड'], ['Pimpri', 'पिंपरी'], ['Yerwada', 'येरवडा'], ['Bibwewadi', 'बिबवेवाडी']
  ];

  // {p} = place, {n} = number of people. Flood templates are listed more often so floods dominate.
  const T = {
    flood: {
      en: ['Water is entering houses near {p}, about {n} people stuck, need help urgently.',
           'Severe flooding at {p}, water rising fast, {n} people including children need rescue.'],
      mr: ['{p} परिसरात पाणी शिरले आहे, {n} जण अडकले आहेत, तातडीने मदत हवी.',
           '{p} येथे खूप पाणी वाढत आहे, {n} जण अडकले आहेत, लहान मुले आहेत, वाचवा!'],
      hi: ['{p} में पानी भर गया है, {n} लोग फंसे हैं, कृपया मदद भेजिए।',
           '{p} के पास बहुत पानी बढ़ रहा है, घरों में पानी घुस गया है, {n} लोग फंसे हैं।']
    },
    fire: {
      en: ['Fire in a building near {p}, thick smoke, {n} people trapped. Please send fire brigade.'],
      mr: ['{p} जवळ इमारतीला आग लागली आहे, खूप धूर येत आहे, {n} जण अडकले आहेत.'],
      hi: ['{p} के पास इमारत में आग लग गई है, बहुत धुआं फैल रहा है, {n} लोग फंसे हैं।']
    },
    collapse: {
      en: ['A wall collapsed near {p}, {n} people under the rubble, need ambulance urgently.'],
      mr: ['{p} येथे भिंत कोसळली आहे, {n} जण ढिगाऱ्याखाली अडकले आहेत, रुग्णवाहिका हवी.'],
      hi: ['{p} में दीवार गिर गई है, {n} लोग मलबे में दबे हैं, एम्बुलेंस चाहिए।']
    },
    tree: {
      en: ['Big tree fell on the road near {p}, road is blocked.'],
      mr: ['{p} येथे मोठे झाड रस्त्यावर पडले आहे, रस्ता बंद आहे.'],
      hi: ['{p} के पास बड़ा पेड़ गिर गया है, सड़क बंद है।']
    },
    electric: {
      en: ['Live electric wire fell in the water near {p}, someone got a shock, needs ambulance.']
    },
    minor: {
      en: ['Minor waterlogging near {p}, traffic is slow, no problem otherwise.'],
      mr: ['{p} जवळ थोडे पाणी साचले आहे, किरकोळ आहे, काही अडचण नाही.']
    }
  };
  const WEIGHTS = ['flood', 'flood', 'flood', 'flood', 'fire', 'collapse', 'tree', 'electric', 'minor'];

  const pick = a => a[Math.floor(Math.random() * a.length)];

  function makeReport() {
    const kind = pick(WEIGHTS);
    const langs = Object.keys(T[kind]);
    const lang = pick(langs);
    const place = pick(PLACES);
    const n = 2 + Math.floor(Math.random() * 9);
    const text = pick(T[kind][lang]).replace('{p}', lang === 'en' ? place[0] : place[1]).replace('{n}', n);
    return { text, lang };
  }

  /* ---------- floating button ---------- */
  const css = document.createElement('style');
  css.textContent = `
    #sim-btn{position:fixed;left:20px;bottom:20px;z-index:3000;font:inherit;font-size:12px;letter-spacing:.12em;
      text-transform:uppercase;padding:12px 18px;background:#fff;color:#0a0a0a;border:1px solid #0a0a0a;cursor:pointer;
      box-shadow:0 2px 0 #0a0a0a;display:flex;align-items:center;gap:10px}
    #sim-btn:hover{background:#0a0a0a;color:#fff}
    #sim-btn.on{background:#0a0a0a;color:#fff}
    #sim-btn .d{width:9px;height:9px;border-radius:50%;border:1.5px solid currentColor;display:inline-block}
    #sim-btn.on .d{background:#fff;animation:simpulse 1s infinite}
    @keyframes simpulse{50%{opacity:.25}}
    @media print{#sim-btn{display:none}}`;
  document.head.appendChild(css);

  const btn = document.createElement('button');
  btn.id = 'sim-btn'; btn.type = 'button';
  btn.innerHTML = '<span class="d"></span><span id="sim-label">Start live simulation</span>';
  document.body.appendChild(btn);

  let timer = null, sent = 0;
  const posted = [];     // ids of reports this run created
  const label = t => { document.getElementById('sim-label').textContent = t; };

  async function tick() {
    const r = makeReport();
    const fd = new FormData();
    fd.append('text', r.text);
    fd.append('lang', r.lang);
    try {
      const res = await fetch('/api/reports', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const row = await res.json();
      posted.push(row.id);
      sent++;
      // every 4th report, a "control room" verifies an earlier one so filled pins appear
      if (sent % 4 === 0 && posted.length > 2) {
        const id = pick(posted.slice(0, -1));
        fetch('/api/reports/' + id + '/status', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'verified' })
        }).catch(() => {});
      }
      label('Live · ' + sent + ' sent · tap to stop');
      if (sent >= MAX) stop();
    } catch (e) {
      stop();
      label('Server not reachable');
    }
  }

  function start() {
    btn.classList.add('on');
    sent = 0; posted.length = 0;
    label('Live · starting…');
    tick();
    timer = setInterval(tick, EVERY);
  }
  function stop() {
    clearInterval(timer); timer = null;
    btn.classList.remove('on');
    if (sent) label('Start again (' + sent + ' sent)'); else label('Start live simulation');
  }
  btn.addEventListener('click', () => (timer ? stop() : start()));
})();