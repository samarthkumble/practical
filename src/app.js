// Practical: the renderer app. Screens are plain functions that render into #app.
import { PROTOCOLS, PROTOCOL_ORDER, creditEstimate, cameraSeconds } from './protocols.js';
import { analyse } from './analysis.js';
import { Measurement, ProcessingStatus } from './measure.js';
import { store } from './store.js';
import { INFO, ITEMS, CONSENT_VERSION } from './consent.js';
import { lineChart } from './charts.js';

/* global __PRESAGE_KEY__, __DEMO__ */
const DEMO = __DEMO__;
const API_KEY = __PRESAGE_KEY__;

const app = document.getElementById('app');
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMin = (sec) => (sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s`);
const dash = (v, unit = '') => (v == null ? '—' : `${v}${unit}`);

if (DEMO) document.getElementById('demo-banner').hidden = false;
// Demo-only: ?speed=10 runs the phases 10x faster, for testing the screens.
const SPEED = DEMO ? Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1) : 1;

let active = null; // running experiment, so navigation can stop the camera first

/* ---------- navigation ---------- */

async function go(route, arg) {
  if (active) await active.abort();
  for (const b of document.querySelectorAll('.nav button')) b.classList.toggle('on', b.dataset.go === route);
  window.scrollTo(0, 0);
  const screens = { home, consent, participant, prepare, result, class: classView, about };
  await screens[route](arg);
  updateMeter();
}

document.querySelector('.nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-go]');
  if (b) go(b.dataset.go);
});

async function updateMeter() {
  const used = await store.getMeta(DEMO ? 'demoSeconds' : 'cameraSeconds', 0);
  document.getElementById('meter').innerHTML = DEMO
    ? 'Demo mode: <b>0 credits</b> used'
    : `Camera time on this laptop: <b>${fmtMin(used)}</b> ≈ <b>${Math.ceil(used / 30)}</b> credits`;
}

/* ---------- home: participants ---------- */

async function home() {
  const ps = await store.participants();
  const sessions = await store.sessions();
  const done = (code) => new Set(sessions.filter((s) => s.participant === code).map((s) => s.protocol));
  app.innerHTML = `
    <section class="sheet stack">
      <h1>Practical: physiology experiments with a webcam</h1>
      <p class="lede">Run the classic breathing and heartbeat experiments from a physiology practical with
      just a laptop camera. Every experiment has a known right answer, so you can also see how good
      the camera is.</p>
      <div class="grid4">
        ${PROTOCOL_ORDER.map((id) => `
          <div class="card exp">
            <h3>${h(PROTOCOLS[id].title)}</h3>
            <div class="small">${h(PROTOCOLS[id].tagline)}</div>
            <div class="meta">${fmtMin(cameraSeconds(PROTOCOLS[id]))} of camera · about ${creditEstimate(PROTOCOLS[id])} credits${PROTOCOLS[id].needsPartner ? ' · needs a partner' : ''}</div>
          </div>`).join('')}
      </div>
    </section>
    <section style="margin-top:26px" class="stack">
      <div class="row">
        <h2 style="margin:0">Participants</h2>
        <span class="spacer"></span>
        <button class="btn" id="add">+ New participant</button>
      </div>
      ${ps.length ? '' : '<p class="muted">No participants yet. Each person gets a code (P01, P02…) and reads the consent sheet before the camera is switched on.</p>'}
      <div class="plist">
        ${ps.map((p) => {
          const d = done(p.code);
          return `<div class="card pcard" data-code="${h(p.code)}">
            <div class="row"><span class="code">${h(p.code)}</span><span class="spacer"></span>
              <span class="pill ok">consented</span></div>
            <div class="small muted" style="margin-top:6px">${new Date(p.consent.at).toLocaleDateString()} · ${d.size} of 4 experiments done</div>
            <div class="dots">${PROTOCOL_ORDER.map((id) => `<span class="${d.has(id) ? 'done' : ''}" title="${h(PROTOCOLS[id].title)}"></span>`).join('')}</div>
          </div>`;
        }).join('')}
      </div>
    </section>`;
  document.getElementById('add').onclick = () => go('consent');
  for (const c of app.querySelectorAll('.pcard')) c.onclick = () => go('participant', c.dataset.code);
  updateMeter();
}

/* ---------- consent ---------- */

async function consent() {
  const code = await store.nextCode();
  app.innerHTML = `
    <section class="sheet consent stack" style="max-width:860px;margin:0 auto">
      <div class="row"><h1 style="margin:0">Information and consent</h1><span class="spacer"></span>
        <span class="pill">Participant ${h(code)}</span></div>
      <p class="muted">Please read this before anything is measured. The person being measured ticks the boxes themselves.</p>
      <ol>${INFO.map((t) => `<li>${h(t)}</li>`).join('')}</ol>
      <div class="card">
        ${ITEMS.map((it) => `<label class="check"><input type="checkbox" data-item="${it.id}"><span>${h(it.text)}</span></label>`).join('')}
      </div>
      <div class="row">
        <button class="btn ghost" id="cancel">Cancel</button>
        <span class="spacer"></span>
        <button class="btn big" id="agree" disabled>I agree — create ${h(code)}</button>
      </div>
    </section>`;
  const boxes = [...app.querySelectorAll('input[data-item]')];
  const agree = document.getElementById('agree');
  for (const b of boxes) b.onchange = () => { agree.disabled = !boxes.every((x) => x.checked); };
  document.getElementById('cancel').onclick = () => go('home');
  agree.onclick = async () => {
    await store.saveParticipant({
      code,
      consent: { version: CONSENT_VERSION, at: Date.now(), items: Object.fromEntries(boxes.map((b) => [b.dataset.item, true])) },
    });
    go('participant', code);
  };
}

/* ---------- participant ---------- */

function summaryLine(s) {
  const r = s.results;
  if (!r) return 'No result';
  switch (s.protocol) {
    case 'breathing': return `Camera vs pacer: off by ${dash(r.meanAbsError)} breaths/min on average`;
    case 'heartbeat': return `Interoceptive accuracy ${r.interoceptiveAccuracy == null ? '—' : Math.round(r.interoceptiveAccuracy * 100) + '%'}`;
    case 'stress': return `Pulse ${dash(r.restPulse)} → ${dash(r.taskPulse)} bpm (${r.pulseChange > 0 ? '+' : ''}${dash(r.pulseChange)})`;
    case 'pulsecheck': return `Camera ${dash(r.cameraPulse)} vs wrist ${dash(r.referencePulse)} bpm`;
    default: return '';
  }
}

async function participant(code) {
  const p = await store.participant(code);
  if (!p) return go('home');
  const sessions = await store.sessions(code);
  app.innerHTML = `
    <section class="stack">
      <div class="row">
        <button class="linkish" id="back">← All participants</button>
      </div>
      <div class="row"><h1 style="margin:0">Participant ${h(code)}</h1><span class="pill ok">consented ${new Date(p.consent.at).toLocaleString()}</span></div>
      <div class="grid2">
        ${PROTOCOL_ORDER.map((id) => {
          const pr = PROTOCOLS[id];
          const mine = sessions.filter((s) => s.protocol === id);
          return `<div class="card exp">
            <div class="row"><h3>${h(pr.title)}</h3><span class="spacer"></span>
              ${mine.length ? `<span class="pill ok">done ×${mine.length}</span>` : ''}</div>
            <div class="small">${h(pr.why)}</div>
            <div class="meta">${fmtMin(cameraSeconds(pr))} of camera · about ${creditEstimate(pr)} credits${pr.needsPartner ? ' · needs a partner to count the wrist pulse' : ''}</div>
            ${mine.map((s) => `<div class="result row"><button class="linkish" data-session="${h(s.id)}">${new Date(s.startedAt).toLocaleTimeString()}</button><span class="small">${h(summaryLine(s))}</span>${s.demo ? '<span class="pill warn">demo data</span>' : ''}</div>`).join('')}
            <div><button class="btn ${mine.length ? 'ghost' : ''}" data-run="${id}">${mine.length ? 'Run again' : 'Run this experiment'}</button></div>
          </div>`;
        }).join('')}
      </div>
      <div class="card row">
        <div><b>Withdraw ${h(code)}</b><div class="small muted">Deletes the consent record and every measurement stored under this code. This cannot be undone.</div></div>
        <span class="spacer"></span>
        <button class="btn danger" id="withdraw">Withdraw and delete</button>
      </div>
    </section>`;
  document.getElementById('back').onclick = () => go('home');
  for (const b of app.querySelectorAll('[data-run]')) b.onclick = () => go('prepare', { code, protocol: b.dataset.run });
  for (const b of app.querySelectorAll('[data-session]')) b.onclick = () => go('result', b.dataset.session);
  document.getElementById('withdraw').onclick = async () => {
    const btn = document.getElementById('withdraw');
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = `Click again to delete everything for ${code}`;
      return;
    }
    await store.deleteParticipant(code);
    go('home');
  };
}

/* ---------- prepare + run ---------- */

async function prepare({ code, protocol }) {
  const pr = PROTOCOLS[protocol];
  const used = await store.getMeta('cameraSeconds', 0);
  app.innerHTML = `
    <section class="run">
      <div>
        <div class="cam"><div class="off">Camera is off.<br>It turns on only when you press Start.</div></div>
        <div class="card small" style="margin-top:12px">
          <b>Before you start</b>
          <ul style="margin:6px 0 0;padding-left:18px">
            <li>Sit about an arm’s length from the laptop, face and shoulders in view.</li>
            <li>Light in front of you (a lamp or window behind the laptop), not behind you.</li>
            <li>Only the person being measured in the picture.</li>
            <li>Keep still and do not talk while it measures.</li>
          </ul>
        </div>
      </div>
      <div class="stage stack">
        <button class="linkish" id="back" style="align-self:flex-start">← Back to ${h(code)}</button>
        <h1>${h(pr.title)}</h1>
        <p class="lede">${h(pr.why)}</p>
        <div class="callout"><b>Answer key:</b> ${h(pr.answerKey)}</div>
        <div>
          <b>What will happen</b>
          <ol style="margin:6px 0 0;padding-left:20px">
            ${pr.phases.map((ph) => `<li>${h(ph.label)} <span class="muted small">(${ph.seconds} s)</span> — ${h(ph.say)}</li>`).join('')}
          </ol>
        </div>
        <div class="row small muted">
          Camera time: ${fmtMin(cameraSeconds(pr))} · about ${creditEstimate(pr)} Presage credits
          ${DEMO ? '· demo mode uses none' : `· used on this laptop so far: ${fmtMin(used)}`}
        </div>
        <div class="row">
          <button class="btn big" id="start">Start — turn camera on</button>
          <span class="small muted">You can stop at any time.</span>
        </div>
      </div>
    </section>`;
  document.getElementById('back').onclick = () => go('participant', code);
  document.getElementById('start').onclick = () => runExperiment(code, pr);
}

function runExperiment(code, pr) {
  // Live values that could bias the person (their own pulse while counting
  // heartbeats, or the camera pulse while the partner counts) stay hidden.
  const hidePulse = pr.id === 'heartbeat' || pr.id === 'pulsecheck';

  app.innerHTML = `
    <section class="run">
      <div>
        <div class="cam" id="cam"><video id="video" autoplay muted playsinline></video>
          <div class="rec">Camera on</div></div>
        <div class="hint warn" id="hint">Starting the camera…</div>
        <div class="readouts">
          <div class="readout"><div class="v" id="r-br">—</div><div class="l">breathing / min (camera)</div></div>
          <div class="readout"><div class="v" id="r-pulse">${hidePulse ? 'hidden' : '—'}</div><div class="l">${hidePulse ? 'pulse hidden until the end' : 'pulse / min (camera)'}</div></div>
        </div>
        <div class="small muted" id="r-sig" style="margin-top:8px">Signal: waiting for the first readings…</div>
        <div class="chartbox" style="margin-top:12px">
          <div class="legend"><span><i style="background:var(--chest)"></i>chest</span><span><i style="background:var(--belly)"></i>belly</span><span>last 15 s</span></div>
          <canvas id="c-trace"></canvas>
        </div>
      </div>
      <div class="stage">
        <div class="row"><div class="steps" id="steps"></div><span class="spacer"></span>
          <button class="btn ghost" id="abort">Stop and discard</button></div>
        <div style="margin-top:16px" class="row">
          <div><div class="phase-label" id="p-label">Getting ready…</div>
          <p class="phase-say" id="p-say">The camera is starting. This takes a few seconds.</p></div>
          <span class="spacer"></span><div class="timer" id="p-timer"></div>
        </div>
        <div class="progress"><div id="p-bar"></div></div>
        <div class="pacer-wrap" id="p-body"></div>
        <div id="p-error"></div>
      </div>
    </section>`;

  const $ = (id) => document.getElementById(id);
  const steps = pr.phases;
  $('steps').innerHTML = steps.map((p, i) => `<span data-i="${i}">${h(p.label)}</span>`).join('');

  const phases = [];
  const answers = {};
  let idx = -1;
  let phaseStart = 0;
  let tick = null;
  let raf = null;
  let finished = false;
  let cameraStopped = false;

  const m = new Measurement({
    apiKey: API_KEY,
    onStream: (stream) => { $('video').srcObject = stream; $('video').play().catch(() => {}); },
    onValidation: (code, hint) => {
      const el = $('hint');
      if (!el) return;
      el.textContent = hint;
      el.className = `hint ${code === 0 ? 'ok' : code === 10 ? 'warn' : 'bad'}`;
    },
    onStatus: (s) => {
      if (s === ProcessingStatus.kRunning && idx === -1) next();
    },
    onUpdate: (live) => {
      if ($('r-br')) $('r-br').textContent = live.breathing == null ? '—' : live.breathing.toFixed(0);
      if (!hidePulse && $('r-pulse')) $('r-pulse').textContent = live.pulse == null ? '—' : live.pulse.toFixed(0);
      drawTrace(live);
      const sig = $('r-sig');
      if (sig) {
        sig.textContent = live.pulseStable && live.breathingStable ? 'Signal: stable \u2713 (the SDK trusts its readings)'
          : live.pulseStable || live.breathingStable ? 'Signal: partly stable. Keep still, keep the light on your face.'
          : 'Signal: settling. Keep still and look at the screen.';
      }
    },
    onError: (err) => {
      if ($('p-error')) {
        $('p-error').innerHTML = `<div class="error-box"><b>Error ${h(err.code)}:</b> ${h(err.hint || err.message)}</div>`;
      }
    },
  });

  let lastDraw = 0;
  function drawTrace(live) {
    const now = performance.now();
    if (now - lastDraw < 150) return;
    lastDraw = now;
    const c = $('c-trace');
    if (!c) return;
    const tEnd = Math.max(live.upper.at(-1)?.[0] ?? 0, live.lower.at(-1)?.[0] ?? 0);
    const norm = (pts) => {
      const p = pts.filter((x) => x[0] >= tEnd - 15);
      if (!p.length) return p;
      const vs = p.map((x) => x[1]);
      const mn = Math.min(...vs), mx = Math.max(...vs);
      return p.map((x) => [x[0], mx > mn ? (x[1] - mn) / (mx - mn) : 0.5]);
    };
    lineChart(c, [
      { points: norm(live.upper), color: getCss('--chest') },
      { points: norm(live.lower), color: getCss('--belly') },
    ], { yMin: -0.05, yMax: 1.05, yTicks: false, xMin: tEnd - 15, xMax: tEnd, empty: 'Waiting for the first breaths…' });
  }

  const clock = () => (Date.now() - m.startedAt) / 1000;

  function setMock(ph) {
    if (!DEMO) return;
    window.__practicalMock = {
      breathRate: ph?.kind === 'pace' ? ph.rate : 14,
      pulseShift: ph?.kind === 'task' ? 9 : ph?.id === 'recovery' ? 2 : 0,
    };
  }

  async function next() {
    if (idx >= 0) phases[phases.length - 1].end = clock();
    idx++;
    if (idx >= steps.length) return finish();
    const ph = steps[idx];
    if (ph.stopCamera && !cameraStopped) {
      cameraStopped = true;
      await m.stop();
      $('cam').innerHTML = '<div class="off">Camera is off. Measurement finished.</div>';
      $('hint').className = 'hint ok';
      $('hint').textContent = 'Camera off.';
    }
    phaseStart = Date.now();
    phases.push({ id: ph.id, kind: ph.kind, rate: ph.rate, planned: ph.seconds, start: clock(), end: null });
    setMock(ph);
    for (const s of $('steps').children) {
      const i = Number(s.dataset.i);
      s.className = i < idx ? 'done' : i === idx ? 'now' : '';
    }
    $('p-label').textContent = ph.label;
    $('p-say').textContent = ph.say;
    renderBody(ph);
  }

  function renderBody(ph) {
    cancelAnimationFrame(raf);
    const body = $('p-body');
    if (ph.kind === 'pace') {
      body.innerHTML = '<div class="pacer" id="pacer">in</div>';
      const el = $('pacer');
      const f = ph.rate / 60;
      const t0 = performance.now();
      const loop = () => {
        const t = (performance.now() - t0) / 1000;
        const x = (1 - Math.cos(2 * Math.PI * f * t)) / 2; // 0 → 1 → 0
        el.style.transform = `scale(${0.55 + 0.45 * x})`;
        el.textContent = Math.sin(2 * Math.PI * f * t) >= 0 ? 'in' : 'out';
        raf = requestAnimationFrame(loop);
      };
      loop();
    } else if (ph.kind === 'answer') {
      body.innerHTML = `<div><div class="bigq"><input id="ans" type="number" inputmode="numeric" min="0" max="${ph.answerFor === 'task' ? 1000 : 300}" autofocus>
        <button class="btn big" id="ans-ok">Save</button></div>
        <p class="small muted">${ph.stopCamera ? 'The camera is already off.' : 'Press Enter to save. The camera keeps measuring, so stay still.'}</p></div>`;
      const input = $('ans');
      input.focus();
      const save = () => { answers[ph.answerFor] = input.value === '' ? null : Number(input.value); next(); };
      $('ans-ok').onclick = save;
      input.onkeydown = (e) => { if (e.key === 'Enter') save(); };
    } else if (ph.kind === 'task') {
      body.innerHTML = `<div style="text-align:center"><div style="font:700 72px var(--serif)">${ph.startNumber}</div>
        <div style="font:600 30px var(--serif);color:var(--muted)">− 7, − 7, − 7 …</div></div>`;
    } else if (ph.kind === 'count') {
      body.innerHTML = '<div style="text-align:center"><div class="fixdot" style="margin:0 auto 14px"></div><div class="muted">Count silently. Eyes on the dot.</div></div>';
    } else if (ph.kind === 'ref') {
      body.innerHTML = '<div style="text-align:center;font:700 26px var(--serif)">Partner: count the wrist pulse now</div>';
    } else {
      body.innerHTML = '<div class="fixdot"></div>';
    }
  }

  tick = setInterval(() => {
    if (idx < 0 || idx >= steps.length || finished) return;
    const ph = steps[idx];
    const el = (Date.now() - phaseStart) / 1000;
    const dur = ph.seconds / SPEED;
    const left = Math.max(0, dur - el);
    const waitForever = ph.kind === 'answer' && ph.stopCamera;
    $('p-timer').textContent = waitForever ? '' : Math.ceil(left);
    $('p-bar').style.width = `${waitForever ? 100 : Math.min(100, (el / dur) * 100)}%`;
    if (!waitForever && left <= 0) {
      if (ph.kind === 'answer') {
        const input = $('ans');
        answers[ph.answerFor] = input && input.value !== '' ? Number(input.value) : null;
      }
      next();
    }
  }, 100);

  async function finish() {
    if (finished) return;
    finished = true;
    clearInterval(tick);
    cancelAnimationFrame(raf);
    await m.stop();
    active = null;
    const rec = m.samples();
    const session = {
      id: `${code}-${pr.id}-${Date.now()}`,
      participant: code,
      protocol: pr.id,
      startedAt: m.startedAt,
      demo: DEMO,
      phases,
      answers,
      ...rec,
    };
    session.results = analyse(session);
    await store.saveSession(session);
    const key = DEMO ? 'demoSeconds' : 'cameraSeconds';
    await store.setMeta(key, (await store.getMeta(key, 0)) + rec.cameraSeconds);
    go('result', session.id);
  }

  async function abort() {
    finished = true;
    clearInterval(tick);
    cancelAnimationFrame(raf);
    await m.stop();
    const key = DEMO ? 'demoSeconds' : 'cameraSeconds';
    await store.setMeta(key, (await store.getMeta(key, 0)) + m.samples().cameraSeconds);
    active = null;
  }

  active = { abort };
  $('abort').onclick = async () => { await abort(); go('participant', code); };

  m.start().catch((err) => {
    $('p-error').innerHTML = `<div class="error-box"><b>Could not start:</b> ${h(err.message || err)}</div>`;
  });
}

function getCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

/* ---------- result ---------- */

const pct = (x) => (x == null ? '\u2014' : `${Math.round(x * 100)}%`);

// One line on how trustworthy the measurement was, in plain words.
function qualityStrip(q, which = 'pulse') {
  if (!q) return '';
  const conf = which === 'pulse' ? q.pulseConfidence : q.breathingConfidence;
  const stable = which === 'pulse' ? q.pulseStableShare : q.breathingStableShare;
  const ok = stable != null && stable >= 0.6 && (q.framingProblemShare ?? 0) <= 0.2 && (q.talkingShare ?? 0) <= 0.2;
  const cls = stable == null ? 'warn' : ok ? '' : 'warn';
  return `<div class="callout ${cls} small"><b>${ok ? 'Good signal.' : 'Weak signal: read these numbers with care.'}</b>
    The SDK marked ${pct(stable)} of its ${which} readings as stable (confidence ${dash(conf)} / 100 on average).
    Framing problems ${pct(q.framingProblemShare)} of the time, talking ${pct(q.talkingShare)}.</div>`;
}

async function result(id) {
  const all = await store.sessions();
  const s = all.find((x) => x.id === id);
  if (!s) return go('home');
  const pr = PROTOCOLS[s.protocol];
  const r = analyse(s);
  const bands = s.phases.filter((p) => p.end != null).map((p, i) => ({
    from: p.start, to: p.end, label: PROTOCOLS[s.protocol].phases.find((x) => x.id === p.id)?.label,
    color: i % 2 ? 'rgba(31,42,68,0.035)' : 'rgba(31,42,68,0.075)',
  }));

  app.innerHTML = `
    <section class="stack">
      <button class="linkish" id="back">← Participant ${h(s.participant)}</button>
      <div class="row"><h1 style="margin:0">${h(pr.title)}: ${h(s.participant)}</h1>
        ${s.demo ? '<span class="pill warn">demo data, not a measurement</span>' : ''}
        <span class="spacer"></span><span class="small muted">${new Date(s.startedAt).toLocaleString()} · camera ${fmtMin(s.cameraSeconds || 0)}</span></div>
      <div id="body" class="stack"></div>
    </section>`;
  document.getElementById('back').onclick = () => go('participant', s.participant);
  const body = document.getElementById('body');

  const chart = (id, cls = '') => `<div class="chartbox ${cls}"><canvas id="${id}"></canvas></div>`;

  if (s.protocol === 'breathing') {
    body.innerHTML = `
      <div class="grid3">
        ${r.rows.map((row) => `<div class="card"><div class="stat-label">Pacer ${row.target} / min</div>
          <div class="stat">${dash(row.sdkRate)}</div><div class="stat-label">camera breathing rate${row.sdkError != null ? ` (${row.sdkError > 0 ? '+' : ''}${row.sdkError})` : ''}</div></div>`).join('')}
      </div>
      <div class="chartbox tall"><div class="legend"><span><i style="background:var(--ink)"></i>camera breathing rate</span><span><i style="background:var(--margin)"></i>pacer (the right answer)</span></div><canvas id="c1"></canvas></div>
      <div class="chartbox"><div class="legend"><span><i style="background:var(--chest)"></i>chest movement</span><span><i style="background:var(--belly)"></i>belly movement</span></div><canvas id="c2"></canvas></div>
      <table><thead><tr><th>Block</th><th class="num">Pacer</th><th class="num">Camera rate</th><th class="num">Error</th><th class="num">Counted from chest</th><th class="num">Counted from belly</th><th class="num">Belly share</th><th class="num">Framing problems</th></tr></thead>
      <tbody>${r.rows.map((row) => `<tr><td>${h(row.phase)}</td><td class="num">${row.target}</td><td class="num">${dash(row.sdkRate)}</td><td class="num">${dash(row.sdkError)}</td><td class="num">${dash(row.chestTraceRate)}</td><td class="num">${dash(row.bellyTraceRate)}</td><td class="num">${row.bellyShare == null ? '—' : Math.round(row.bellyShare * 100) + '%'}</td><td class="num">${row.quality.framingProblemShare == null ? '—' : Math.round(row.quality.framingProblemShare * 100) + '%'}</td></tr>`).join('')}</tbody></table>
      ${qualityStrip(r.rows[r.rows.length - 1]?.quality, 'breathing')}
      <p class="small muted">"Camera rate" is the SDK’s own estimate (median of the last 30 s of each block). "Counted from chest/belly" is our own count of breaths in the raw movement traces, a second, independent reading. "Belly share" is how much of the movement came from the belly rather than the chest.</p>`;
    lineChart(document.getElementById('c1'), [{ points: s.samples.br.map((x) => [x[0], x[1]]), color: getCss('--ink') }], {
      bands, refLines: s.phases.filter((p) => p.kind === 'pace' && p.end).map((p) => ({ y: p.rate, from: p.start, to: p.end, color: getCss('--margin') })),
      yMin: 0, yMax: 24,
    });
    lineChart(document.getElementById('c2'), [
      { points: s.samples.upper.map((x) => [x[0], x[1]]), color: getCss('--chest'), width: 1 },
      { points: s.samples.lower.map((x) => [x[0], x[1]]), color: getCss('--belly'), width: 1 },
    ], { bands, yTicks: false });
  } else if (s.protocol === 'heartbeat') {
    const acc = r.interoceptiveAccuracy;
    body.innerHTML = `
      <div class="grid3">
        <div class="card"><div class="stat">${acc == null ? '—' : Math.round(acc * 100) + '%'}</div><div class="stat-label">interoceptive accuracy (1 = every beat counted)</div></div>
        <div class="card" style="grid-column: span 2"><div class="small">People usually feel only some of their heartbeats, and most people under-count. Scores are about personal curiosity and class discussion, not health.</div></div>
      </div>
      <table><thead><tr><th>Interval</th><th class="num">Seconds</th><th class="num">Camera pulse</th><th class="num">True beats</th><th class="num">You counted</th><th class="num">Accuracy</th><th class="num">Framing problems</th></tr></thead>
      <tbody>${r.rows.map((row) => `<tr><td>${h(row.phase)}</td><td class="num">${row.seconds}</td><td class="num">${dash(row.cameraPulse)}</td><td class="num">${dash(row.trueBeats)}</td><td class="num">${dash(row.reported)}</td><td class="num">${row.accuracy == null ? '—' : Math.round(row.accuracy * 100) + '%'}</td><td class="num">${row.quality.framingProblemShare == null ? '—' : Math.round(row.quality.framingProblemShare * 100) + '%'}</td></tr>`).join('')}</tbody></table>
      ${qualityStrip(r.rows[0]?.quality, 'pulse')}
      ${chart('c1', 'tall')}
      <p class="small muted">True beats = mean camera pulse during the interval × its length. Accuracy per interval = 1 − |true − counted| ÷ true (Schandry, 1981).</p>`;
    lineChart(document.getElementById('c1'), [{ points: s.samples.pulse.map((x) => [x[0], x[1]]), color: getCss('--pulse'), dots: true }], { bands });
  } else if (s.protocol === 'stress') {
    if (!r) { body.innerHTML = '<p>Not enough data.</p>'; return; }
    body.innerHTML = `
      <div class="grid4">
        <div class="card"><div class="stat">${dash(r.restPulse)}</div><div class="stat-label">pulse at rest</div></div>
        <div class="card"><div class="stat">${dash(r.taskPulse)}</div><div class="stat-label">pulse during the sums</div></div>
        <div class="card"><div class="stat">${r.pulseChange == null ? '—' : (r.pulseChange > 0 ? '+' : '') + r.pulseChange}</div><div class="stat-label">change (beats/min)</div></div>
        <div class="card"><div class="stat">${r.recovered == null ? '—' : Math.round(Math.min(1, r.recovered) * 100) + '%'}</div><div class="stat-label">of the rise gone after 60 s rest</div></div>
      </div>
      ${qualityStrip(r.quality?.task, 'pulse')}
      <div class="chartbox tall"><div class="legend"><span><i style="background:var(--pulse)"></i>camera pulse</span></div><canvas id="c1"></canvas></div>
      <div class="chartbox"><div class="legend"><span><i style="background:var(--ink)"></i>camera breathing rate</span></div><canvas id="c2"></canvas></div>
      <p class="small">Breathing at rest ${dash(r.restBreathing)} / min, during the sums ${dash(r.taskBreathing)} / min. Reached ${dash(r.answer)} counting back from 1000.</p>
      <p class="small muted">Pulse from the camera is a moving average over about 12 seconds, so the first 10 s of the task are left out of "during the sums". A rise during mental arithmetic is the normal, expected response.</p>`;
    lineChart(document.getElementById('c1'), [{ points: s.samples.pulse.map((x) => [x[0], x[1]]), color: getCss('--pulse'), dots: true }], { bands });
    lineChart(document.getElementById('c2'), [{ points: s.samples.br.map((x) => [x[0], x[1]]), color: getCss('--ink') }], { bands });
  } else if (s.protocol === 'pulsecheck') {
    if (!r) { body.innerHTML = '<p>Not enough data.</p>'; return; }
    const sign = (v) => (v == null ? '\u2014' : (v > 0 ? '+' : '') + v);
    body.innerHTML = `
      <div class="grid4">
        <div class="card"><div class="stat">${dash(r.referencePulse)}</div><div class="stat-label">wrist count by partner \u00d7 2 (the reference)</div></div>
        <div class="card"><div class="stat">${dash(r.cameraPulse)}</div><div class="stat-label">camera pulse, stable readings only (${sign(r.error)})</div></div>
        <div class="card"><div class="stat">${dash(r.cameraPulseAllReadings)}</div><div class="stat-label">camera pulse, all readings (${sign(r.errorAllReadings)})</div></div>
        <div class="card"><div class="stat">${dash(r.waveRate)}</div><div class="stat-label">beats counted in the pulse wave (${sign(r.waveError)})</div></div>
      </div>
      ${qualityStrip(r.quality, 'pulse')}
      <div class="chartbox"><div class="legend"><span><i style="background:var(--pulse)"></i>camera pulse (dots = stable)</span><span><i style="background:var(--margin)"></i>wrist reference</span></div><canvas id="c1"></canvas></div>
      <div class="chartbox"><div class="legend"><span><i style="background:var(--pulse)"></i>pulse wave from the camera</span></div><canvas id="c2"></canvas></div>
      <p class="small muted">"Stable" is the SDK\u2019s own verdict on each pulse reading (confidence of 40 or more, about \u00b13 beats/min). A hand count over 30 s can itself be off by a beat or two (\u00b12\u20134 beats/min).</p>`;
    const ref = s.phases.find((p) => p.id === 'ref');
    lineChart(document.getElementById('c1'), [
      { points: s.samples.pulse.map((x) => [x[0], x[1]]), color: getCss('--pulse') },
      { points: s.samples.pulse.filter((x) => x[3] === 1 || x[3] === undefined).map((x) => [x[0], x[1]]), color: getCss('--pulse'), dots: true, width: 0 },
    ], { bands, refLines: r.referencePulse && ref ? [{ y: r.referencePulse, from: ref.start, to: ref.end, color: getCss('--margin') }] : [] });
    const wave = s.samples.wave || [];
    lineChart(document.getElementById('c2'), [{ points: ref ? wave.filter((x) => x[0] >= ref.start && x[0] < Math.min(ref.end, ref.start + 10)).map((x) => [x[0], x[1]]) : [], color: getCss('--pulse'), width: 1.2 }],
      { yTicks: false, empty: 'No pulse wave recorded (sessions before this version did not record it).' });
  }
}

/* ---------- class results ---------- */

function latestBy(sessions, protocol) {
  const out = new Map();
  for (const s of sessions.filter((x) => x.protocol === protocol)) out.set(s.participant, s);
  return [...out.values()];
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function summaryRows(sessions) {
  const rows = [];
  for (const s of sessions) {
    const r = analyse(s);
    if (!r) continue;
    const base = { participant: s.participant, protocol: s.protocol, startedAt: new Date(s.startedAt).toISOString(), demo: !!s.demo, cameraSeconds: s.cameraSeconds };
    if (s.protocol === 'breathing') {
      for (const row of r.rows) rows.push({ ...base, item: row.phase, expected: row.target, measured: row.sdkRate, error: row.sdkError, extra1: row.chestTraceRate, extra2: row.bellyTraceRate, framingProblemShare: row.quality.framingProblemShare, talkingShare: row.quality.talkingShare });
    } else if (s.protocol === 'heartbeat') {
      for (const row of r.rows) rows.push({ ...base, item: row.phase, expected: row.trueBeats, measured: row.reported, error: row.accuracy, extra1: row.cameraPulse, extra2: row.seconds, framingProblemShare: row.quality.framingProblemShare, talkingShare: row.quality.talkingShare });
    } else if (s.protocol === 'stress') {
      rows.push({ ...base, item: 'rest_vs_task', expected: r.restPulse, measured: r.taskPulse, error: r.pulseChange, extra1: r.recoveryLatePulse, extra2: r.recovered, framingProblemShare: r.quality?.task?.framingProblemShare, talkingShare: r.quality?.task?.talkingShare });
    } else if (s.protocol === 'pulsecheck') {
      rows.push({ ...base, item: 'pulse_vs_wrist', expected: r.referencePulse, measured: r.cameraPulse, error: r.error, extra1: r.cameraPulseAllReadings, extra2: r.waveRate, framingProblemShare: r.quality.framingProblemShare, talkingShare: r.quality.talkingShare, stableShare: r.quality.pulseStableShare });
    }
  }
  return rows;
}

async function classView() {
  const sessions = (await store.sessions()).map((s) => ({ ...s, results: analyse(s) }));
  const real = sessions.filter((s) => DEMO || !s.demo);
  const br = latestBy(real, 'breathing');
  const hb = latestBy(real, 'heartbeat');
  const st = latestBy(real, 'stress');
  const pc = real.filter((s) => s.protocol === 'pulsecheck');

  const brErr = br.flatMap((s) => s.results.rows.map((r) => r.sdkError).filter((e) => e != null));
  const pcErr = pc.map((s) => s.results?.error).filter((e) => e != null);
  const mae = (xs) => (xs.length ? (xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length).toFixed(1) : '—');
  const bias = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '—');

  app.innerHTML = `
    <section class="stack">
      <div class="row"><h1 style="margin:0">Class results</h1><span class="spacer"></span>
        <button class="btn ghost" id="csv">Export summary (CSV)</button>
        <button class="btn ghost" id="json">Export all data (JSON)</button></div>
      <p class="muted">Codes only, no names. The latest run per person is used for each experiment.</p>
      <div class="grid4">
        <div class="card"><div class="stat">${mae(brErr)}</div><div class="stat-label">breaths/min: average camera error vs pacer (${brErr.length} blocks, ${br.length} people)</div></div>
        <div class="card"><div class="stat">${mae(pcErr)}</div><div class="stat-label">beats/min: average camera error vs wrist count (${pcErr.length} checks)</div></div>
        <div class="card"><div class="stat">${bias(pcErr)}</div><div class="stat-label">beats/min: camera bias (+ reads high)</div></div>
        <div class="card"><div class="stat">${hb.length ? Math.round(100 * hb.reduce((a, s) => a + (s.results.interoceptiveAccuracy || 0), 0) / hb.length) + '%' : '—'}</div><div class="stat-label">average interoceptive accuracy (${hb.length} people)</div></div>
      </div>

      <h2>Paced breathing</h2>
      <table><thead><tr><th>Code</th>${[6, 10, 15].map((r) => `<th class="num">Pacer ${r}: camera</th>`).join('')}<th class="num">Mean |error|</th></tr></thead>
      <tbody>${br.map((s) => `<tr><td>${h(s.participant)}${s.demo ? ' <span class="pill warn">demo</span>' : ''}</td>${[6, 10, 15].map((rate) => `<td class="num">${dash(s.results.rows.find((x) => x.target === rate)?.sdkRate)}</td>`).join('')}<td class="num">${dash(s.results.meanAbsError)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No runs yet</td></tr>'}</tbody></table>

      <h2>Heartbeat counting</h2>
      <table><thead><tr><th>Code</th><th class="num">25 s</th><th class="num">35 s</th><th class="num">45 s</th><th class="num">Accuracy</th></tr></thead>
      <tbody>${hb.map((s) => `<tr><td>${h(s.participant)}</td>${s.results.rows.map((x) => `<td class="num">${dash(x.reported)} / ${dash(x.trueBeats)}</td>`).join('')}<td class="num">${s.results.interoceptiveAccuracy == null ? '—' : Math.round(s.results.interoceptiveAccuracy * 100) + '%'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No runs yet</td></tr>'}</tbody></table>
      <p class="small muted">Cells are "counted / true beats".</p>

      <h2>Mental arithmetic</h2>
      <table><thead><tr><th>Code</th><th class="num">Rest pulse</th><th class="num">Task pulse</th><th class="num">Change</th><th class="num">Recovered</th></tr></thead>
      <tbody>${st.map((s) => `<tr><td>${h(s.participant)}</td><td class="num">${dash(s.results?.restPulse)}</td><td class="num">${dash(s.results?.taskPulse)}</td><td class="num">${dash(s.results?.pulseChange)}</td><td class="num">${s.results?.recovered == null ? '—' : Math.round(Math.min(1, s.results.recovered) * 100) + '%'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No runs yet</td></tr>'}</tbody></table>

      <h2>Pulse checks</h2>
      <table><thead><tr><th>Code</th><th>Time</th><th class="num">Wrist × 2</th><th class="num">Camera (stable)</th><th class="num">Camera (all)</th><th class="num">Pulse wave</th><th class="num">Stable readings</th></tr></thead>
      <tbody>${pc.map((s) => { const r = s.results || {}; return `<tr><td>${h(s.participant)}</td><td>${new Date(s.startedAt).toLocaleTimeString()}</td><td class="num">${dash(r.referencePulse)}</td><td class="num">${dash(r.cameraPulse)} (${dash(r.error)})</td><td class="num">${dash(r.cameraPulseAllReadings)} (${dash(r.errorAllReadings)})</td><td class="num">${dash(r.waveRate)} (${dash(r.waveError)})</td><td class="num">${r.quality?.pulseStableShare == null ? '—' : Math.round(r.quality.pulseStableShare * 100) + '%'}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No runs yet</td></tr>'}</tbody></table>
      <p class="small muted">Brackets show the difference from the wrist count. "Stable" readings are the ones the SDK itself rates as accurate to about ±3 beats/min.</p>
    </section>`;

  document.getElementById('csv').onclick = () => {
    const rows = summaryRows(real);
    const cols = ['participant', 'protocol', 'item', 'expected', 'measured', 'error', 'extra1', 'extra2', 'stableShare', 'framingProblemShare', 'talkingShare', 'cameraSeconds', 'demo', 'startedAt'];
    download('practical-summary.csv', [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\n'), 'text/csv');
  };
  document.getElementById('json').onclick = async () => {
    const participants = (await store.participants()).map((p) => ({ code: p.code, consentVersion: p.consent.version, consentedAt: p.consent.at }));
    download('practical-data.json', JSON.stringify({ exportedAt: new Date().toISOString(), app: 'practical', participants, sessions: real }, null, 1), 'application/json');
  };
}

/* ---------- about ---------- */

async function about() {
  app.innerHTML = `
    <section class="sheet stack" style="max-width:900px;margin:0 auto">
      <h1>Consent and data handling</h1>
      <p class="lede">Practical is built for classrooms, so it treats every measurement like a small research study.</p>
      <h3>Before anything is measured</h3>
      <p>Each person reads an information sheet and ticks five boxes themselves (18+, not a health check, camera, storage, right to withdraw). Only then is a participant code created. Names are never asked for.</p>
      <h3>While measuring</h3>
      <p>The camera turns on only after Start is pressed, a red "Camera on" label shows while it runs, and "Stop and discard" ends it at once without saving. The app asks the operating system for the camera only, never the microphone.</p>
      <h3>What is stored, and where</h3>
      <p>Only numbers with timestamps (pulse, breathing rate, chest and belly movement, and whether the person was talking) are stored in the app’s local database on this laptop. No video frames or photos are stored. Results are labelled with the participant code.</p>
      <h3>What leaves the laptop</h3>
      <p>The Presage SDK processes video on this laptop and contacts Presage only to authorise the API key. Practical turns the SDK’s optional telemetry off (<span class="mono">enableTelemetry: false</span>). Nothing else is sent anywhere unless someone presses Export.</p>
      <h3>Withdrawal</h3>
      <p>"Withdraw and delete" on a participant’s page removes their consent record and every session immediately.</p>
      <h3>Not a medical device</h3>
      <p>The numbers are for teaching and curiosity. The SDK’s metrics are for general wellness and information only. Practical makes no diagnosis and no health recommendation.</p>
      <p class="small muted">Built with the Presage SmartSpectra SDK ${DEMO ? '(running in demo mode with synthetic data)' : ''}. Open source under the MIT licence.</p>
    </section>`;
}

go('home');
