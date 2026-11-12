// DEMO-MODE stand-in for the SmartSpectra renderer SDK.
// It produces SYNTHETIC numbers that follow the experiment (the pacer rate,
// a pulse rise during the arithmetic task) so the interface can be built and
// tested without a camera, an API key or any credits. It never measures
// anything, and every screen built with it says "demo data".

export const ProcessingStatus = { kUninitialized: 0, kIdle: 1, kStarting: 2, kRunning: 3, kStopping: 4, kError: 5 };
export const ValidationCode = { kOk: 0, kNoFaceFound: 1, kCameraTuning: 10 };
export const breathingMetrics = [0, 1, 2];
export const cardioMetrics = [15, 16, 17];
export const faceMetrics = [11, 12, 13, 14];

// In demo mode "decoding" is a pass-through: the mock already emits objects.
export function decodeMetrics(buf) { return buf; }

function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class SmartSpectraSDK {
  static version = 'demo';

  constructor() {
    this.handlers = {};
    this.processingStatus = ProcessingStatus.kIdle;
    this.timers = [];
  }

  on(event, cb) { (this.handlers[event] ||= []).push(cb); return this; }
  emit(event, ...args) { for (const cb of this.handlers[event] || []) cb(...args); }
  useMediaStream() { return this; }

  setStatus(s) { this.processingStatus = s; this.emit('processingStatus', s); }

  makeStream() {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    const draw = () => {
      const t = performance.now() / 1000;
      const target = (window.__practicalMock?.breathRate ?? 14) / 60;
      g.fillStyle = '#d9d2c3'; g.fillRect(0, 0, 640, 480);
      g.fillStyle = '#b9ae99';
      const s = 1 + 0.03 * Math.sin(2 * Math.PI * target * t);
      g.beginPath(); g.ellipse(320, 470, 190 * s, 120 * s, 0, Math.PI, 0); g.fill();
      g.beginPath(); g.arc(320, 210, 88, 0, Math.PI * 2); g.fill();
    };
    draw();
    this.timers.push(setInterval(draw, 66));
    return c.captureStream(15);
  }

  async start() {
    this.setStatus(ProcessingStatus.kStarting);
    this.emit('streamAvailable', this.makeStream());
    await new Promise((r) => setTimeout(r, 400));
    this.setStatus(ProcessingStatus.kRunning);
    const nowUs = () => Date.now() * 1000;
    this.emit('validationStatus', ValidationCode.kCameraTuning, nowUs(), '');
    this.timers.push(setTimeout(() => this.emit('validationStatus', ValidationCode.kOk, nowUs(), ''), 1800));

    let phase = 0;
    let br = 14;
    let pulse = 72 + gauss() * 2;
    const base = pulse;
    let last = performance.now();

    // 30 Hz traces, delivered in 100 ms slices like the real SDK's windows.
    this.timers.push(setInterval(() => {
      const mock = window.__practicalMock || {};
      const rate = mock.breathRate ?? 14;
      const now = performance.now();
      const upper = [], lower = [];
      const n = 3;
      for (let i = 0; i < n; i++) {
        phase += (2 * Math.PI * rate / 60) * ((now - last) / 1000 / n);
        const ts = (Date.now() - ((n - 1 - i) * 33)) * 1000;
        upper.push({ value: 0.5 * Math.sin(phase) + 0.08 * gauss(), timestamp: ts });
        lower.push({ value: 1.0 * Math.sin(phase - 0.3) + 0.08 * gauss(), timestamp: ts });
      }
      last = now;
      this.emit('metrics', { breathing: { upperTrace: upper, lowerTrace: lower } }, nowUs());
    }, 100));

    // Rates once a second, with the lag a windowed estimate has.
    this.timers.push(setInterval(() => {
      const mock = window.__practicalMock || {};
      const rate = mock.breathRate ?? 14;
      br += (rate - br) / 8;
      const target = base + (mock.pulseShift ?? 0);
      pulse += (target - pulse) / 6 + gauss() * 0.6;
      const ts = nowUs();
      this.emit('metrics', {
        breathing: { rate: [{ value: br + gauss() * 0.4, confidence: 0.8, stable: true, timestamp: ts }] },
        cardio: { pulseRate: [{ value: pulse, confidence: 0.75, stable: true, timestamp: ts }] },
        face: {
          talking: [{ detected: false, stable: true, timestamp: ts }],
          blinking: [{ detected: Math.random() < 0.25, stable: true, timestamp: ts }],
        },
      }, ts);
    }, 1000));
  }

  async stop() {
    for (const t of this.timers) { clearInterval(t); clearTimeout(t); }
    this.timers = [];
    this.setStatus(ProcessingStatus.kIdle);
  }

  async reset() { await this.stop(); }
  destroy() { for (const t of this.timers) { clearInterval(t); clearTimeout(t); } }
}
