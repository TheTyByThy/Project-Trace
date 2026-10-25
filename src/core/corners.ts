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
  /** Advanced mode: exact start / end of the corner (lap distance, m). Otherwise derived from neighbours. */
  start?: number;
  end?: number;
  /** Speed bucket set by hand (overrides the automatic one from the minimum speed). */
  bucket?: 'low' | 'medium' | 'high';
}

export interface CornerWindow {
  name: string;
  apex: number;
  entry: number;
  exit: number;
  /** Bucket set by hand for this corner, if any. */
  bucket?: 'low' | 'medium' | 'high';
}

/** How corner ranges are found and how corners are bucketed by speed (global, in Settings). */
export interface CornerSettings {
  /** Metres added before the point where the driver leaves full throttle (lift / brake). */
  before: number;
  /** Metres added after the point where the driver is back at full throttle. */
  after: number;
  /** Throttle (%) that counts as full throttle. */
  fullThrottle: number;
  /** Corners with a minimum speed (kph) below this are low speed. */
  lowMax: number;
  /** Corners with a minimum speed (kph) at or above this are high speed; in between is medium. */
  highMin: number;
}

export const DEFAULT_CORNER_SETTINGS: CornerSettings = { before: 20, after: 20, fullThrottle: 98, lowMax: 110, highMin: 180 };

/** The lap a corner's range is detected on (the reference lap). */
export interface CornerContext {
  session: Session;
  lap: Lap;
  settings: CornerSettings;
}

/** A channel of a lap as a function of lap distance (in %, for pedals logged 0–1). */
function pedalByDistance(s: Session, lap: Lap, name: string | undefined): ((d: number) => number) | null {
  const ch = name ? s.channels.get(name) : undefined;
  if (!ch) return null;
  const ser = lapSeries(lap, ch, 'distance');
  if (ser.xs.length < 2) return null;
  const k = ch.max <= 1.01 ? 100 : 1;
  const ys = new Float64Array(ser.xs.length);
  for (let i = 0; i < ys.length; i++) ys[i] = ch.data[ser.i0 + i] * k;
  return (d) => interp(ser.xs, ys, d);
}

/**
 * A corner's range from the driving: from where the driver last left full throttle (lifted or braked)
 * before the apex, to where they're back at full throttle after it, each padded by the settings.
 * Searches stay within [lo, hi]. Null when the lap has no throttle channel.
 */
function detectRange(ctx: CornerContext, apex: number, lo: number, hi: number): [number, number] | null {
  const thr = pedalByDistance(ctx.session, ctx.lap, ctx.session.key.throttle);
  if (!thr) return null;
  const brk = pedalByDistance(ctx.session, ctx.lap, ctx.session.key.brake);
  const full = ctx.settings.fullThrottle;
  const onStraight = (d: number) => thr(d) >= full && (!brk || brk(d) < 2);
  const step = 2;
  let entry = lo;
  for (let d = apex; d >= lo; d -= step)
    if (onStraight(d)) {
      entry = d;
      break;
    }
  let exit = hi;
  for (let d = apex; d <= hi; d += step)
    if (thr(d) >= full) {
      exit = d;
      break;
    }
  return [Math.max(lo, entry - ctx.settings.before), Math.min(hi, exit + ctx.settings.after)];
}

/**
 * Analysis window per corner:
 *  • the exact range when one is set (advanced mode);
 *  • otherwise, with a lap to look at, from the lift / braking point to full throttle again (padded by
 *    the corner settings), never past halfway to the neighbouring corners or ±400 m from the apex;
 *  • without one, halfway to the neighbouring corners, capped at ±200 m.
 */
export function cornerWindows(corners: TrackCorner[], trackLength: number, ctx?: CornerContext): CornerWindow[] {
  const sorted = corners.slice().sort((a, b) => a.dist - b.dist);
  return sorted.map((c, i) => {
    const prev = sorted[i - 1]?.dist ?? (trackLength ? sorted[sorted.length - 1].dist - trackLength : -Infinity);
    const next = sorted[i + 1]?.dist ?? (trackLength ? sorted[0].dist + trackLength : Infinity);
    const lo = Math.max(c.dist - 400, (prev + c.dist) / 2, 0);
    const hi = Math.min(c.dist + 400, (c.dist + next) / 2, trackLength || Infinity);
    const detected = ctx && ctx.lap.index !== -1 ? detectRange(ctx, c.dist, lo, hi) : null;
    const autoEntry = detected ? detected[0] : Math.max(c.dist - 200, (prev + c.dist) / 2, 0);
    const autoExit = detected ? detected[1] : Math.min(c.dist + 200, (c.dist + next) / 2, trackLength || Infinity);
    const entry = c.start != null && Number.isFinite(c.start) ? Math.max(0, c.start) : autoEntry;
    const exit = c.end != null && Number.isFinite(c.end) ? c.end : autoExit;
    return { name: c.name, apex: c.dist, entry: Math.min(entry, exit), exit: Math.max(entry, exit), bucket: c.bucket };
  });
}

export interface TrackSegment {
  kind: 'corner' | 'straight';
  name: string;
  entry: number;
  exit: number;
  /** Apex for corners; the midpoint for straights. */
  apex: number;
  /** Corners: the bucket set by hand, if any. */
  fixedBucket?: 'low' | 'medium' | 'high';
}

/**
 * The lap split into corners and the straights between them. Anything not inside a corner window is
 * a straight (named after its neighbours); the first and last straights end at the start/finish line.
 */
export function trackSegments(windows: CornerWindow[], trackLength: number): TrackSegment[] {
  const out: TrackSegment[] = [];
  const end = trackLength || (windows.length ? windows[windows.length - 1].exit : 0);
  let pos = 0;
  let prevName = 'S/F';
  const straight = (a: number, b: number, nextName: string) => {
    if (b - a >= 1) out.push({ kind: 'straight', name: `${prevName} → ${nextName}`, entry: a, exit: b, apex: (a + b) / 2 });
  };
  for (const w of windows) {
    straight(pos, w.entry, w.name);
    out.push({ kind: 'corner', name: w.name, entry: Math.max(pos, w.entry), exit: w.exit, apex: w.apex, fixedBucket: w.bucket });
    pos = Math.max(pos, w.exit);
    prevName = w.name;
  }
  straight(pos, end, 'S/F');
  return out;
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
export function cornerMetrics(s: Session, lap: Lap, w: { entry: number; exit: number }): CornerLapMetrics | null {
  if (!s.key.speed) return null;
  const ch = s.channels.get(s.key.speed)!;
  const conv = convertUnit(ch.unit || 'kph', 'kph') ?? { k: 1, b: 0 };
  // Segments touching the start/finish line run from the lap's first / to its last sample.
  const D = lap.distD;
  let ta = crossingTime(lap, w.entry);
  let tb = crossingTime(lap, w.exit);
  if (!Number.isFinite(ta) && D.length && w.entry <= D[0] + 1) ta = lap.start;
  if (!Number.isFinite(tb) && D.length && lap.complete && w.exit >= D[D.length - 1] - 1) tb = lap.end;
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

// ---------------------------------------------------------------------------------------------
// Speed buckets: the lap split into low / medium / high-speed corners and straights
// ---------------------------------------------------------------------------------------------

export type Bucket = 'low' | 'medium' | 'high' | 'straight';
export const BUCKETS: { key: Bucket; label: string; short: string }[] = [
  { key: 'low', label: 'Low-speed corners', short: 'L' },
  { key: 'medium', label: 'Medium-speed corners', short: 'M' },
  { key: 'high', label: 'High-speed corners', short: 'H' },
  { key: 'straight', label: 'Straights', short: 'S' },
];

export function speedBucket(minSpeedKph: number, s: CornerSettings): Exclude<Bucket, 'straight'> {
  if (!(minSpeedKph >= s.lowMax)) return 'low';
  return minSpeedKph >= s.highMin ? 'high' : 'medium';
}

export interface BucketedSegment extends TrackSegment {
  bucket: Bucket;
  /** The bucket from the minimum speed (what "Auto" would give), and whether it was overridden. */
  autoBucket: Bucket;
  overridden: boolean;
  /** Minimum speed (kph) on the reference lap; NaN for straights. */
  refMinSpeed: number;
}

/** Give every segment its bucket: corners by the reference lap's minimum speed, unless set by hand. */
export function bucketSegments(ctx: CornerContext, segments: TrackSegment[]): BucketedSegment[] {
  return segments.map((g) => {
    if (g.kind === 'straight') return { ...g, bucket: 'straight' as const, autoBucket: 'straight' as const, overridden: false, refMinSpeed: NaN };
    const m = cornerMetrics(ctx.session, ctx.lap, g);
    const auto = m ? speedBucket(m.minSpeed, ctx.settings) : 'medium';
    return { ...g, bucket: g.fixedBucket ?? auto, autoBucket: auto, overridden: !!g.fixedBucket, refMinSpeed: m?.minSpeed ?? NaN };
  });
}

/** Time a lap spends in each bucket (NaN where a segment couldn't be measured). */
export function bucketTimes(s: Session, lap: Lap, segs: BucketedSegment[]): Record<Bucket, number> {
  const out: Record<Bucket, number> = { low: 0, medium: 0, high: 0, straight: 0 };
  for (const g of segs) out[g.bucket] += cornerMetrics(s, lap, g)?.time ?? NaN;
  return out;
}

/** Everything the corner report and time breakdown need for one reference lap. */
export function lapBuckets(ctx: CornerContext, corners: TrackCorner[]): BucketedSegment[] {
  const windows = cornerWindows(corners, ctx.session.trackLength, ctx);
  return bucketSegments(ctx, trackSegments(windows, ctx.session.trackLength));
}
