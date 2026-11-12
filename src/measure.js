// Wraps the SmartSpectra renderer SDK and records everything a session needs.
// The camera only runs between start() and stop(); every second it runs is
// counted, because the free tier is 1 credit per 30 s.
import {
  SmartSpectraSDK, ProcessingStatus, ValidationCode,
} from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

// Breathing (chest + belly traces + rate), pulse rate, the pulse wave
// (arterial pressure trace, used to count beats ourselves) and blink/talking
// detection. Talking is only used as a data-quality flag.
const REQUESTED = [0, 1, 2, 15, 16, 12, 13];

export const VALIDATION_HINTS = {
  0: 'Good. Hold still.',
  1: 'No face found. Sit in front of the camera.',
  2: 'More than one face. Only the person being measured should be in view.',
  3: 'Move to the centre of the picture.',
  4: 'Move a little closer or further away.',
  5: 'Too dark. Turn on a light in front of you.',
  6: 'Too bright. Move away from the window or lamp behind the camera.',
  7: 'Your chest is not visible. Sit a bit further back.',
  10: 'Camera is adjusting…',
  11: 'The camera frame rate is too low. Close other apps using the camera.',
  12: 'Too much movement. Keep your head and body still.',
  13: 'Too close. Move back a little.',
  14: 'Too far. Move a little closer.',
  15: 'Too high in the picture. Move down a little or tilt the screen.',
  16: 'Too low in the picture. Sit up or tilt the screen down.',
  17: 'Look straight at the screen.',
};

const ERROR_HINTS = {
  2: 'The API key was rejected. Check PRESAGE_API_KEY in your .env file and rebuild.',
  4: 'Your Presage credits are used up. Ask the Presage team on Discord for more.',
  5: 'No internet connection. The SDK needs the internet while it measures.',
  7: 'The camera is not available. Close other apps that use it and try again.',
};

function tsMs(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number') return ts / 1000;
  if (typeof ts === 'bigint') return Number(ts) / 1000;
  if (typeof ts.toNumber === 'function') return ts.toNumber() / 1000;
  return Number(ts) / 1000;
}

export class Measurement {
  constructor({ apiKey, onUpdate, onStatus, onValidation, onError, onStream }) {
    this.apiKey = apiKey;
    this.cb = { onUpdate, onStatus, onValidation, onError, onStream };
    this.sdk = null;
    this.reset();
  }

  reset() {
    this.raw = { pulse: [], br: [], upper: [], lower: [], wave: [], blink: [], talking: [], validation: [] };
    this.offset = null; // receivedAt - sdkTimestamp, in ms (minimum seen)
    this.startedAt = null;
    this.runningSince = null;
    this.runningMs = 0;
    this.lastValidation = null;
  }

  // Map an SDK timestamp onto the wall clock, learning the offset from the
  // events themselves (the SDK clock and Date.now() need not share an epoch).
  learn(ms) {
    if (ms == null) return;
    const d = Date.now() - ms;
    if (this.offset == null || d < this.offset) this.offset = d;
  }

  wall(ms) { return ms + (this.offset ?? 0); }

  async start() {
    this.reset();
    this.startedAt = Date.now();
    this.sdk = new SmartSpectraSDK({
      apiKey: this.apiKey,
      requestedMetrics: REQUESTED,
      enableAccumulatedOutput: false,
      enableTelemetry: false,
    });
    const sdk = this.sdk;

    sdk.on('processingStatus', (s) => {
      if (s === ProcessingStatus.kRunning && this.runningSince == null) this.runningSince = Date.now();
      if (s !== ProcessingStatus.kRunning && this.runningSince != null) {
        this.runningMs += Date.now() - this.runningSince;
        this.runningSince = null;
      }
      this.cb.onStatus?.(s);
    });

    sdk.on('validationStatus', (code, ts) => {
      const ms = tsMs(ts);
      this.learn(ms);
      this.raw.validation.push([ms ?? Date.now() - (this.offset ?? 0), code]);
      this.lastValidation = code;
      this.cb.onValidation?.(code, VALIDATION_HINTS[code] || `Status ${code}`);
    });

    sdk.on('metrics', (buf) => {
      let m;
      try { m = decodeMetrics(buf); } catch { return; }
      const push = (list, arr, withConf) => {
        for (const x of arr || []) {
          const ms = tsMs(x.timestamp);
          if (ms == null) continue;
          this.learn(ms);
          // Rates keep confidence (0-100) and the SDK's own "stable" verdict
          // (pulse: confidence >= 40, about +/-3 bpm; breathing: >= 45).
          list.push(withConf ? [ms, x.value, x.confidence ?? null, x.stable ? 1 : 0] : [ms, x.value]);
        }
      };
      push(this.raw.pulse, m.cardio?.pulseRate, true);
      push(this.raw.br, m.breathing?.rate, true);
      push(this.raw.upper, m.breathing?.upperTrace, false);
      push(this.raw.lower, m.breathing?.lowerTrace, false);
      push(this.raw.wave, m.cardio?.arterialPressureTrace, false);
      for (const [key, arr] of [['blink', m.face?.blinking], ['talking', m.face?.talking]]) {
        for (const x of arr || []) {
          const ms = tsMs(x.timestamp);
          if (ms != null) this.raw[key].push([ms, x.detected ? 1 : 0]);
        }
      }
      this.cb.onUpdate?.(this.live());
    });

    sdk.on('error', (code, message, retryable) => {
      this.cb.onError?.({ code, message, retryable, hint: ERROR_HINTS[code] || null });
    });

    sdk.on('streamAvailable', (stream) => this.cb.onStream?.(stream));
    await sdk.start();
  }

  // Latest values for the live display, on seconds-since-start.
  live() {
    const t = (ms) => (this.wall(ms) - this.startedAt) / 1000;
    const last = (a) => (a.length ? a[a.length - 1] : null);
    const lp = last(this.raw.pulse), lb = last(this.raw.br);
    const tail = (a, n) => a.slice(-n).map((s) => [t(s[0]), s[1]]);
    return {
      pulse: lp ? lp[1] : null,
      pulseConfidence: lp ? lp[2] : null,
      pulseStable: lp ? lp[3] === 1 : false,
      breathingStable: lb ? lb[3] === 1 : false,
      breathing: lb ? lb[1] : null,
      upper: tail(this.raw.upper, 450),
      lower: tail(this.raw.lower, 450),
      pulseSeries: tail(this.raw.pulse, 120),
      talking: last(this.raw.talking)?.[1] === 1,
    };
  }

  async stop() {
    if (!this.sdk) return;
    const sdk = this.sdk;
    this.sdk = null;
    try { await sdk.stop(); } catch { /* already stopped */ }
    if (this.runningSince != null) {
      this.runningMs += Date.now() - this.runningSince;
      this.runningSince = null;
    }
    try { sdk.destroy(); } catch { /* already destroyed */ }
  }

  // Everything on one clock: seconds since start().
  samples() {
    const t = (ms) => Math.round(((this.wall(ms) - this.startedAt) / 1000) * 1000) / 1000;
    const map = (a) => a.map(([ms, ...rest]) => [t(ms), ...rest]);
    return {
      samples: {
        pulse: map(this.raw.pulse), br: map(this.raw.br),
        upper: map(this.raw.upper), lower: map(this.raw.lower), wave: map(this.raw.wave),
        blink: map(this.raw.blink), talking: map(this.raw.talking),
      },
      validation: map(this.raw.validation),
      cameraSeconds: Math.round(this.runningMs / 1000),
    };
  }
}

export { ProcessingStatus, ValidationCode };
