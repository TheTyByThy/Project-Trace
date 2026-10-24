// Channel classification: browser categories, discrete (step) channels and well-known roles.

import type { KeyChannels } from './types';

export const CATEGORIES = [
  'Driver Inputs',
  'Speed & Position',
  'Lap & Timing',
  'Engine & Powertrain',
  'Hybrid / ERS',
  'Tyres',
  'Brakes',
  'Suspension',
  'Chassis & Dynamics',
  'Aero',
  'Environment',
  'Session & Sim',
  'Derived',
  'Math',
  'Other',
] as const;

const RULES: [RegExp, string][] = [
  [/^(throttle|brake pos|clutch|handbrake|steering angle|gear$|steer)/i, 'Driver Inputs'],
  [/(lap time|lap distance|lap number|sector|lap invalid|car pos norm|race position|^distance$|session distance)/i, 'Lap & Timing'],
  [/(kers|ers |^ers|drs|mgu|battery|hybrid)/i, 'Hybrid / ERS'],
  [/(brake temp|brake torque|brake bias|abs )/i, 'Brakes'],
  [/(tire|tyre|ndslip|wheel angular|camber|toe in|self align)/i, 'Tyres'],
  [/(suspension|damper|ride height|caster|bump|rebound|plank)/i, 'Suspension'],
  [/(aero|downforce|drag)/i, 'Aero'],
  [/(rpm|turbo|drivetrain|drive train|oil|water|engine|fuel|tc |tc2|traction)/i, 'Engine & Powertrain'],
  [/(ground speed|speed|car coord|gps|latitude|longitude|heading|velocity)/i, 'Speed & Position'],
  [/(accel|chassis|cg |cg height|yaw|roll|pitch|g force|lateral|longitudinal)/i, 'Chassis & Dynamics'],
  [/(air |road temp|track temp|wind|surface grip|weather|humidity|baro)/i, 'Environment'],
  [/(sim_|session|flag|mark|utc|damage|num tires|ffb|steering torque|fps|cpu)/i, 'Session & Sim'],
];

export function categorize(name: string): string {
  for (const [re, cat] of RULES) if (re.test(name)) return cat;
  return 'Other';
}

const DISCRETE_RE = /(gear$|^gear|lap number|mode$|map$|flag|active|available|compound|position$|invalid|is charging|num tires|setting|mark$|damage|weather type)/i;

/** Decide whether a channel should be drawn/interpolated as steps. */
export function isDiscrete(name: string, data: ArrayLike<number>): boolean {
  if (DISCRETE_RE.test(name)) return true;
  // Integer-valued with few distinct values → discrete.
  const n = data.length;
  const stride = Math.max(1, Math.floor(n / 4000));
  const seen = new Set<number>();
  for (let i = 0; i < n; i += stride) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (v !== Math.round(v)) return false;
    seen.add(v);
    if (seen.size > 12) return false;
  }
  return seen.size > 0 && seen.size <= 12 && !/(temp|pressure|speed|rpm|torque|power|load|angle)/i.test(name);
}

const find = (names: string[], ...patterns: RegExp[]) => {
  for (const re of patterns) {
    const hit = names.find((n) => re.test(n));
    if (hit) return hit;
  }
  return undefined;
};

export function detectKeyChannels(names: string[]): KeyChannels {
  return {
    lapNumber: find(names, /^lap number$/i, /^lap$/i, /^lap ?(no|num|count)/i),
    lapDistance: find(names, /^lap distance$/i, /^lap ?dist/i),
    lapTime: find(names, /^lap time$/i, /^current lap time$/i, /^laptime$/i),
    speed: find(names, /^ground speed$/i, /^speed$/i, /^vehicle speed$/i, /^gps speed$/i, /^speed\b/i, /speed$/i),
    posX: find(names, /^car coord x$/i, /^(pos|position|world) ?x$/i, /^x$/i),
    posY: find(names, /^car coord y$/i, /^(pos|position|world) ?y$/i, /^y$/i),
    posZ: find(names, /^car coord z$/i, /^(pos|position|world) ?z$/i, /^z$/i),
    lat: find(names, /^gps lat(itude)?$/i, /^lat(itude)?$/i),
    lon: find(names, /^gps lon(g|gitude)?$/i, /^lon(g|gitude)?$/i),
    lastSector: find(names, /^last sector time$/i),
    lapInvalid: find(names, /^lap invalidated$/i, /^lap invalid/i),
    utcTime: find(names, /^utc time$/i),
    throttle: find(names, /^throttle pos$/i, /^throttle/i),
    brake: find(names, /^brake pos$/i, /^brake$/i, /^brake pedal/i),
    clutch: find(names, /^clutch pos$/i, /^clutch/i),
    steering: find(names, /^steering angle$/i, /^steer/i),
    gear: find(names, /^gear$/i),
    rpm: find(names, /^engine rpm$/i, /rpm$/i),
    latG: find(names, /^cg accel lateral$/i, /lat(eral)? ?(g|accel)/i, /^g lat/i),
    longG: find(names, /^cg accel longitudinal$/i, /long(itudinal)? ?(g|accel)/i, /^g long/i),
    fuel: find(names, /^fuel level$/i, /^fuel$/i),
  };
}

/** Wheel-corner suffix (FL/FR/RL/RR) helpers for the tyre panel. */
export const CORNERS = ['FL', 'FR', 'RL', 'RR'] as const;
export type Corner = (typeof CORNERS)[number];
export function cornerChannel(names: Set<string> | string[], base: string, corner: Corner): string | undefined {
  const set = names instanceof Set ? names : new Set(names);
  const cand = [`${base} ${corner}`, `${base}${corner}`, `${base} ${corner.toLowerCase()}`];
  return cand.find((c) => set.has(c));
}
