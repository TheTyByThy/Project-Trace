// Automatic corner detection from the reference lap's speed trace, plus per-lap corner metrics.

import { lapSeries } from './axis';
import { interp } from './channel';
import { crossingTime, lapDistAt } from './session';
import type { Lap, Session } from './types';
import { convertUnit } from './units';

export interface Corner {
  index: number;
  name: string;
  apex: number; // lap distance of minimum speed (m)
  entry: number; // distance of the preceding speed peak (braking point region)
  exit: number; // distance of the following speed peak
  minSpeed: number; // kph on the lap it was detected on
}

const cornerCache = new WeakMap<Lap, Corner[]>();

/** Detect corners as significant local minima in speed vs. distance. */
export function detectCorners(s: Session, lap: Lap): Corner[] {
  const hit = cornerCache.get(lap);
  if (hit) return hit;
  const out: Corner[] = [];
  if (!s.key.speed || lap.index === -1) return out;
  const ch = s.channels.get(s.key.speed)!;
  const conv = convertUnit(ch.unit || 'kph', 'kph') ?? { k: 1, b: 0 };
  const ser = lapSeries(lap, ch, 'distance');
  // Resample speed on a 5 m grid and smooth lightly.
  const d0 = lap.distD[0];
  const d1 = lap.distD[lap.distD.length - 1];
  const step = 5;
  const n = Math.floor((d1 - d0) / step);
  if (n < 20) return out;
  const xs = ser.xs;
  const vs = new Float64Array(ser.i1 - ser.i0 + 1);
  for (let i = 0; i < vs.length; i++) vs[i] = ch.data[ser.i0 + i] * conv.k + conv.b;
  const grid = new Float64Array(n);
  for (let k = 0; k < n; k++) grid[k] = interp(xs, vs, d0 + k * step);
  const sm = new Float64Array(n);
  const w = 3;
  for (let k = 0; k < n; k++) {
    let acc = 0,
      c = 0;
    for (let j = Math.max(0, k - w); j <= Math.min(n - 1, k + w); j++) {
      acc += grid[j];
      c++;
    }
    sm[k] = acc / c;
  }
  // Find minima with prominence on both sides.
  const prominence = (v: number) => Math.max(8, v * 0.06);
  let k = 1;
  const candidates: { k: number; v: number; entryK: number; exitK: number }[] = [];
  while (k < n - 1) {
    if (sm[k] <= sm[k - 1] && sm[k] < sm[k + 1]) {
      // Walk back to previous max and forward to next max.
      let a = k;
      let peakA = sm[k];
      let ka = k;
      while (a > 0) {
        a--;
        if (sm[a] > peakA) {
          peakA = sm[a];
          ka = a;
        }
        if (sm[a] < sm[k] - 0.01) break;
      }
      let b = k;
      let peakB = sm[k];
      let kb = k;
      while (b < n - 1) {
        b++;
        if (sm[b] > peakB) {
          peakB = sm[b];
          kb = b;
        }
        if (sm[b] < sm[k] - 0.01) break;
      }
      const p = prominence(sm[k]);
      if (peakA - sm[k] >= p && peakB - sm[k] >= p * 0.5) candidates.push({ k, v: sm[k], entryK: ka, exitK: kb });
    }
    k++;
  }
  // Merge minima closer than 60 m (keep the lower).
  const merged: typeof candidates = [];
  for (const c of candidates) {
    const last = merged[merged.length - 1];
    if (last && (c.k - last.k) * step < 60) {
      if (c.v < last.v) merged[merged.length - 1] = { ...c, entryK: last.entryK };
    } else merged.push(c);
  }
  merged.forEach((c, i) =>
    out.push({
      index: i,
      name: `T${i + 1}`,
      apex: d0 + c.k * step,
      entry: d0 + c.entryK * step,
      exit: d0 + c.exitK * step,
      minSpeed: c.v,
    }),
  );
  cornerCache.set(lap, out);
  return out;
}

export interface CornerLapMetrics {
  minSpeed: number;
  apexDist: number;
  entrySpeed: number;
  exitSpeed: number;
  time: number; // time from entry to exit
}

export function cornerMetrics(s: Session, lap: Lap, c: Corner): CornerLapMetrics | null {
  if (!s.key.speed) return null;
  const ch = s.channels.get(s.key.speed)!;
  const conv = convertUnit(ch.unit || 'kph', 'kph') ?? { k: 1, b: 0 };
  const ta = crossingTime(lap, c.entry);
  const tb = crossingTime(lap, c.exit);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  const i0 = Math.max(0, Math.floor((ta - ch.t0) * ch.rate));
  const i1 = Math.min(ch.n - 1, Math.ceil((tb - ch.t0) * ch.rate));
  let min = Infinity;
  let at = i0;
  for (let i = i0; i <= i1; i++) {
    if (ch.data[i] < min) {
      min = ch.data[i];
      at = i;
    }
  }
  return {
    minSpeed: min * conv.k + conv.b,
    apexDist: lapDistAt(lap, ch.t0 + at / ch.rate),
    entrySpeed: ch.data[i0] * conv.k + conv.b,
    exitSpeed: ch.data[i1] * conv.k + conv.b,
    time: tb - ta,
  };
}
