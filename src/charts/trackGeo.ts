// Geometry shared by the Track Map and GPS Track: per-lap position paths and the screen projection.

import { lapSeries } from '../core/axis';
import { interp, sampleAt } from '../core/channel';
import type { Lap, Session } from '../core/types';

export interface LapPath {
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
}

const pathCache = new WeakMap<Lap, LapPath | null>();

/** Car positions (metres) for one lap, from Car Coord X/Y or projected GPS. */
export function lapPath(s: Session, lap: Lap): LapPath | null {
  if (pathCache.has(lap)) return pathCache.get(lap)!;
  const kx = s.key.posX ? s.channels.get(s.key.posX) : undefined;
  const ky = s.key.posY ? s.channels.get(s.key.posY) : undefined;
  let out: LapPath | null = null;
  if (kx && ky) {
    const ser = lapSeries(lap, kx, 'time');
    const n = ser.i1 - ser.i0 + 1;
    const t = new Float64Array(n);
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const sameGrid = kx.rate === ky.rate && kx.t0 === ky.t0;
    for (let i = 0; i < n; i++) {
      const idx = ser.i0 + i;
      const tt = kx.t0 + idx / kx.rate;
      t[i] = tt;
      x[i] = kx.data[idx];
      y[i] = sameGrid ? ky.data[idx] : sampleAt(ky, tt);
    }
    out = { t, x, y };
  }
  pathCache.set(lap, out);
  return out;
}

export function positionAt(p: LapPath, t: number): [number, number] {
  return [interp(p.t, p.x, t), interp(p.t, p.y, t)];
}

/**
 * World (x east, y north) → screen-oriented coordinates (y down), rotated clockwise by
 * `rotationDeg` (like a compass bearing) and optionally mirrored.
 */
export function makeProjector(rotationDeg: number, mirror: boolean): (x: number, y: number) => [number, number] {
  const r = (-rotationDeg * Math.PI) / 180;
  const cs = Math.cos(r),
    sn = Math.sin(r);
  const mir = mirror ? -1 : 1;
  return (x, y) => {
    const X = x * mir;
    return [X * cs - y * sn, -(X * sn + y * cs)];
  };
}

/** A "nice" length for a scale bar that is roughly `target` metres. */
export function niceLength(target: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(target, 0.01))));
  const n = target / p;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p;
}
