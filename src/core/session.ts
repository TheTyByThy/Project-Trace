// Turns a ParsedFile into an analysable Session: channels, laps, sectors, distance mapping.

import { detectKeyChannels } from './channelMeta';
import { indexAtOrAfter, interp, makeChannelInfo, sampleAt } from './channel';
import type { ChannelInfo, Lap, LapKind, ParsedFile, Session } from './types';
import { convertUnit } from './units';

let sessionCounter = 0;

export interface SourceInfo {
  path: string;
  fileName: string;
  size: number;
  mtime: number;
}

export function buildSession(parsed: ParsedFile, src: SourceInfo): Session {
  const channels = new Map<string, ChannelInfo>();
  const order: string[] = [];
  for (const c of parsed.channels) {
    if (channels.has(c.name)) continue;
    channels.set(c.name, makeChannelInfo(c.name, c.unit, c.rate, c.t0, c.data));
    order.push(c.name);
  }
  const key = detectKeyChannels(order);
  const warnings = [...parsed.warnings];
  const duration = parsed.duration;

  const addDerived = (ch: ChannelInfo) => {
    channels.set(ch.name, ch);
    order.push(ch.name);
  };

  // GPS lat/long → local metres (equirectangular around the mean position) for the track map.
  if ((!key.posX || !key.posY) && key.lat && key.lon) {
    const lat = channels.get(key.lat)!;
    const lon = channels.get(key.lon)!;
    const n = Math.min(lat.n, lon.n);
    let sLat = 0,
      sLon = 0,
      cnt = 0;
    for (let i = 0; i < n; i++) {
      if (lat.data[i] !== 0 && lon.data[i] !== 0) {
        sLat += lat.data[i];
        sLon += lon.data[i];
        cnt++;
      }
    }
    if (cnt > 0) {
      const lat0 = sLat / cnt;
      const lon0 = sLon / cnt;
      const R = 6371000;
      const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
      const ky = (Math.PI / 180) * R;
      const x = new Float32Array(n);
      const y = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        x[i] = (lon.data[i] - lon0) * kx;
        y[i] = (lat.data[i] - lat0) * ky;
      }
      addDerived(makeChannelInfo('GPS X', 'm', lat.rate, lat.t0, x, { isDerived: true }));
      addDerived(makeChannelInfo('GPS Y', 'm', lat.rate, lat.t0, y, { isDerived: true }));
      key.posX = 'GPS X';
      key.posY = 'GPS Y';
    }
  }

  // Session distance by integrating speed (MoTeC's "Distance" channel).
  if (key.speed) {
    const sp = channels.get(key.speed)!;
    const conv = convertUnit(sp.unit || 'kph', 'm/s') ?? { k: 1 / 3.6, b: 0 };
    const d = new Float32Array(sp.n);
    let acc = 0;
    for (let i = 1; i < sp.n; i++) {
      const v0 = Math.max(0, sp.data[i - 1] * conv.k + conv.b);
      const v1 = Math.max(0, sp.data[i] * conv.k + conv.b);
      acc += ((v0 + v1) / 2) / sp.rate;
      d[i] = acc;
    }
    if (!channels.has('Distance')) addDerived(makeChannelInfo('Distance', 'm', sp.rate, sp.t0, d, { isDerived: true }));
  }

  const session: Session = {
    id: `s${++sessionCounter}`,
    path: src.path,
    fileName: src.fileName,
    meta: parsed.meta,
    channels,
    channelOrder: order,
    duration,
    baseRate: parsed.baseRate,
    laps: [],
    sessionLap: null as unknown as Lap,
    trackLength: 0,
    sectorSplits: [],
    key,
    warnings,
    loadedAt: Date.now(),
    fileSize: src.size,
    fileMtime: src.mtime,
  };

  buildLaps(session);
  return session;
}

// ---------------------------------------------------------------------------------------------
// Laps
// ---------------------------------------------------------------------------------------------

function detectBoundaries(s: Session): number[] {
  const dur = s.duration;
  const beacons = s.meta.beacons.filter((b) => b > 0.5 && b < dur - 0.05);
  const fromLapNum: number[] = [];
  const ln = s.key.lapNumber ? s.channels.get(s.key.lapNumber) : undefined;
  const lt = s.key.lapTime ? s.channels.get(s.key.lapTime) : undefined;
  if (ln) {
    for (let i = 1; i < ln.n; i++) {
      const a = ln.data[i - 1];
      const b = ln.data[i];
      if (a !== b && Number.isFinite(a) && Number.isFinite(b) && b > a) {
        let t = ln.t0 + i / ln.rate;
        // Refine with the lap timer: at the first sample of a new lap it reads time-since-crossing.
        if (lt) {
          const v = lt.data[indexAtOrAfter(lt, t)];
          if (v >= 0 && v < 1.5) t -= v;
        }
        fromLapNum.push(t);
      }
    }
  }
  const consistent = (a: number[], b: number[]) =>
    Math.abs(a.length - b.length) <= 1 && b.every((t) => a.some((x) => Math.abs(x - t) < 1.0));
  if (beacons.length && (!fromLapNum.length || consistent(beacons, fromLapNum))) return beacons;
  if (fromLapNum.length) return fromLapNum;

  const ld = s.key.lapDistance ? s.channels.get(s.key.lapDistance) : undefined;
  if (ld && ld.max > 100) {
    const out: number[] = [];
    for (let i = 1; i < ld.n; i++) {
      if (ld.data[i - 1] - ld.data[i] > ld.max * 0.5) out.push(ld.t0 + i / ld.rate);
    }
    return out;
  }
  return [];
}

function speedMs(s: Session): ChannelInfo | null {
  if (!s.key.speed) return null;
  return s.channels.get(s.key.speed) ?? null;
}

function buildLaps(s: Session) {
  const dur = s.duration;
  const boundaries = detectBoundaries(s);
  const edges = [0, ...boundaries, dur];
  const ld = s.key.lapDistance ? s.channels.get(s.key.lapDistance) : undefined;
  const lt = s.key.lapTime ? s.channels.get(s.key.lapTime) : undefined;
  const sp = speedMs(s);
  const spConv = sp ? convertUnit(sp.unit || 'kph', 'kph') ?? { k: 1, b: 0 } : null;

  const raw: { a: number; b: number; kind: LapKind; complete: boolean }[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i];
    const b = edges[i + 1];
    if (b - a < 1.0) continue;
    const isFirst = i === 0;
    const isLast = i === edges.length - 2;
    let kind: LapKind = 'flying';
    let complete = true;
    if (boundaries.length === 0) {
      kind = 'session';
      complete = false;
    } else if (isFirst) {
      const startsOnLine =
        (lt ? sampleAt(lt, 0) < 1.5 : false) && (ld ? ld.data[0] < 60 || ld.data[0] > ld.max - 5 : true);
      kind = startsOnLine ? 'flying' : 'out';
      complete = startsOnLine;
    } else if (isLast) {
      complete = false;
      const vEnd = sp && spConv ? sp.data[sp.n - 1] * spConv.k + spConv.b : 100;
      kind = vEnd < 5 ? 'in' : 'partial';
    }
    raw.push({ a, b, kind, complete });
  }

  // Track length: median of the maximum lap distance over complete laps.
  let L = 0;
  if (ld) {
    const maxima: number[] = [];
    for (const r of raw) {
      if (!r.complete) continue;
      let m = 0;
      const i0 = indexAtOrAfter(ld, r.a + (r.b - r.a) * 0.5);
      const i1 = indexAtOrAfter(ld, r.b);
      for (let i = i0; i <= i1; i++) if (ld.data[i] > m) m = ld.data[i];
      maxima.push(m);
    }
    maxima.sort((x, y) => x - y);
    L = maxima.length ? maxima[Math.floor(maxima.length / 2)] : ld.max;
  }
  const venueLen = Number(s.meta.details['Venue Length']?.value);
  if (!L && Number.isFinite(venueLen) && venueLen > 0) L = venueLen;

  const laps: Lap[] = raw.map((r, idx) => {
    const { T, D } = lapDistanceArrays(s, r.a, r.b, r.complete, r.kind === 'out' || r.kind === 'session' ? false : true, L);
    return {
      index: idx,
      number: idx + 1,
      start: r.a,
      end: r.b,
      time: r.b - r.a,
      complete: r.complete,
      kind: r.kind,
      invalid: false,
      sectors: [],
      length: D.length ? D[D.length - 1] - D[0] : 0,
      distT: T,
      distD: D,
    };
  });

  if (!L) {
    const lens = laps.filter((l) => l.complete).map((l) => l.length).sort((x, y) => x - y);
    L = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  }
  s.trackLength = L;
  s.laps = laps;

  // Validity (AC sets "Lap Invalidated" while the current lap is invalid; it's sampled at 1 Hz).
  if (s.key.lapInvalid) {
    const inv = s.channels.get(s.key.lapInvalid)!;
    for (const lap of laps) {
      const i0 = indexAtOrAfter(inv, lap.start + 1.0);
      const i1 = Math.min(inv.n - 1, Math.floor((lap.end + 0.99 - inv.t0) * inv.rate));
      for (let i = i0; i <= i1; i++) {
        if (inv.data[i] > 0.5) {
          lap.invalid = true;
          break;
        }
      }
    }
  }

  computeSectors(s);

  // Whole-outing pseudo lap.
  const dist = s.channels.get('Distance');
  let T: Float64Array;
  let D: Float64Array;
  if (dist) {
    T = new Float64Array(dist.n);
    D = new Float64Array(dist.n);
    for (let i = 0; i < dist.n; i++) {
      T[i] = dist.t0 + i / dist.rate;
      D[i] = dist.data[i];
    }
  } else {
    T = new Float64Array([0, dur]);
    D = new Float64Array([0, dur]);
  }
  s.sessionLap = {
    index: -1,
    number: 0,
    start: 0,
    end: dur,
    time: dur,
    complete: false,
    kind: 'session',
    invalid: false,
    sectors: [],
    length: D[D.length - 1] - D[0],
    distT: T,
    distD: D,
  };
}

/** Monotonic (time, lap distance) arrays for one lap. */
function lapDistanceArrays(s: Session, a: number, b: number, complete: boolean, startsOnLine: boolean, L: number) {
  const ld = s.key.lapDistance ? s.channels.get(s.key.lapDistance) : undefined;
  const T: number[] = [];
  const D: number[] = [];
  const lapTime = b - a;
  if (ld && ld.max > 50) {
    const Lr = L || ld.max;
    if (startsOnLine) {
      T.push(a);
      D.push(0);
    }
    const i0 = indexAtOrAfter(ld, a);
    for (let i = i0; i < ld.n; i++) {
      const t = ld.t0 + i / ld.rate;
      if (t > b) break;
      if (t <= a && startsOnLine) continue;
      let d = ld.data[i];
      // Unwrap samples that straddle the line (beacon vs. channel timing differ by a few ms).
      if (startsOnLine && t - a < Math.min(10, lapTime * 0.1) && d > Lr * 0.5) d -= Lr;
      if (complete && b - t < Math.min(10, lapTime * 0.1) && d < Lr * 0.5) d += Lr;
      T.push(t);
      D.push(d);
    }
    if (complete) {
      T.push(b);
      D.push(Math.max(Lr, D.length ? D[D.length - 1] : Lr));
    }
  } else {
    const sp = speedMs(s);
    if (sp) {
      const conv = convertUnit(sp.unit || 'kph', 'm/s') ?? { k: 1 / 3.6, b: 0 };
      let acc = 0;
      T.push(a);
      D.push(0);
      let prevT = a;
      let prevV = Math.max(0, sampleAt(sp, a) * conv.k + conv.b);
      const i0 = indexAtOrAfter(sp, a);
      for (let i = i0; i < sp.n; i++) {
        const t = sp.t0 + i / sp.rate;
        if (t > b) break;
        if (t <= a) continue;
        const v = Math.max(0, sp.data[i] * conv.k + conv.b);
        acc += ((v + prevV) / 2) * (t - prevT);
        T.push(t);
        D.push(acc);
        prevT = t;
        prevV = v;
      }
    } else {
      T.push(a, b);
      D.push(0, b - a);
    }
  }
  // Enforce monotonic distance so it can be inverted (spins/reversing are flattened).
  for (let i = 1; i < D.length; i++) if (D[i] < D[i - 1]) D[i] = D[i - 1];
  return { T: Float64Array.from(T), D: Float64Array.from(D) };
}

export const lapDistAt = (lap: Lap, t: number) => interp(lap.distT, lap.distD, t);
export const lapTimeAtDist = (lap: Lap, d: number) => interp(lap.distD, lap.distT, d);

/** Session time at which a lap crosses lap-distance d, or NaN if the lap doesn't cover it. */
export function crossingTime(lap: Lap, d: number): number {
  const D = lap.distD;
  if (!D.length || d < D[0] || d > D[D.length - 1]) return NaN;
  return lapTimeAtDist(lap, d);
}

/** Split times for arbitrary lap-distance split points. Returns one duration per segment. */
export function segmentTimes(s: Session, lap: Lap, splits: number[]): number[] {
  const startsAtLine = lap.kind === 'flying' || (lap.index > 0 && lap.kind !== 'session');
  const endsAtLine = lap.complete || (lap.kind !== 'session' && lap.index >= 0 && lap.index < s.laps.length - 1);
  const bounds = [0, ...splits, Infinity];
  const out: number[] = [];
  for (let j = 0; j < bounds.length - 1; j++) {
    const ta = j === 0 ? (startsAtLine ? lap.start : NaN) : crossingTime(lap, bounds[j]);
    const tb = j === bounds.length - 2 ? (endsAtLine ? lap.end : NaN) : crossingTime(lap, bounds[j + 1]);
    out.push(tb - ta);
  }
  return out;
}

function computeSectors(s: Session) {
  const laps = s.laps;
  const ls = s.key.lastSector ? s.channels.get(s.key.lastSector) : undefined;
  if (!ls) return;
  // Change events of the "Last Sector Time" channel.
  const events: { t: number; v: number }[] = [];
  for (let i = 1; i < ls.n; i++) {
    const v = ls.data[i];
    if (v > 0 && v !== ls.data[i - 1]) events.push({ t: ls.t0 + i / ls.rate, v });
  }
  type Match = { lap: Lap; secs: number[] };
  const matches: Match[] = [];
  for (const lap of laps) {
    if (!lap.complete) continue;
    const win = events.filter((e) => e.t > lap.start + 0.3 && e.t <= lap.end + 3.5);
    let found: number[] | null = null;
    for (let k = 2; k <= 6 && !found; k++) {
      for (let j = 0; j + k <= win.length; j++) {
        const run = win.slice(j, j + k);
        const sum = run.reduce((acc, e) => acc + e.v, 0);
        if (Math.abs(sum - lap.time) > 0.03) continue;
        // Each sector must be posted after it was completed.
        let acc = lap.start;
        let ok = true;
        for (const e of run) {
          acc += e.v;
          if (e.t < acc - 0.1) ok = false;
        }
        if (ok) {
          // The game reports milliseconds; undo Float32 storage noise.
          found = run.map((e) => Math.round(e.v * 1000) / 1000);
          break;
        }
      }
    }
    if (found) matches.push({ lap, secs: found });
  }
  if (!matches.length) return;
  const counts = new Map<number, number>();
  for (const m of matches) counts.set(m.secs.length, (counts.get(m.secs.length) ?? 0) + 1);
  const k = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const good = matches.filter((m) => m.secs.length === k);
  const splits: number[] = [];
  for (let m = 1; m < k; m++) {
    const ds = good
      .map((g) => lapDistAt(g.lap, g.lap.start + g.secs.slice(0, m).reduce((x, y) => x + y, 0)))
      .sort((x, y) => x - y);
    splits.push(ds[Math.floor(ds.length / 2)]);
  }
  s.sectorSplits = splits;
  for (const lap of laps) {
    const g = good.find((x) => x.lap === lap);
    lap.sectors = g ? g.secs : segmentTimes(s, lap, splits);
  }
}

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

export function getLap(s: Session, index: number): Lap | undefined {
  return index === -1 ? s.sessionLap : s.laps[index];
}

export function fastestLap(s: Session, validOnly = true): Lap | undefined {
  let best: Lap | undefined;
  for (const l of s.laps) {
    if (!l.complete || (validOnly && l.invalid)) continue;
    if (!best || l.time < best.time) best = l;
  }
  if (!best && validOnly) return fastestLap(s, false);
  return best;
}

export function lapAtTime(s: Session, t: number): Lap | undefined {
  return s.laps.find((l) => t >= l.start && t < l.end) ?? s.laps[s.laps.length - 1];
}

export function lapLabel(lap: Lap): string {
  if (lap.index === -1) return 'Full session';
  const tag = lap.kind === 'out' ? ' (out)' : lap.kind === 'in' ? ' (in)' : lap.kind === 'partial' ? ' (partial)' : '';
  return `Lap ${lap.number}${tag}`;
}

/** Ideal lap: sum of best sector times across complete laps. */
export function theoreticalBest(s: Session): { time: number; sectors: number[] } | null {
  const k = s.sectorSplits.length + 1;
  if (k < 2) return null;
  const best = new Array(k).fill(Infinity);
  for (const l of s.laps) {
    if (l.invalid) continue;
    l.sectors.forEach((v, i) => {
      if (Number.isFinite(v) && v > 0 && v < best[i]) best[i] = v;
    });
  }
  if (best.some((b) => !Number.isFinite(b))) return null;
  return { time: best.reduce((a, b) => a + b, 0), sectors: best };
}
