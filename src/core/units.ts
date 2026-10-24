// Unit handling: display-unit preferences (kph↔mph, °C↔°F, psi↔bar↔kPa) and explicit conversions
// used by the math engine's `'Channel' [unit]` syntax. All supported conversions are linear: y = k*x + b.

export interface UnitPrefs {
  speed: 'kph' | 'mph' | 'm/s';
  temperature: 'C' | 'F';
  pressure: 'psi' | 'bar' | 'kPa';
  distance: 'm' | 'km' | 'mi';
}

export const DEFAULT_UNITS: UnitPrefs = { speed: 'kph', temperature: 'C', pressure: 'psi', distance: 'm' };

export interface Linear {
  k: number;
  b: number;
}

// Canonical unit → [dimension, factor to SI-ish base, offset]
const UNITS: Record<string, [string, number, number]> = {
  // speed (base m/s)
  'm/s': ['speed', 1, 0],
  kph: ['speed', 1 / 3.6, 0],
  'km/h': ['speed', 1 / 3.6, 0],
  kmh: ['speed', 1 / 3.6, 0],
  mph: ['speed', 0.44704, 0],
  // temperature (base C)
  c: ['temp', 1, 0],
  '°c': ['temp', 1, 0],
  degc: ['temp', 1, 0],
  f: ['temp', 5 / 9, -32 * (5 / 9)],
  '°f': ['temp', 5 / 9, -32 * (5 / 9)],
  k: ['temp', 1, -273.15],
  // pressure (base kPa)
  kpa: ['pressure', 1, 0],
  psi: ['pressure', 6.894757, 0],
  bar: ['pressure', 100, 0],
  mbar: ['pressure', 0.1, 0],
  pa: ['pressure', 0.001, 0],
  // distance (base m)
  m: ['dist', 1, 0],
  km: ['dist', 1000, 0],
  mm: ['dist', 0.001, 0],
  cm: ['dist', 0.01, 0],
  ft: ['dist', 0.3048, 0],
  in: ['dist', 0.0254, 0],
  mi: ['dist', 1609.344, 0],
  // angle (base deg)
  deg: ['angle', 1, 0],
  rad: ['angle', 180 / Math.PI, 0],
  // angular rate
  'deg/s': ['angrate', 1, 0],
  'rad/s': ['angrate', 180 / Math.PI, 0],
  rpm: ['angrate', 6, 0],
  // time (base s)
  s: ['time', 1, 0],
  ms: ['time', 0.001, 0],
  min: ['time', 60, 0],
  h: ['time', 3600, 0],
  // acceleration (base m/s²)
  g: ['accel', 9.80665, 0],
  'm/s2': ['accel', 1, 0],
  'm/s^2': ['accel', 1, 0],
  // force (base N)
  n: ['force', 1, 0],
  kn: ['force', 1000, 0],
  lbf: ['force', 4.448222, 0],
  kgf: ['force', 9.80665, 0],
  // torque
  nm: ['torque', 1, 0],
  lbft: ['torque', 1.355818, 0],
  // power (base kW)
  kw: ['power', 1, 0],
  hp: ['power', 0.7457, 0],
  ps: ['power', 0.7355, 0],
  // volume
  l: ['vol', 1, 0],
  gal: ['vol', 3.785411, 0],
  // energy
  kj: ['energy', 1, 0],
  mj: ['energy', 1000, 0],
  j: ['energy', 0.001, 0],
  // ratio
  '%': ['ratio', 0.01, 0],
  ratio: ['ratio', 1, 0],
};

const norm = (u: string) => u.trim().toLowerCase().replace(/\s+/g, '').replace('²', '2');

export function unitKnown(u: string) {
  return norm(u) in UNITS;
}

/** Linear conversion from one unit to another, or null when incompatible/unknown. */
export function convertUnit(from: string, to: string): Linear | null {
  const a = UNITS[norm(from)];
  const b = UNITS[norm(to)];
  if (!a || !b || a[0] !== b[0]) return null;
  // value_base = x*a1 + a2 ; y = (value_base - b2)/b1
  return { k: a[1] / b[1], b: (a[2] - b[2]) / b[1] };
}

const PRETTY: Record<string, string> = { c: '°C', f: '°F', kph: 'km/h', 'km/h': 'km/h' };
export const prettyUnit = (u: string) => PRETTY[norm(u)] ?? u;

export interface DisplayConv extends Linear {
  unit: string;
}

/** How a channel with source unit `unit` should be displayed under the user's preferences. */
export function displayConv(unit: string, prefs: UnitPrefs, override?: string): DisplayConv {
  const target = override || preferredUnit(unit, prefs);
  if (target && norm(target) !== norm(unit)) {
    const c = convertUnit(unit, target);
    if (c) return { ...c, unit: prettyUnit(target) };
  }
  return { k: 1, b: 0, unit: prettyUnit(unit) };
}

function preferredUnit(unit: string, prefs: UnitPrefs): string | null {
  const u = UNITS[norm(unit)];
  if (!u) return null;
  switch (u[0]) {
    case 'speed':
      return prefs.speed;
    case 'temp':
      return prefs.temperature;
    case 'pressure':
      return prefs.pressure;
    default:
      return null;
  }
}

export const IDENTITY: DisplayConv = { k: 1, b: 0, unit: '' };
