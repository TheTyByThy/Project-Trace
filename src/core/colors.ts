// Colour system. Categorical slots come from a palette validated for colour-vision deficiency
// (adjacent-pair CVD ΔE ≥ 8, normal-vision ΔE ≥ 15, ≥ 3:1 contrast against the chart surface),
// stepped separately for the dark and light themes. Sequential ramps are single-hue; the diverging
// ramp is blue ↔ neutral grey ↔ red (used for time gained/lost).

export type Theme = 'dark' | 'light';

export const CATEGORICAL: Record<Theme, string[]> = {
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
};

/** Overlay laps get a dash pattern as secondary encoding so identity never relies on colour alone. */
export const LAP_DASHES: number[][] = [[], [7, 4], [2, 3], [10, 3, 2, 3], [4, 4], [1, 2], [12, 4], [6, 2, 2, 2]];

// Well-known channels get fixed slots so they look the same everywhere (colour follows the entity).
const FIXED: [RegExp, number][] = [
  [/^ground speed$|^speed$|speed smoothed/i, 0],
  [/^engine rpm$|rpm$/i, 1],
  [/^throttle/i, 2],
  [/^steering angle$/i, 3],
  [/^gear$/i, 6],
  [/^brake pos/i, 7],
  [/^clutch/i, 4],
  [/ fl$/i, 0],
  [/ fr$/i, 1],
  [/ rl$/i, 2],
  [/ rr$/i, 3],
  [/ hf$/i, 6],
  [/ hr$/i, 7],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function defaultSlot(name: string): number {
  for (const [re, slot] of FIXED) if (re.test(name)) return slot;
  return hash(name) % 8;
}

/** Colours for a group of channels drawn together: honour overrides, then avoid duplicates. */
export function channelColors(names: string[], theme: Theme, overrides: Record<string, { color?: string }>): string[] {
  const pal = CATEGORICAL[theme];
  const used = new Set<number>();
  return names.map((n) => {
    const o = overrides[n]?.color;
    if (o) return o;
    let slot = defaultSlot(n);
    for (let k = 0; k < 8 && used.has(slot); k++) slot = (slot + 1) % 8;
    used.add(slot);
    return pal[slot];
  });
}

export function lapColor(slot: number, theme: Theme): string {
  return CATEGORICAL[theme][slot % 8];
}

// ---- ramps ----
type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const RAMPS: Record<string, Record<Theme, string[]>> = {
  blue: {
    dark: ['#104281', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb'],
    light: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#104281'],
  },
  orange: {
    dark: ['#6b2a0c', '#9a3d12', '#c9541f', '#eb6834', '#f29a72', '#fbd3c0'],
    light: ['#fbd3c0', '#f5ad8c', '#ef8656', '#eb6834', '#c04d1f', '#7f2f10'],
  },
  diverging: {
    dark: ['#2a78d6', '#5598e7', '#9fb6d6', '#6b6b66', '#d9a0a0', '#e66767', '#d03b3b'],
    light: ['#104281', '#3987e5', '#9ec5f4', '#dddcd8', '#f2a7a7', '#e34948', '#a52a2a'],
  },
};

export type RampName = 'blue' | 'orange' | 'diverging';
export const RAMP_LABELS: Record<RampName, string> = { blue: 'Blue (sequential)', orange: 'Orange (sequential)', diverging: 'Blue ↔ Red (diverging)' };

const lutCache = new Map<string, string[]>();

/** 256-entry CSS colour lookup table for a ramp. */
export function rampLUT(name: RampName, theme: Theme): string[] {
  const key = name + theme;
  const hit = lutCache.get(key);
  if (hit) return hit;
  const stops = RAMPS[name][theme].map(hex);
  const out: string[] = [];
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    const f = t - k;
    const c = stops[k].map((v, j) => Math.round(v + (stops[k + 1][j] - v) * f));
    out.push(`rgb(${c[0]},${c[1]},${c[2]})`);
  }
  lutCache.set(key, out);
  return out;
}

export function rampColor(name: RampName, theme: Theme, t: number): string {
  const lut = rampLUT(name, theme);
  const i = Math.max(0, Math.min(255, Math.round((Number.isFinite(t) ? t : 0) * 255)));
  return lut[i];
}

export function rampGradientCss(name: RampName, theme: Theme): string {
  return `linear-gradient(90deg, ${RAMPS[name][theme].join(', ')})`;
}

export function withAlpha(color: string, a: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const [r, g, b] = hex(color);
    return `rgba(${r},${g},${b},${a})`;
  }
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${a})`);
  return color;
}
