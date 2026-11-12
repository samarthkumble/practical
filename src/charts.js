// Small canvas line charts (no chart library needed).

export function lineChart(canvas, series, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 180;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim() || '#1f2a44';
  const faint = css.getPropertyValue('--rule').trim() || '#d8d2c4';
  const muted = css.getPropertyValue('--muted').trim() || '#6b6558';

  const pad = { l: 44, r: 12, t: 10, b: 26 };
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) {
    g.fillStyle = muted; g.font = '13px system-ui'; g.fillText(opts.empty || 'No data yet', pad.l, h / 2);
    return;
  }
  let x0 = opts.xMin ?? Math.min(...pts.map((p) => p[0]));
  let x1 = opts.xMax ?? Math.max(...pts.map((p) => p[0]));
  let y0 = opts.yMin ?? Math.min(...pts.map((p) => p[1]));
  let y1 = opts.yMax ?? Math.max(...pts.map((p) => p[1]));
  for (const r of opts.refLines || []) {
    if (opts.yMin == null) y0 = Math.min(y0, r.y);
    if (opts.yMax == null) y1 = Math.max(y1, r.y);
  }
  if (x1 === x0) x1 = x0 + 1;
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  if (opts.yPad !== false && opts.yMin == null) { const d = (y1 - y0) * 0.1; y0 -= d; y1 += d; }

  const X = (x) => pad.l + ((x - x0) / (x1 - x0)) * (w - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - y0) / (y1 - y0)) * (h - pad.t - pad.b);

  // Shaded bands (e.g. experiment phases).
  for (const b of opts.bands || []) {
    g.fillStyle = b.color;
    g.fillRect(X(b.from), pad.t, X(b.to) - X(b.from), h - pad.t - pad.b);
    if (b.label) {
      g.fillStyle = muted; g.font = '11px system-ui';
      g.fillText(b.label, X(b.from) + 4, pad.t + 12);
    }
  }

  // Grid and axes.
  g.strokeStyle = faint; g.lineWidth = 1; g.fillStyle = muted; g.font = '11px system-ui';
  for (let i = 0; i <= 4; i++) {
    const y = y0 + ((y1 - y0) * i) / 4;
    g.beginPath(); g.moveTo(pad.l, Y(y)); g.lineTo(w - pad.r, Y(y)); g.stroke();
    if (opts.yTicks !== false) g.fillText(y1 - y0 < 8 ? y.toFixed(1) : fmt(y), 4, Y(y) + 4);
  }
  const step = niceStep((x1 - x0) / 6);
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    const label = `${fmt(x)}${opts.xUnit ?? 's'}`;
    const lw = g.measureText(label).width;
    const lx = Math.min(X(x) - lw / 2, w - lw - 2);
    g.fillText(label, lx, h - 8);
  }

  for (const r of opts.refLines || []) {
    g.strokeStyle = r.color; g.setLineDash([5, 4]); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(X(r.from ?? x0), Y(r.y)); g.lineTo(X(r.to ?? x1), Y(r.y)); g.stroke();
    g.setLineDash([]);
  }

  for (const s of series) {
    if (!s.points.length) continue;
    g.strokeStyle = s.color || ink; g.lineWidth = s.width || 1.6;
    g.beginPath();
    s.points.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
    g.stroke();
    if (s.dots) {
      g.fillStyle = s.color || ink;
      for (const p of s.points) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 2.4, 0, Math.PI * 2); g.fill(); }
    }
  }
}

function fmt(v) {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(0) : v.toFixed(1);
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 5, 10]) if (raw <= m * p) return m * p;
  return 10 * p;
}
