// Summarises an exported practical-data.json into the accuracy tables used in
// the write-up. Usage: node scripts/eval.mjs path/to/practical-data.json
import { readFileSync } from 'node:fs';
import { analyse, mean, round } from '../src/analysis.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/eval.mjs practical-data.json');
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
const sessions = data.sessions.filter((s) => !s.demo);
const people = new Set(sessions.map((s) => s.participant));
const cam = sessions.reduce((a, s) => a + (s.cameraSeconds || 0), 0);
console.log(`\n${sessions.length} sessions, ${people.size} participants, ${Math.round(cam / 60)} min of camera (${Math.ceil(cam / 30)} credits)\n`);

const abs = (xs) => round(mean(xs.map(Math.abs)));
const fmt = (v) => (v == null ? '—' : v);

// Paced breathing: SDK rate and our own trace count vs the pacer.
const br = sessions.filter((s) => s.protocol === 'breathing').map((s) => ({ s, r: analyse(s) }));
if (br.length) {
  console.log('## Paced breathing (breaths/min)\n');
  console.log('| Pacer | Blocks | Camera rate, mean |error| | Within ±1 | Chest-trace count |error| | Belly-trace count |error| |');
  console.log('|---|---|---|---|---|---|');
  for (const rate of [6, 10, 15]) {
    const rows = br.flatMap(({ r }) => r.rows.filter((x) => x.target === rate));
    const e = rows.map((x) => x.sdkError).filter((x) => x != null);
    const c = rows.map((x) => (x.chestTraceRate == null ? null : x.chestTraceRate - rate)).filter((x) => x != null);
    const b = rows.map((x) => (x.bellyTraceRate == null ? null : x.bellyTraceRate - rate)).filter((x) => x != null);
    console.log(`| ${rate} | ${rows.length} | ${fmt(abs(e))} | ${e.filter((x) => Math.abs(x) <= 1).length}/${e.length} | ${fmt(abs(c))} | ${fmt(abs(b))} |`);
  }
  console.log('');
}

// Pulse vs partner's wrist count.
const pc = sessions.filter((s) => s.protocol === 'pulsecheck').map((s) => analyse(s)).filter((r) => r && r.error != null);
if (pc.length) {
  const e = pc.map((r) => r.error);
  console.log('## Camera pulse vs wrist count (beats/min)\n');
  console.log(`| Checks | Mean |error| | Bias (camera − wrist) | Within ±5 | Largest error |`);
  console.log('|---|---|---|---|---|');
  console.log(`| ${e.length} | ${abs(e)} | ${round(mean(e))} | ${e.filter((x) => Math.abs(x) <= 5).length}/${e.length} | ${Math.max(...e.map(Math.abs))} |\n`);
}

// Heartbeat counting.
const hb = sessions.filter((s) => s.protocol === 'heartbeat').map((s) => ({ p: s.participant, r: analyse(s) }));
if (hb.length) {
  console.log('## Heartbeat counting\n');
  console.log('| Code | Counted / true (25 s, 35 s, 45 s) | Accuracy |');
  console.log('|---|---|---|');
  for (const { p, r } of hb) {
    console.log(`| ${p} | ${r.rows.map((x) => `${fmt(x.reported)} / ${fmt(x.trueBeats)}`).join(', ')} | ${r.interoceptiveAccuracy == null ? '—' : Math.round(r.interoceptiveAccuracy * 100) + '%'} |`);
  }
  console.log('');
}

// Mental arithmetic.
const st = sessions.filter((s) => s.protocol === 'stress').map((s) => ({ p: s.participant, r: analyse(s) })).filter((x) => x.r);
if (st.length) {
  console.log('## Mental arithmetic (beats/min)\n');
  console.log('| Code | Rest | Task | Change | Recovered after 60 s | Talking during task |');
  console.log('|---|---|---|---|---|---|');
  for (const { p, r } of st) {
    console.log(`| ${p} | ${fmt(r.restPulse)} | ${fmt(r.taskPulse)} | ${fmt(r.pulseChange)} | ${r.recovered == null ? '—' : Math.round(Math.min(1, r.recovered) * 100) + '%'} | ${r.quality?.task?.talkingShare == null ? '—' : Math.round(r.quality.task.talkingShare * 100) + '%'} |`);
  }
  console.log('');
}
