// Sampling helpers for native-rate channels stored on a uniform grid (t = t0 + i / rate).

import { categorize, isDiscrete } from './channelMeta';
import type { ChannelInfo, Samples } from './types';

export function makeChannelInfo(
  name: string,
  unit: string,
  rate: number,
  t0: number,
  data: Samples,
  opts: { isMath?: boolean; isDerived?: boolean; category?: string; discrete?: boolean } = {},
): ChannelInfo {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 1;
  }
  return {
    name,
    unit,
    rate,
    t0,
    data,
    min,
    max,
    n: data.length,
    discrete: opts.discrete ?? isDiscrete(name, data),
    constant: max - min === 0,
    category: opts.category ?? (opts.isMath ? 'Math' : opts.isDerived ? 'Derived' : categorize(name)),
    isMath: !!opts.isMath,
    isDerived: !!opts.isDerived,
  };
}

export const timeOf = (ch: ChannelInfo, i: number) => ch.t0 + i / ch.rate;

/** Value at time t: linear interpolation (or sample-and-hold for discrete channels). */
export function sampleAt(ch: ChannelInfo, t: number): number {
  const f = (t - ch.t0) * ch.rate;
  const n = ch.n;
  if (n === 0) return NaN;
  if (f <= 0) return ch.data[0];
  if (f >= n - 1) return ch.data[n - 1];
  const i = Math.floor(f);
  if (ch.discrete) return ch.data[i + (f - i > 0.999 ? 1 : 0)];
  const a = ch.data[i];
  const b = ch.data[i + 1];
  return a + (b - a) * (f - i);
}

/** First sample index at or after time t (clamped). */
export function indexAtOrAfter(ch: ChannelInfo, t: number): number {
  return Math.min(ch.n - 1, Math.max(0, Math.ceil((t - ch.t0) * ch.rate - 1e-6)));
}

/** Inclusive sample range covering [ta, tb], extended by one sample each side for continuity. */
export function rangeIndices(ch: ChannelInfo, ta: number, tb: number, pad = 1): [number, number] {
  const i0 = Math.max(0, Math.floor((ta - ch.t0) * ch.rate) - pad + 1);
  const i1 = Math.min(ch.n - 1, Math.ceil((tb - ch.t0) * ch.rate) + pad - 1);
  return [i0, i1];
}

/** Resample a channel onto t_k = t0 + k / rate for k in [0, n). */
export function resample(ch: ChannelInfo, rate: number, n: number, t0 = 0): Float64Array {
  const out = new Float64Array(n);
  if (ch.rate === rate && ch.t0 === t0) {
    const m = Math.min(n, ch.n);
    for (let k = 0; k < m; k++) out[k] = ch.data[k];
    for (let k = m; k < n; k++) out[k] = ch.data[ch.n - 1];
    return out;
  }
  for (let k = 0; k < n; k++) out[k] = sampleAt(ch, t0 + k / rate);
  return out;
}

/** Linear interpolation over ascending xs (plateaus allowed), extrapolating with the end segments. */
export function interp(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (n === 0) return NaN;
  if (n === 1) return ys[0];
  let lo = 0;
  let hi = n - 1;
  if (x <= xs[0]) {
    lo = 0;
    hi = 1;
  } else if (x >= xs[n - 1]) {
    lo = n - 2;
    hi = n - 1;
  } else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
  }
  const dx = xs[hi] - xs[lo];
  if (dx === 0) return ys[lo];
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / dx;
}
