// Tyre wear model: how much rubber each tyre is losing, and why. Fitted against Assetto Corsa's own
// `Tire Rubber Grip` channel over every logged stint (see docs/14-tyre-wear.md for the derivation).
//
//   wear rate  =  speed [m/s] × ndSlip × max(load, 0) / 5000 N        (metres of "full sliding" per second)
//
// ndSlip is the game's normalised slip (1 ≈ at the peak of the tyre's grip curve; it is the combined slip
// vector divided by ~0.111), so the product is the load-weighted sliding distance — Archard-style wear,
// which is what AC's "virtual km" tyre wear accumulates. Grip lost is proportional to it (the wear curve is
// linear over normal stint lengths); the constant depends only on the compound and the wear-rate setting,
// so the metres compare fairly between drivers and stints even when those settings differ.
//
// Each sample's wear is split by the direction of the slip: longitudinal share = sr² / (sr² + α²)
// (slip ratio and slip angle in radians — the game normalises both by about the same peak, 0.111),
// negative slip ratio = lock-up (braking), positive = wheelspin (traction), the rest = sliding (cornering).

import { sampleAt } from './channel';
import { lapDistAt } from './session';
import type { ChannelInfo, Lap, Session } from './types';
import { convertUnit } from './units';

export const TYRES = ['FL', 'FR', 'RL', 'RR'] as const;
export type Tyre = (typeof TYRES)[number];

/** Load the wear rate is normalised to (N). */
export const WEAR_REF_LOAD = 5000;
/**
 * Wear rate (m/s) that reads 100 on the 0–100 wear-rate scale, e.g. peak slip at 240 km/h with 7.5 kN on the
 * tyre. Over the fitted data only lock-ups and spins pass it (0.4 % of the time); normal running reads ~10.
 */
export const WEAR_RATE_FULL = 100;

export interface WearSplit {
  /** Load-weighted sliding distance, m. */
  total: number;
  lock: number;
  spin: number;
  slide: number;
}

export const emptySplit = (): WearSplit => ({ total: 0, lock: 0, spin: 0, slide: 0 });

export const WEAR_CAUSES: { key: Exclude<keyof WearSplit, 'total'>; label: string; hint: string }[] = [
  { key: 'lock', label: 'Lock-up', hint: 'braking: the tyre turning slower than the road (negative slip ratio)' },
  { key: 'spin', label: 'Wheelspin', hint: 'traction: the tyre turning faster than the road (positive slip ratio)' },
  { key: 'slide', label: 'Cornering slide', hint: 'lateral sliding (slip angle)' },
];

export interface LapWear {
  total: WearSplit;
  /** Wear per lap-distance segment (only when segment edges are given). */
  segments: WearSplit[];
  /** Grip the game says the tyre lost over the lap (Tire Rubber Grip, % points); NaN without the channel. */
  gameGripLoss: number;
}

interface WearChannels {
  nd: ChannelInfo;
  load: ChannelInfo;
  speed: ChannelInfo;
  speedK: number;
  sr?: ChannelInfo;
  srK: number;
  sa?: ChannelInfo;
  saK: number;
  grip?: ChannelInfo;
}

function wearChannels(s: Session, tyre: Tyre): WearChannels | null {
  const nd = s.channels.get(`ndSlip ${tyre}`);
  const load = s.channels.get(`Tire Load ${tyre}`);
  const speed = s.key.speed ? s.channels.get(s.key.speed) : undefined;
  if (!nd || !load || !speed) return null;
  const sr = s.channels.get(`Tire Slip Ratio ${tyre}`);
  const sa = s.channels.get(`Tire Slip Angle ${tyre}`);
  return {
    nd,
    load,
    speed,
    speedK: convertUnit(speed.unit || 'kph', 'm/s')?.k ?? 1 / 3.6,
    sr,
    srK: sr && sr.unit.trim() === '%' ? 0.01 : 1,
    sa,
    saK: sa && /rad/i.test(sa.unit) ? 1 : Math.PI / 180,
    grip: s.channels.get(`Tire Rubber Grip ${tyre}`),
  };
}

/** True when the session logs what the wear model needs for this tyre (ndSlip, load and speed). */
export const hasWearChannels = (s: Session, tyre: Tyre = 'FL') => !!wearChannels(s, tyre);

/** Wear rate on the 0–100 scale for one sample (the same formula as the "Tyre Wear Rate" math channels). */
export const wearRate100 = (speedMs: number, ndSlip: number, loadN: number) =>
  Math.max(0, Math.min(100, (100 * speedMs * ndSlip * Math.max(loadN, 0)) / WEAR_REF_LOAD / WEAR_RATE_FULL));

/**
 * One tyre's wear over a lap, optionally split into lap-distance segments: `edges` are ascending segment
 * boundaries (n + 1 edges → n segments); samples outside them are left out of the segments but not the total.
 */
export function lapWear(s: Session, lap: Lap, tyre: Tyre, edges?: number[]): LapWear | null {
  const c = wearChannels(s, tyre);
  if (!c) return null;
  const total = emptySplit();
  const segments = edges ? Array.from({ length: Math.max(0, edges.length - 1) }, emptySplit) : [];
  const { nd } = c;
  const i0 = Math.max(0, Math.ceil((lap.start - nd.t0) * nd.rate));
  const i1 = Math.min(nd.n - 1, Math.ceil((lap.end - nd.t0) * nd.rate - 1e-6) - 1); // end-exclusive
  const dt = 1 / nd.rate;
  let seg = 0;
  for (let i = i0; i <= i1; i++) {
    const t = nd.t0 + i / nd.rate;
    const slip = nd.data[i];
    if (!Number.isFinite(slip)) continue;
    const v = sampleAt(c.speed, t) * c.speedK;
    const fz = sampleAt(c.load, t);
    const w = (Math.max(v, 0) * Math.max(slip, 0) * Math.max(fz, 0) * dt) / WEAR_REF_LOAD;
    if (!(w > 0)) continue;
    const sr = c.sr ? sampleAt(c.sr, t) * c.srK : 0;
    const sa = c.sa ? sampleAt(c.sa, t) * c.saK : 0;
    const lx = Number.isFinite(sr) ? sr * sr : 0;
    const ly = Number.isFinite(sa) ? sa * sa : 0;
    const fx = lx + ly > 0 ? lx / (lx + ly) : 0;
    const lock = sr < 0 ? w * fx : 0;
    const spin = sr > 0 ? w * fx : 0;
    total.total += w;
    total.lock += lock;
    total.spin += spin;
    total.slide += w - lock - spin;
    if (edges && segments.length) {
      const d = lapDistAt(lap, t);
      if (d < edges[0] || d >= edges[edges.length - 1]) continue;
      if (d < edges[seg]) seg = 0;
      while (seg < segments.length - 1 && d >= edges[seg + 1]) seg++;
      const g = segments[seg];
      g.total += w;
      g.lock += lock;
      g.spin += spin;
      g.slide += w - lock - spin;
    }
  }
  const gameGripLoss = c.grip ? sampleAt(c.grip, lap.start) - sampleAt(c.grip, lap.end) : NaN;
  return { total, segments, gameGripLoss };
}

/** The four tyres averaged (what the "all tyres" views and the Avg math channels show). */
export function avgSplits(xs: WearSplit[]): WearSplit {
  const o = sumSplits(xs);
  const k = xs.length ? 1 / xs.length : 0;
  return { total: o.total * k, lock: o.lock * k, spin: o.spin * k, slide: o.slide * k };
}

/** The four tyres added together. */
export function sumSplits(xs: WearSplit[]): WearSplit {
  const o = emptySplit();
  for (const x of xs) {
    o.total += x.total;
    o.lock += x.lock;
    o.spin += x.spin;
    o.slide += x.slide;
  }
  return o;
}
