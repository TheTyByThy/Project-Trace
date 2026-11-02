// Optimum corners: across a set of eligible laps, the best time through each of the track's corners —
// real laps, corner by corner, never stitched into a lap — against the fastest eligible lap (the reference).
// The corners are the track profile's, with their ranges detected on the reference lap (as in the Corner
// Report); straights are left out. Adding up what the reference loses to the best in every corner gives
// the time there is to find.

import { bucketSegments, cornerMetrics, cornerWindows, trackSegments, type BucketedSegment, type CornerLapMetrics, type CornerSettings, type TrackCorner } from './corners';
import type { Lap, Session } from './types';

export interface EligibleLap {
  key: string;
  session: Session;
  lap: Lap;
}

export interface OptimumCorner {
  seg: BucketedSegment;
  /** The reference lap through this corner (null when it couldn't be measured). */
  ref: CornerLapMetrics | null;
  /** The eligible lap with the shortest time through the corner (the reference itself when nothing beats it). */
  best: EligibleLap | null;
  bestM: CornerLapMetrics | null;
  /** Seconds the reference loses here to the best: ref time − best time (0 when the reference is best; NaN unmeasured). */
  gain: number;
  /** Every eligible lap through the corner, in the order of `laps`. */
  all: (CornerLapMetrics | null)[];
}

export interface Optimum {
  ref: EligibleLap;
  laps: EligibleLap[];
  corners: OptimumCorner[];
  /** Sum of the gains: what driving every corner like its best would find. */
  total: number;
}

/** The fastest of the laps (complete ones only), or null. */
export function fastestOf(laps: EligibleLap[]): EligibleLap | null {
  let best: EligibleLap | null = null;
  for (const l of laps) if (l.lap.complete && l.lap.index !== -1 && (!best || l.lap.time < best.lap.time)) best = l;
  return best;
}

export function optimumCorners(laps: EligibleLap[], corners: TrackCorner[], settings: CornerSettings): Optimum | null {
  const ok = laps.filter((l) => l.lap.complete && l.lap.index !== -1);
  const ref = fastestOf(ok);
  if (!ref || !corners.length) return null;
  const ctx = { session: ref.session, lap: ref.lap, settings };
  const L = ref.session.trackLength;
  const segs = bucketSegments(ctx, trackSegments(cornerWindows(corners, L, ctx), L)).filter((g) => g.kind === 'corner');
  const refI = ok.indexOf(ref);
  const out = segs.map((seg): OptimumCorner => {
    const all = ok.map((l) => cornerMetrics(l.session, l.lap, seg));
    let bi = -1;
    all.forEach((m, i) => {
      if (m && (bi < 0 || m.time < all[bi]!.time)) bi = i;
    });
    // A tie goes to the reference: nothing to find there.
    if (bi >= 0 && all[refI] && all[refI]!.time <= all[bi]!.time + 1e-6) bi = refI;
    const refM = all[refI];
    const bestM = bi >= 0 ? all[bi] : null;
    return { seg, ref: refM, best: bi >= 0 ? ok[bi] : null, bestM, gain: refM && bestM ? Math.max(0, refM.time - bestM.time) : NaN, all };
  });
  const total = out.reduce((a, c) => a + (Number.isFinite(c.gain) ? c.gain : 0), 0);
  return { ref, laps: ok, corners: out, total };
}
