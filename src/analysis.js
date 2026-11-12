// Pure analysis functions. No DOM, no SDK: everything here is unit-tested.
//
// A session stores samples as arrays with time in seconds since the session
// started:  pulse/br: [t, value, confidence]   upper/lower: [t, value]
//           talking/blink: [t, detected(0|1)]   validation: [t, code]
// and phases as [{ id, kind, start, end, ... }] on the same clock.

export function mean(xs) {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function median(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function std(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

// Half-open [t0, t1) so a sample on a phase boundary belongs to the next phase.
export function inWindow(samples, t0, t1) {
  return (samples || []).filter((s) => s[0] >= t0 && s[0] < t1);
}

export function round(x, d = 1) {
  if (x == null || Number.isNaN(x)) return null;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

// Breathing rate (breaths/min) counted directly from a chest or belly trace:
// remove the slow drift, smooth, then count upward crossings of zero with a
// small dead band so noise does not count as a breath. The rate uses the time
// between the first and last crossing, so partial breaths at the edges do not
// bias it.
export function traceRate(trace, t0, t1) {
  const pts = inWindow(trace, t0, t1);
  if (pts.length < 20) return { rate: null, breaths: 0 };
  const ts = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);

  // Linear detrend.
  const tm = mean(ts), vm = mean(vs);
  let num = 0, den = 0;
  for (let i = 0; i < ts.length; i++) { num += (ts[i] - tm) * (vs[i] - vm); den += (ts[i] - tm) ** 2; }
  const slope = den ? num / den : 0;
  const detr = vs.map((v, i) => v - vm - slope * (ts[i] - tm));

  // Moving average over ~0.6 s.
  const dt = (ts[ts.length - 1] - ts[0]) / (ts.length - 1) || 0.033;
  const half = Math.max(1, Math.round(0.3 / dt));
  const sm = detr.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(detr.length - 1, i + half); j++) { s += detr[j]; n++; }
    return s / n;
  });

  const band = 0.25 * (std(sm) || 0);
  if (!band) return { rate: null, breaths: 0 };
  const ups = [];
  let state = sm[0] > band ? 1 : sm[0] < -band ? -1 : 0;
  for (let i = 1; i < sm.length; i++) {
    if (sm[i] > band && state <= 0) {
      if (state === -1) ups.push(ts[i]);
      state = 1;
    } else if (sm[i] < -band) {
      state = -1;
    }
  }
  if (ups.length < 2) return { rate: null, breaths: ups.length };
  const rate = ((ups.length - 1) / (ups[ups.length - 1] - ups[0])) * 60;
  return { rate, breaths: ups.length };
}

// How much of a window the person was talking, and how much of it the SDK
// reported a framing problem (anything other than validation code 0 = OK).
export function quality(session, t0, t1) {
  const talk = inWindow(session.samples.talking, t0, t1);
  const talking = talk.length ? mean(talk.map((s) => s[1])) : null;

  const ev = session.validation || [];
  let bad = 0;
  let code = ev.filter((e) => e[0] <= t0).pop()?.[1] ?? null;
  let last = t0;
  for (const [t, c] of ev.filter((e) => e[0] > t0 && e[0] < t1)) {
    if (code !== 0 && code !== null) bad += t - last;
    code = c;
    last = t;
  }
  if (code !== 0 && code !== null) bad += t1 - last;
  const conf = inWindow(session.samples.pulse, t0, t1).concat(inWindow(session.samples.br, t0, t1))
    .map((s) => s[2]).filter((c) => c != null);
  return {
    talkingShare: talking == null ? null : round(talking, 2),
    framingProblemShare: round(bad / Math.max(1e-9, t1 - t0), 2),
    meanConfidence: conf.length ? round(mean(conf), 2) : null,
  };
}

function phase(session, id) {
  return session.phases.find((p) => p.id === id && p.end != null);
}

// Value series of a [t, v, c] sample list inside a window.
function vals(samples, t0, t1) {
  return inWindow(samples, t0, t1).map((s) => s[1]).filter((v) => v != null && v > 0);
}

export function breathingResults(session, { window = 30 } = {}) {
  const rows = [];
  for (const p of session.phases.filter((x) => x.kind === 'pace' && x.end != null)) {
    const w0 = Math.max(p.start, p.end - window);
    const sdk = median(vals(session.samples.br, w0, p.end));
    const chest = traceRate(session.samples.upper, p.start + 10, p.end).rate;
    const belly = traceRate(session.samples.lower, p.start + 10, p.end).rate;
    const chestAmp = std(inWindow(session.samples.upper, p.start + 10, p.end).map((s) => s[1]));
    const bellyAmp = std(inWindow(session.samples.lower, p.start + 10, p.end).map((s) => s[1]));
    rows.push({
      phase: p.id,
      target: p.rate,
      sdkRate: round(sdk),
      sdkError: sdk == null ? null : round(sdk - p.rate),
      chestTraceRate: round(chest),
      bellyTraceRate: round(belly),
      bellyShare: chestAmp && bellyAmp ? round(bellyAmp / (chestAmp + bellyAmp), 2) : null,
      quality: quality(session, w0, p.end),
    });
  }
  const errs = rows.map((r) => r.sdkError).filter((e) => e != null).map(Math.abs);
  return { rows, meanAbsError: round(mean(errs)) };
}

// Heartbeat counting: true beats = mean camera pulse in the interval x minutes.
// Interoceptive accuracy per trial = 1 - |true - reported| / true (Schandry).
export function heartbeatResults(session) {
  const rows = [];
  for (const p of session.phases.filter((x) => x.kind === 'count' && x.end != null)) {
    const rate = mean(vals(session.samples.pulse, p.start, p.end));
    const seconds = p.end - p.start;
    const actual = rate == null ? null : (rate * seconds) / 60;
    const reported = session.answers?.[p.id];
    const acc = actual && reported != null && reported !== ''
      ? Math.max(0, 1 - Math.abs(actual - Number(reported)) / actual) : null;
    rows.push({
      phase: p.id,
      seconds: round(seconds, 0),
      cameraPulse: round(rate),
      trueBeats: round(actual),
      reported: reported == null || reported === '' ? null : Number(reported),
      accuracy: round(acc, 2),
      quality: quality(session, p.start, p.end),
    });
  }
  const accs = rows.map((r) => r.accuracy).filter((a) => a != null);
  return { rows, interoceptiveAccuracy: round(mean(accs), 2) };
}

export function stressResults(session) {
  const rest = phase(session, 'rest');
  const task = phase(session, 'task');
  const rec = phase(session, 'recovery');
  if (!rest || !task) return null;
  const restW = [Math.max(rest.start, rest.end - 30), rest.end];
  // Pulse is a ~12 s average, so skip the first 10 s of the task.
  const taskW = [task.start + 10, task.end];
  const pr = (w) => round(mean(vals(session.samples.pulse, w[0], w[1])));
  const br = (w) => round(median(vals(session.samples.br, w[0], w[1])));
  const out = {
    restPulse: pr(restW),
    taskPulse: pr(taskW),
    restBreathing: br(restW),
    taskBreathing: br(taskW),
    answer: session.answers?.task ?? null,
    quality: { rest: quality(session, ...restW), task: quality(session, ...taskW) },
  };
  out.pulseChange = out.restPulse != null && out.taskPulse != null ? round(out.taskPulse - out.restPulse) : null;
  if (rec) {
    const early = [rec.start, rec.start + 30];
    const late = [Math.max(rec.start, rec.end - 30), rec.end];
    out.recoveryEarlyPulse = pr(early);
    out.recoveryLatePulse = pr(late);
    out.quality.recovery = quality(session, rec.start, rec.end);
    // Share of the task rise that is gone by the end of recovery (1 = back to rest).
    if (out.pulseChange && out.pulseChange > 0 && out.recoveryLatePulse != null) {
      out.recovered = round((out.taskPulse - out.recoveryLatePulse) / out.pulseChange, 2);
    }
  }
  return out;
}

// Camera pulse vs a partner's 30-second wrist count (x2 = beats per minute).
export function pulsecheckResults(session) {
  const ref = phase(session, 'ref');
  if (!ref) return null;
  const sdk = mean(vals(session.samples.pulse, ref.start, ref.end));
  const count = session.answers?.ref;
  // The partner counts for the timed 30 s shown on screen.
  const secs = ref.planned ?? (ref.end - ref.start);
  const reference = count == null || count === '' ? null : Number(count) * (60 / secs);
  return {
    cameraPulse: round(sdk),
    referencePulse: round(reference),
    error: sdk != null && reference != null ? round(sdk - reference) : null,
    quality: quality(session, ref.start, ref.end),
  };
}

export function analyse(session) {
  switch (session.protocol) {
    case 'breathing': return breathingResults(session);
    case 'heartbeat': return heartbeatResults(session);
    case 'stress': return stressResults(session);
    case 'pulsecheck': return pulsecheckResults(session);
    default: return null;
  }
}
