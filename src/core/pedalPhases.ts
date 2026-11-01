// Where the lap's time goes by pedal: braking, full throttle, part throttle and rolling (neither pedal).
// Every moment of the lap is in exactly one phase, checked in that order (braking wins over the throttle
// when both pedals are pressed), so the four add up to the lap time. The distance covered in each phase is
// worked out alongside from the speed.

import { convertUnit } from './units';
import { sampleAt } from './channel';
import type { Lap, Session } from './types';

export type Phase = 'braking' | 'full' | 'part' | 'rolling';

export const PHASES: { key: Phase; label: string; short: string; color: string }[] = [
  { key: 'braking', label: 'Braking', short: 'Brake', color: '#e5484d' },
  { key: 'full', label: 'Full throttle', short: 'Full', color: '#199e70' },
  { key: 'part', label: 'Part throttle', short: 'Part', color: '#7fc8a9' },
  { key: 'rolling', label: 'Rolling', short: 'Roll', color: '#c98500' },
];

export interface PhaseThresholds {
  /** Brake (%) from which the car counts as braking. */
  brake: number;
  /** Throttle (%) that counts as full throttle (the corner settings' value, 98 by default). */
  full: number;
  /** Throttle (%) below which (and no brake) the car is rolling. */
  pedal: number;
}

export const DEFAULT_PHASE_THRESHOLDS: PhaseThresholds = { brake: 2, full: 98, pedal: 2 };

export interface LapPhases {
  /** Seconds in each phase; they add up to `total`. */
  time: Record<Phase, number>;
  /** Metres covered in each phase (NaN without a speed channel). */
  dist: Record<Phase, number>;
  /** The lap's duration as integrated (end − start). */
  total: number;
}

/** Pedal positions in %, whatever the log stores (0–1 fractions are scaled up). */
function pedalScale(values: Float32Array | Float64Array | number[], n: number): number {
  let max = 0;
  for (let i = 0; i < n; i++) if (values[i] > max) max = values[i];
  return max > 0 && max <= 1.0001 ? 100 : 1;
}

export function lapPhases(s: Session, lap: Lap, th: PhaseThresholds = DEFAULT_PHASE_THRESHOLDS): LapPhases | null {
  if (lap.index === -1 || !(lap.end > lap.start)) return null;
  const thr = s.channels.get('Throttle Pos') ?? (s.key.throttle ? s.channels.get(s.key.throttle) : undefined);
  const brk = s.channels.get('Brake Pos') ?? (s.key.brake ? s.channels.get(s.key.brake) : undefined);
  if (!thr || !brk || !thr.n || !brk.n) return null;
  const spd = s.key.speed ? s.channels.get(s.key.speed) : undefined;
  const toMps = spd ? convertUnit(spd.unit || 'kph', 'm/s') : null;
  const kt = pedalScale(thr.data, thr.n);
  const kb = pedalScale(brk.data, brk.n);
  // A grid at least as fine as the faster pedal channel (and 100 Hz); each step is the midpoint of its slice.
  const rate = Math.max(thr.rate, brk.rate, 100);
  const total = lap.end - lap.start;
  const steps = Math.ceil(total * rate);
  const time: Record<Phase, number> = { braking: 0, full: 0, part: 0, rolling: 0 };
  const dist: Record<Phase, number> = { braking: 0, full: 0, part: 0, rolling: 0 };
  for (let k = 0; k < steps; k++) {
    const a = lap.start + k / rate;
    const b = Math.min(lap.end, a + 1 / rate);
    const t = (a + b) / 2;
    const dt = b - a;
    const tp = sampleAt(thr, t) * kt;
    const bp = sampleAt(brk, t) * kb;
    const p: Phase = bp >= th.brake ? 'braking' : tp >= th.full ? 'full' : tp >= th.pedal ? 'part' : 'rolling';
    time[p] += dt;
    if (spd && toMps) dist[p] += Math.max(0, sampleAt(spd, t) * toMps.k + toMps.b) * dt;
  }
  if (!spd || !toMps) for (const p of Object.keys(dist) as Phase[]) dist[p] = NaN;
  return { time, dist, total };
}
