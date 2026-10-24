// Statistics helpers: range stats, histograms, polynomial fits and FFT.

import type { Samples } from './types';

export interface RangeStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  count: number;
  first: number;
  last: number;
}

export function rangeStats(data: Samples | Float64Array, i0: number, i1: number): RangeStats {
  let min = Infinity,
    max = -Infinity,
    s = 0,
    s2 = 0,
    c = 0;
  let first = NaN,
    last = NaN;
  for (let i = Math.max(0, i0); i <= Math.min(data.length - 1, i1); i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (c === 0) first = v;
    last = v;
    if (v < min) min = v;
    if (v > max) max = v;
    s += v;
    s2 += v * v;
    c++;
  }
  const mean = c ? s / c : NaN;
  return {
    min: c ? min : NaN,
    max: c ? max : NaN,
    mean,
    std: c > 1 ? Math.sqrt(Math.max(0, s2 / c - mean * mean)) : 0,
    count: c,
    first,
    last,
  };
}

/** Polynomial least-squares fit. Returns coefficients c0..cd (y = Σ ck x^k) and R². */
export function polyFit(xs: ArrayLike<number>, ys: ArrayLike<number>, degree: number): { coef: number[]; r2: number } | null {
  const n = Math.min(xs.length, ys.length);
  const d = degree + 1;
  const A = Array.from({ length: d }, () => new Float64Array(d + 1));
  let count = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    count++;
    sy += y;
    const pw = new Float64Array(2 * d);
    pw[0] = 1;
    for (let k = 1; k < 2 * d; k++) pw[k] = pw[k - 1] * x;
    for (let r = 0; r < d; r++) {
      for (let c = 0; c < d; c++) A[r][c] += pw[r + c];
      A[r][d] += pw[r] * y;
    }
  }
  if (count <= degree) return null;
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < d; col++) {
    let piv = col;
    for (let r = col + 1; r < d; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    if (Math.abs(A[col][col]) < 1e-12) return null;
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= d; c++) A[r][c] -= f * A[col][c];
    }
  }
  const coef = A.map((row, i) => row[d] / row[i]);
  const meanY = sy / count;
  let ssTot = 0,
    ssRes = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    let p = 0;
    for (let k = d - 1; k >= 0; k--) p = p * x + coef[k];
    ssTot += (y - meanY) ** 2;
    ssRes += (y - p) ** 2;
  }
  return { coef, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 };
}

export const evalPoly = (coef: number[], x: number) => {
  let p = 0;
  for (let k = coef.length - 1; k >= 0; k--) p = p * x + coef[k];
  return p;
};

/** Nice tick step for an axis span. */
export function niceStep(span: number, targetTicks: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, targetTicks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

export function niceTicks(min: number, max: number, target: number): { step: number; ticks: number[] } {
  const step = niceStep(max - min, target);
  const ticks: number[] = [];
  const start = Math.ceil(min / step - 1e-9) * step;
  for (let v = start; v <= max + step * 1e-9 && ticks.length < 200; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { step, ticks };
}

/** Magnitude spectrum (Hann window, radix-2 FFT, zero-padded). */
export function fftMagnitude(x: ArrayLike<number>, rate: number): { freqs: Float64Array; mags: Float64Array } {
  let n = 1;
  while (n < x.length) n <<= 1;
  n = Math.min(n, 1 << 17);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const m = Math.min(x.length, n);
  // Remove the linear trend so slow drift doesn't swamp the spectrum.
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    c = 0;
  for (let i = 0; i < m; i++) {
    if (!Number.isFinite(x[i])) continue;
    sx += i;
    sy += x[i];
    sxx += i * i;
    sxy += i * x[i];
    c++;
  }
  const den = c * sxx - sx * sx;
  const slope = den ? (c * sxy - sx * sy) / den : 0;
  const icpt = c ? (sy - slope * sx) / c : 0;
  for (let i = 0; i < m; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, m - 1));
    const trend = icpt + slope * i;
    re[i] = ((Number.isFinite(x[i]) ? x[i] : trend) - trend) * w;
  }
  // Bit reversal.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const half = n / 2;
  const freqs = new Float64Array(half);
  const mags = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    freqs[k] = (k * rate) / n;
    mags[k] = (2 * Math.hypot(re[k], im[k])) / Math.max(1, m);
  }
  return { freqs, mags };
}
