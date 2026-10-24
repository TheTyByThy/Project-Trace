// X-axis mapping for laps: every chart that plots against time-in-lap or distance-in-lap goes
// through here. Results are cached per lap object, channel rate and mode.

import { interp, rangeIndices } from './channel';
import { lapDistAt, lapTimeAtDist } from './session';
import type { ChannelInfo, Lap, XMode } from './types';

export interface LapSeries {
  ch: ChannelInfo;
  i0: number;
  i1: number;
  /** x for sample i0 + k */
  xs: Float64Array;
}

const cache = new WeakMap<Lap, Map<string, { i0: number; i1: number; xs: Float64Array }>>();

export function lapSeries(lap: Lap, ch: ChannelInfo, mode: XMode): LapSeries {
  let m = cache.get(lap);
  if (!m) cache.set(lap, (m = new Map()));
  const key = `${ch.rate}|${ch.t0}|${ch.n}|${mode}`;
  let e = m.get(key);
  if (!e) {
    const [i0, i1] = lap.index === -1 ? [0, ch.n - 1] : rangeIndices(ch, lap.start, lap.end, 2);
    const xs = new Float64Array(Math.max(0, i1 - i0 + 1));
    for (let i = i0; i <= i1; i++) {
      const t = ch.t0 + i / ch.rate;
      xs[i - i0] = timeToX(lap, t, mode);
    }
    e = { i0, i1, xs };
    m.set(key, e);
  }
  return { ch, ...e };
}

export function timeToX(lap: Lap, t: number, mode: XMode): number {
  if (mode === 'time') return lap.index === -1 ? t : t - lap.start;
  return lap.index === -1 ? interp(lap.distT, lap.distD, t) : lapDistAt(lap, t);
}

export function xToTime(lap: Lap, x: number, mode: XMode): number {
  if (mode === 'time') return lap.index === -1 ? x : lap.start + x;
  return lap.index === -1 ? interp(lap.distD, lap.distT, x) : lapTimeAtDist(lap, x);
}

export function lapXRange(lap: Lap, mode: XMode): [number, number] {
  if (mode === 'time') return lap.index === -1 ? [0, lap.end] : [0, lap.time];
  const D = lap.distD;
  return [D[0] ?? 0, D[D.length - 1] ?? 0];
}

/** Time variance of `cmp` relative to `ref` (positive = cmp is slower), sampled along distance. */
export interface Variance {
  dist: Float64Array;
  /** reference-lap time at each distance (for plotting in time mode) */
  refTime: Float64Array;
  delta: Float64Array;
}

const varCache = new WeakMap<Lap, WeakMap<Lap, Variance>>();

export function computeVariance(ref: Lap, cmp: Lap, step = 2): Variance {
  let inner = varCache.get(ref);
  if (!inner) varCache.set(ref, (inner = new WeakMap()));
  const hit = inner.get(cmp);
  if (hit) return hit;
  const d0 = Math.max(ref.distD[0] ?? 0, cmp.distD[0] ?? 0);
  const d1 = Math.min(ref.distD[ref.distD.length - 1] ?? 0, cmp.distD[cmp.distD.length - 1] ?? 0);
  const n = Math.max(0, Math.floor((d1 - d0) / step) + 1);
  const dist = new Float64Array(n);
  const refTime = new Float64Array(n);
  const delta = new Float64Array(n);
  // Reference times for both laps are measured from each lap's own start.
  const refStart = ref.index === -1 ? 0 : ref.start;
  const cmpStart = cmp.index === -1 ? 0 : cmp.start;
  for (let k = 0; k < n; k++) {
    const d = d0 + k * step;
    const tr = interp(ref.distD, ref.distT, d) - refStart;
    const tc = interp(cmp.distD, cmp.distT, d) - cmpStart;
    dist[k] = d;
    refTime[k] = tr;
    delta[k] = tc - tr;
  }
  // Partial laps (e.g. out laps) don't start at the line: zero the offset at the first common point.
  if (n > 0 && (d0 > 1 || cmp.kind === 'out' || ref.kind === 'out')) {
    const off = delta[0];
    for (let k = 0; k < n; k++) delta[k] -= off;
  }
  const v = { dist, refTime, delta };
  inner.set(cmp, v);
  return v;
}

export function varianceAt(v: Variance, x: number, mode: XMode): number {
  const xs = mode === 'distance' ? v.dist : v.refTime;
  if (!xs.length || x < xs[0] || x > xs[xs.length - 1]) return NaN;
  return interp(xs, v.delta, x);
}
