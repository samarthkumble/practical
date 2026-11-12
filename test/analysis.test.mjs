import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  traceRate, breathingResults, heartbeatResults, stressResults, pulsecheckResults, quality, median,
} from '../src/analysis.js';

// Seeded noise so tests are repeatable.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; };
}

function sine(rate, t0, t1, { hz = 30, amp = 1, noise = 0.1, drift = 0, seed = 1 } = {}) {
  const r = rng(seed);
  const out = [];
  for (let t = t0; t <= t1; t += 1 / hz) {
    out.push([t, amp * Math.sin(2 * Math.PI * (rate / 60) * t) + noise * r() + drift * t]);
  }
  return out;
}

const emptySamples = () => ({ pulse: [], br: [], upper: [], lower: [], blink: [], talking: [] });

test('traceRate recovers known breathing rates from noisy, drifting traces', () => {
  for (const rate of [6, 10, 15, 20]) {
    const tr = sine(rate, 0, 60, { noise: 0.3, drift: 0.01, seed: rate });
    const { rate: got } = traceRate(tr, 0, 60);
    assert.ok(Math.abs(got - rate) < 0.6, `expected ~${rate}, got ${got}`);
  }
});

test('traceRate refuses flat or tiny windows instead of inventing a number', () => {
  assert.equal(traceRate([[0, 1], [1, 1]], 0, 1).rate, null);
  const flat = Array.from({ length: 300 }, (_, i) => [i / 30, 0.5]);
  assert.equal(traceRate(flat, 0, 10).rate, null);
});

test('breathingResults compares the SDK rate with the pacer and counts breaths independently', () => {
  const s = {
    phases: [
      { id: 'settle', kind: 'settle', start: 0, end: 20 },
      { id: 'pace6', kind: 'pace', rate: 6, start: 20, end: 80 },
      { id: 'pace15', kind: 'pace', rate: 15, start: 80, end: 140 },
    ],
    samples: emptySamples(),
    validation: [[0, 10], [2, 0]],
  };
  s.samples.upper = [...sine(6, 20, 80, { amp: 0.4, seed: 3 }), ...sine(15, 80.01, 140, { amp: 0.4, seed: 4 })];
  s.samples.lower = [...sine(6, 20, 80, { amp: 1, seed: 5 }), ...sine(15, 80.01, 140, { amp: 1, seed: 6 })];
  for (let t = 20; t <= 140; t++) s.samples.br.push([t, t <= 80 ? 6.5 : 14, 0.8]);

  const r = breathingResults(s);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].sdkRate, 6.5);
  assert.equal(r.rows[0].sdkError, 0.5);
  assert.equal(r.rows[1].sdkError, -1);
  assert.equal(r.meanAbsError, 0.8);
  assert.ok(Math.abs(r.rows[0].bellyTraceRate - 6) < 0.6);
  assert.ok(Math.abs(r.rows[1].chestTraceRate - 15) < 0.6);
  assert.ok(r.rows[0].bellyShare > 0.6, 'belly moved more than chest');
  assert.equal(r.rows[0].quality.framingProblemShare, 0);
});

test('heartbeatResults scores interoceptive accuracy the Schandry way', () => {
  const s = {
    phases: [
      { id: 'count25', kind: 'count', start: 20, end: 45 },
      { id: 'count35', kind: 'count', start: 60, end: 95 },
    ],
    samples: emptySamples(),
    validation: [[0, 0]],
    answers: { count25: 20, count35: 42 },
  };
  for (let t = 0; t <= 100; t++) s.samples.pulse.push([t, 72, 0.8]);
  const r = heartbeatResults(s);
  // 72 bpm over 25 s = 30 true beats; counted 20 -> 1 - 10/30 = 0.67
  assert.equal(r.rows[0].trueBeats, 30);
  assert.equal(r.rows[0].accuracy, 0.67);
  // 35 s -> 42 beats; counted 42 -> 1.0
  assert.equal(r.rows[1].accuracy, 1);
  assert.equal(r.interoceptiveAccuracy, 0.84);
});

test('heartbeatResults leaves accuracy empty when there was no answer or no pulse', () => {
  const s = { phases: [{ id: 'count25', kind: 'count', start: 0, end: 25 }], samples: emptySamples(), validation: [], answers: {} };
  const r = heartbeatResults(s);
  assert.equal(r.rows[0].accuracy, null);
  assert.equal(r.interoceptiveAccuracy, null);
});

test('stressResults measures the rise and the recovery against the person’s own rest', () => {
  const s = {
    phases: [
      { id: 'rest', kind: 'rest', start: 20, end: 80 },
      { id: 'task', kind: 'task', start: 80, end: 140 },
      { id: 'recovery', kind: 'rest', start: 150, end: 210 },
    ],
    samples: emptySamples(), validation: [[0, 0]], answers: { task: 874 },
  };
  for (let t = 0; t <= 210; t++) {
    const v = t < 80 ? 70 : t < 150 ? 80 : 72;
    s.samples.pulse.push([t, v, 0.8]);
    s.samples.br.push([t, t < 80 ? 13 : 16, 0.8]);
  }
  const r = stressResults(s);
  assert.equal(r.restPulse, 70);
  assert.equal(r.taskPulse, 80);
  assert.equal(r.pulseChange, 10);
  assert.equal(r.recoveryLatePulse, 72);
  assert.equal(r.recovered, 0.8);
  assert.equal(r.answer, 874);
});

test('pulsecheckResults compares with the partner’s 30 s wrist count', () => {
  const s = { phases: [{ id: 'ref', kind: 'ref', start: 15, end: 45 }], samples: emptySamples(), validation: [[0, 0]], answers: { ref: 38 } };
  for (let t = 0; t <= 45; t++) s.samples.pulse.push([t, 79, 0.8]);
  const r = pulsecheckResults(s);
  assert.equal(r.referencePulse, 76);
  assert.equal(r.cameraPulse, 79);
  assert.equal(r.error, 3);
});

test('quality reports framing problems and talking time inside a window', () => {
  const s = { samples: { ...emptySamples(), talking: [[1, 0], [2, 1], [3, 1], [4, 0]] }, validation: [[0, 0], [5, 12], [8, 0]] };
  const q = quality(s, 0, 10);
  assert.equal(q.framingProblemShare, 0.3);
  assert.equal(q.talkingShare, 0.5);
});

test('median handles even and odd lengths', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test('stableRate uses only readings the SDK marked stable, and refuses when there are too few', async () => {
  const { stableRate } = await import('../src/analysis.js');
  const s = [];
  for (let t = 0; t < 30; t++) s.push([t, t < 15 ? 60 : 78, t < 15 ? 20 : 70, t < 15 ? 0 : 1]);
  const r = stableRate(s, 0, 30);
  assert.equal(r.value, 78);
  assert.equal(r.allValue, 69);
  assert.equal(r.stableShare, 0.5);
  const none = stableRate(s, 0, 15);
  assert.equal(none.value, null, 'no stable readings -> no number');
  assert.equal(none.allValue, 60);
});

test('waveRate counts beats in a pulse wave with breathing wander on top', async () => {
  const { waveRate } = await import('../src/analysis.js');
  const r = rng(9);
  for (const bpm of [55, 72, 95]) {
    const wave = [];
    for (let t = 0; t <= 30; t += 1 / 30) {
      const beat = Math.sin(2 * Math.PI * (bpm / 60) * t);
      const breath = 2 * Math.sin(2 * Math.PI * (14 / 60) * t);
      wave.push([t, beat + breath + 0.15 * r()]);
    }
    const got = waveRate(wave, 0, 30).rate;
    assert.ok(Math.abs(got - bpm) < 2, `expected ~${bpm}, got ${got}`);
  }
});

test('pulsecheckResults reports stable, all-readings and pulse-wave errors separately', () => {
  const s = { phases: [{ id: 'ref', kind: 'ref', planned: 30, start: 0, end: 30 }], samples: emptySamples(), validation: [[0, 0]], answers: { ref: 39 } };
  for (let t = 0; t < 30; t++) s.samples.pulse.push([t, t % 2 ? 62 : 80, t % 2 ? 30 : 60, t % 2 ? 0 : 1]);
  const r = pulsecheckResults(s);
  assert.equal(r.referencePulse, 78);
  assert.equal(r.cameraPulse, 80);
  assert.equal(r.error, 2);
  assert.equal(r.errorAllReadings, -7);
  assert.equal(r.quality.pulseStableShare, 0.5);
  assert.equal(r.waveRate, null);
});

test('waveRate ignores stretches where the SDK reported a framing problem', async () => {
  const { waveRate } = await import('../src/analysis.js');
  const r = rng(11);
  const wave = [];
  for (let t = 0; t <= 30; t += 1 / 30) {
    // Clean 70 bpm for 0-18 s, then a framing problem: wave collapses to noise.
    wave.push([t, t < 18 ? Math.sin(2 * Math.PI * (70 / 60) * t) + 0.1 * r() : 0.3 * r()]);
  }
  const val = [[0, 0], [18, 12]];
  const got = waveRate(wave, 0, 30, val);
  assert.ok(Math.abs(got.rate - 70) < 2, `expected ~70, got ${got.rate}`);
  assert.equal(Math.round(got.seconds), 18);
});

test('quality names the framing problem that took up the most time', () => {
  const s = { samples: emptySamples(), validation: [[0, 0], [2, 5], [6, 0], [7, 12], [8, 0]] };
  const q = quality(s, 0, 10);
  assert.equal(q.topProblem, 5);
  assert.equal(q.framingProblemShare, 0.5);
});
