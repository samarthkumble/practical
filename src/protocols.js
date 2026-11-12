// The four experiments. Each is a list of timed phases; the runner walks
// through them while the SDK measures. Durations are chosen to stay inside a
// free Presage tier (1 credit = 30 s of measurement).

export const PROTOCOLS = {
  breathing: {
    id: 'breathing',
    title: 'Paced breathing',
    tagline: 'Does the camera see the breathing rate you were told to keep?',
    why: 'Breathing rate is easy to control, so it is the cleanest test of a sensor: '
       + 'you breathe with a pacer at a known rate, and we compare that known rate with what the camera measured.',
    answerKey: 'The pacer rate is the right answer.',
    phases: [
      { id: 'settle', kind: 'settle', label: 'Settle in', seconds: 20,
        say: 'Sit still, look at the screen and breathe normally while the camera finds you.' },
      { id: 'pace6', kind: 'pace', rate: 6, label: '6 breaths a minute', seconds: 60,
        say: 'Breathe in as the circle grows, out as it shrinks.' },
      { id: 'pace10', kind: 'pace', rate: 10, label: '10 breaths a minute', seconds: 60,
        say: 'A little faster now. Follow the circle.' },
      { id: 'pace15', kind: 'pace', rate: 15, label: '15 breaths a minute', seconds: 60,
        say: 'Faster again. Keep following the circle.' },
    ],
  },

  heartbeat: {
    id: 'heartbeat',
    title: 'Heartbeat counting',
    tagline: 'How well can you feel your own heartbeat?',
    why: 'The heartbeat counting task (Schandry, 1981) measures interoception, the sense of what is happening '
       + 'inside your body. Labs normally need an ECG for it; here the camera gives the true count.',
    answerKey: 'The camera pulse gives the true number of beats in each interval.',
    phases: [
      { id: 'settle', kind: 'settle', label: 'Settle in', seconds: 20,
        say: 'Sit still and breathe normally. Do not touch your wrist or neck.' },
      { id: 'count25', kind: 'count', label: 'Count your heartbeats', seconds: 25,
        say: 'Silently count every heartbeat you can feel. Do not guess, and do not touch your pulse.' },
      { id: 'answer25', kind: 'answer', label: 'How many?', seconds: 15, answerFor: 'count25',
        say: 'Type how many beats you counted.' },
      { id: 'count35', kind: 'count', label: 'Count your heartbeats', seconds: 35,
        say: 'Again: count every heartbeat you feel.' },
      { id: 'answer35', kind: 'answer', label: 'How many?', seconds: 15, answerFor: 'count35',
        say: 'Type how many beats you counted.' },
      { id: 'count45', kind: 'count', label: 'Count your heartbeats', seconds: 45,
        say: 'Last one: count every heartbeat you feel.' },
      { id: 'answer45', kind: 'answer', label: 'How many?', seconds: 15, answerFor: 'count45',
        say: 'Type how many beats you counted.' },
    ],
  },

  stress: {
    id: 'stress',
    title: 'Mental arithmetic and recovery',
    tagline: 'What does a hard sum do to your pulse, and how fast does it come back?',
    why: 'Mental arithmetic is a classic laboratory stressor. Pulse usually rises during the task and falls back '
       + 'afterwards. Your own rest period is the baseline, so nobody is compared with strangers.',
    answerKey: 'Your own rest period is the baseline.',
    phases: [
      { id: 'settle', kind: 'settle', label: 'Settle in', seconds: 20,
        say: 'Sit still and breathe normally.' },
      { id: 'rest', kind: 'rest', label: 'Rest', seconds: 60,
        say: 'Just rest and look at the dot.' },
      { id: 'task', kind: 'task', label: 'Count backwards by 7', seconds: 60, startNumber: 1000,
        say: 'In your head, count backwards from 1000 in steps of 7, as fast as you can. Keep your head still and do not speak.' },
      { id: 'taskAnswer', kind: 'answer', label: 'Where did you get to?', seconds: 10, answerFor: 'task',
        say: 'Type the last number you reached.' },
      { id: 'recovery', kind: 'rest', label: 'Recovery', seconds: 60,
        say: 'Done. Rest and let your breathing settle.' },
    ],
  },

  pulsecheck: {
    id: 'pulsecheck',
    title: 'Pulse check',
    tagline: 'Is the camera pulse right? A partner counts your wrist pulse at the same time.',
    why: 'A partner counts the radial (wrist) pulse for 30 seconds while the camera measures. '
       + 'That hand count is the reference we compare the camera with.',
    answerKey: 'Your partner’s 30-second wrist count, doubled, is the reference.',
    needsPartner: true,
    phases: [
      { id: 'settle', kind: 'settle', label: 'Settle in', seconds: 15,
        say: 'Rest your arm on the table, palm up. Your partner finds your wrist pulse.' },
      { id: 'ref', kind: 'ref', label: 'Partner: count now', seconds: 30,
        say: 'Partner: count every beat at the wrist until the timer ends. Person measured: keep still and look at the screen.' },
      { id: 'refAnswer', kind: 'answer', label: 'Partner’s count', seconds: 20, answerFor: 'ref', stopCamera: true,
        say: 'Partner: type the number of beats you counted in 30 seconds.' },
    ],
  },
};

export const PROTOCOL_ORDER = ['breathing', 'heartbeat', 'stress', 'pulsecheck'];

// Seconds the camera runs for a protocol (answer phases marked stopCamera end it early).
export function cameraSeconds(protocol) {
  let s = 0;
  for (const p of protocol.phases) {
    if (p.stopCamera) break;
    s += p.seconds;
  }
  return s;
}

export function creditEstimate(protocol) {
  return Math.ceil(cameraSeconds(protocol) / 30);
}
