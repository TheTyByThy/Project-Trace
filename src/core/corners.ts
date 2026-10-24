// Corners are defined by the user (name + lap distance of the apex) and saved per track.
// `suggestCorners` can propose apexes from speed minima, but only when the user asks for it.

import { lapSeries } from './axis';
import { interp } from './channel';
import { crossingTime, lapDistAt } from './session';
import type { Lap, Session } from './types';
import { convertUnit } from './units';

/** A corner as stored in the track profile. */
export interface TrackCorner {
  name: string;
  dist: number; // lap distance of the apex (m)
}

export interface CornerWindow {
  name: string;
  apex: number;
  entry: number;
  exit: number;
}

/** Analysis window per corner: halfway to the neighbouring corners, capped at ±200 m. */
export function cornerWindows(corners: TrackCorner[], trackLength: number): CornerWindow[] {
  const sorted = corners.slice().sort((a, b) => a.dist - b.dist);
  return sorted.map((c, i) => {
    const prev = sorted[i - 1]?.dist ?? (trackLength ? sorted[sorted.length - 1].dist - trackLength : -Infinity);
    const next = sorted[i + 1]?.dist ?? (trackLength ? sorted[0].dist + trackLength : Infinity);
    return {
      name: c.name,
      apex: c.dist,
      entry: Math.max(c.dist - 200, (prev + c.dist) / 2, 0),
      exit: Math.min(c.dist + 200, (c.dist + next) / 2, trackLength || Infinity),
    };
  });
}

/** Propose corner apexes as significant local minima of speed vs distance (opt-in helper). */
export function suggestCorners(s: Session, lap: Lap): TrackCorner[] {
  const out: TrackCorner[] = [];
  if (!s.key.speed || lap.index === -1) return out;
  const ch = s.channels.get(s.key.speed)!;
  const conv = convertUnit(ch.unit || 'kph', 'kph') ?? { k: 1, b: 0 };
  const ser = lapSeries(lap, ch, 'distance');
  const d0 = lap.distD[0];
  const d1 = lap.distD[lap.distD.length - 1];
  const step = 5;
  const n = Math.floor((d1 - d0) / step);
  if (n < 20) return out;
  const vs = new Float64Array(ser.i1 - ser.i0 + 1);
  for (let i = 0; i < vs.length; i++) vs[i] = ch.data[ser.i0 + i] * conv.k + conv.b;
  const grid = new Float64Array(n);
  for (let k = 0; k < n; k++) grid[k] = interp(ser.xs, vs, d0 + k * step);
  const sm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let acc = 0,
      c = 0;
    for (let j = Math.max(0, k - 3); j <= Math.min(n - 1, k + 3); j++) {
      acc += grid[j];
      c++;
    }
    sm[k] = acc / c;
  }
  const minima: { k: number; v: number }[] = [];
  for (let k = 1; k < n - 1; k++) {
    if (!(sm[k] <= sm[k - 1] && sm[k] < sm[k + 1])) continue;
    let peakA = sm[k];
    for (let a = k; a > 0 && sm[a - 1] >= sm[k] - 0.01; a--) peakA = Math.max(peakA, sm[a - 1]);
    let peakB = sm[k];
    for (let b = k; b < n - 1 && sm[b + 1] >= sm[k] - 0.01; b++) peakB = Math.max(peakB, sm[b + 1]);
    const p = Math.max(8, sm[k] * 0.06);
    if (peakA - sm[k] >= p && peakB - sm[k] >= p * 0.5) minima.push({ k, v: sm[k] });
  }
  const merged: typeof minima = [];
  for (const m of minima) {
    const last = merged[merged.length - 1];
    if (last && (m.k - last.k) * step < 60) {
      if (m.v < last.v) merged[merged.length - 1] = m;
    } else merged.push(m);
  }
  merged.forEach((m, i) => out.push({ name: `T${i + 1}`, dist: Math.round(d0 + m.k * step) }));
  return out;
}

export interface CornerLapMetrics {
  minSpeed: number;
  apexDist: number;
  entrySpeed: number;
  exitSpeed: number;
  time: number;
}

/** Speeds (kph) and time through one corner window for a lap. */
export function cornerMetrics(s: Session, lap: Lap, w: CornerWindow): CornerLapMetrics | null {
  if (!s.key.speed) return null;
  const ch = s.channels.get(s.key.speed)!;
  const conv = convertUnit(ch.unit || 'kph', 'kph') ?? { k: 1, b: 0 };
  const ta = crossingTime(lap, w.entry);
  const tb = crossingTime(lap, w.exit);
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || tb <= ta) return null;
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
