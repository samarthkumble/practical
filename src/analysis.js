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

// Cycles per minute counted directly from a raw trace (breaths in a chest or
// belly trace, or beats in the pulse wave): remove the slow drift, smooth,
// then count upward crossings of zero with a small dead band so noise does
// not count as a cycle. The rate uses the time between the first and last
// crossing, so partial cycles at the edges do not bias it.
//   smooth:   moving-average width in seconds
//   highpass: if set, subtract a moving average this wide (seconds) instead
//             of a straight line, to remove breathing/motion wander
export function traceRate(trace, t0, t1, { smooth = 0.6, highpass = null } = {}) {
  const pts = inWindow(trace, t0, t1);
  if (pts.length < 20) return { rate: null, breaths: 0 };
  const ts = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  const dt = (ts[ts.length - 1] - ts[0]) / (ts.length - 1) || 0.033;
  const movavg = (xs, width) => {
    const half = Math.max(1, Math.round(width / 2 / dt));
    return xs.map((_, i) => {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(xs.length - 1, i + half); j++) { s += xs[j]; n++; }
      return s / n;
    });
  };

  let detr;
  if (highpass) {
    const base = movavg(vs, highpass);
    detr = vs.map((v, i) => v - base[i]);
  } else {
    const tm = mean(ts), vm = mean(vs);
    let num = 0, den = 0;
    for (let i = 0; i < ts.length; i++) { num += (ts[i] - tm) * (vs[i] - vm); den += (ts[i] - tm) ** 2; }
    const slope = den ? num / den : 0;
    detr = vs.map((v, i) => v - vm - slope * (ts[i] - tm));
  }
  const sm = movavg(detr, smooth);

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

// Pulse (beats/min) counted from the SDK's pulse wave (arterial pressure
// trace), independent of the SDK's own pulse estimate.
export function waveRate(wave, t0, t1) {
  const r = traceRate(wave, t0, t1, { smooth: 0.12, highpass: 1.4 });
  if (r.rate == null || r.rate < 35 || r.rate > 190) return { rate: null, beats: r.breaths };
  return { rate: r.rate, beats: r.breaths };
}

// A rate (pulse or breathing) over a window, using only readings the SDK
// marks as stable (its own accuracy verdict). Returns null rather than a
// number built from unstable readings.
export function stableRate(samples, t0, t1, { agg = mean, min = 3 } = {}) {
  const w = inWindow(samples, t0, t1).filter((s) => s[1] != null && s[1] > 0);
  const st = w.filter((s) => s[3] === 1 || s[3] === undefined);
  return {
    value: st.length >= min ? agg(st.map((s) => s[1])) : null,
    allValue: w.length ? agg(w.map((s) => s[1])) : null,
    readings: w.length,
    stableShare: w.length ? round(st.length / w.length, 2) : null,
  };
}

// Data quality for a window: framing problems reported by the SDK (any
// validation code other than 0 = OK), time spent talking, mean confidence
// (0-100) and the share of readings the SDK itself marked stable.
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
  const pw = inWindow(session.samples.pulse, t0, t1);
  const bw = inWindow(session.samples.br, t0, t1);
  const conf = (w) => {
    const c = w.map((s) => s[2]).filter((x) => x != null);
    return c.length ? round(mean(c), 0) : null;
  };
  const share = (w) => (w.length ? round(w.filter((s) => s[3] === 1 || s[3] === undefined).length / w.length, 2) : null);
  return {
    talkingShare: talking == null ? null : round(talking, 2),
    framingProblemShare: round(bad / Math.max(1e-9, t1 - t0), 2),
    pulseConfidence: conf(pw),
    pulseStableShare: share(pw),
    breathingConfidence: conf(bw),
    breathingStableShare: share(bw),
  };
}

function phase(session, id) {
  return session.phases.find((p) => p.id === id && p.end != null);
}

export function breathingResults(session, { window = 30 } = {}) {
  const rows = [];
  for (const p of session.phases.filter((x) => x.kind === 'pace' && x.end != null)) {
    const w0 = Math.max(p.start, p.end - window);
    const sdk = stableRate(session.samples.br, w0, p.end, { agg: median });
    const chest = traceRate(session.samples.upper, p.start + 10, p.end).rate;
    const belly = traceRate(session.samples.lower, p.start + 10, p.end).rate;
    const chestAmp = std(inWindow(session.samples.upper, p.start + 10, p.end).map((s) => s[1]));
    const bellyAmp = std(inWindow(session.samples.lower, p.start + 10, p.end).map((s) => s[1]));
    rows.push({
      phase: p.id,
      target: p.rate,
      sdkRate: round(sdk.value),
      sdkError: sdk.value == null ? null : round(sdk.value - p.rate),
      sdkRateAllReadings: round(sdk.allValue),
      chestTraceRate: round(chest),
      bellyTraceRate: round(belly),
      bellyShare: chestAmp && bellyAmp ? round(bellyAmp / (chestAmp + bellyAmp), 2) : null,
      quality: quality(session, w0, p.end),
    });
  }
  const errs = rows.map((r) => r.sdkError).filter((e) => e != null).map(Math.abs);
  return { rows, meanAbsError: round(mean(errs)) };
}

// Heartbeat counting: true beats = camera pulse in the interval x its length.
// The SDK's stable pulse is used when there is enough of it; otherwise beats
// counted in the pulse wave; otherwise no score. Interoceptive accuracy per
// trial = 1 - |true - reported| / true (Schandry, 1981).
export function heartbeatResults(session) {
  const rows = [];
  for (const p of session.phases.filter((x) => x.kind === 'count' && x.end != null)) {
    const sdk = stableRate(session.samples.pulse, p.start, p.end);
    const wave = waveRate(session.samples.wave, p.start, p.end).rate;
    const rate = sdk.value ?? wave;
    const seconds = p.end - p.start;
    const actual = rate == null ? null : (rate * seconds) / 60;
    const reported = session.answers?.[p.id];
    const acc = actual && reported != null && reported !== ''
      ? Math.max(0, 1 - Math.abs(actual - Number(reported)) / actual) : null;
    rows.push({
      phase: p.id,
      seconds: round(seconds, 0),
      cameraPulse: round(rate),
      pulseSource: sdk.value != null ? 'sdk-stable' : wave != null ? 'pulse-wave' : null,
      waveRate: round(wave),
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
  const pr = (w) => round(stableRate(session.samples.pulse, w[0], w[1]).value);
  const br = (w) => round(stableRate(session.samples.br, w[0], w[1], { agg: median }).value);
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
// Reports the SDK's stable pulse, the same from all readings, and beats
// counted in the pulse wave, so the write-up can show which one to trust.
export function pulsecheckResults(session) {
  const ref = phase(session, 'ref');
  if (!ref) return null;
  const sdk = stableRate(session.samples.pulse, ref.start, ref.end);
  const wave = waveRate(session.samples.wave, ref.start, ref.end).rate;
  const count = session.answers?.ref;
  // The partner counts for the timed 30 s shown on screen.
  const secs = ref.planned ?? (ref.end - ref.start);
  const reference = count == null || count === '' ? null : Number(count) * (60 / secs);
  const err = (v) => (v != null && reference != null ? round(v - reference) : null);
  return {
    cameraPulse: round(sdk.value),
    cameraPulseAllReadings: round(sdk.allValue),
    waveRate: round(wave),
    referencePulse: round(reference),
    error: err(sdk.value),
    errorAllReadings: err(sdk.allValue),
    waveError: err(wave),
    readings: sdk.readings,
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
