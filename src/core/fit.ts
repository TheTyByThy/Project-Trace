// Best-fit lines (least squares) for the Lap Trend and Scatter components: polynomials, exponential,
// logarithmic and power curves, each with R² and a readable equation.

import { evalPoly, polyFit } from './stats';

export type FitKind = 'linear' | 'poly2' | 'poly3' | 'poly4' | 'exponential' | 'logarithmic' | 'power';

export const FIT_KINDS: [FitKind, string][] = [
  ['linear', 'Linear'],
  ['poly2', 'Polynomial (2nd order)'],
  ['poly3', 'Polynomial (3rd order)'],
  ['poly4', 'Polynomial (4th order)'],
  ['exponential', 'Exponential'],
  ['logarithmic', 'Logarithmic'],
  ['power', 'Power'],
];

export interface Fit {
  kind: FitKind;
  /** Polynomials: c0..cn (y = Σ ck xᵏ). Exponential: [a, b] (y = a·e^(bx)). Logarithmic: [a, b] (y = a + b·ln x). Power: [a, b] (y = a·x^b). */
  coef: number[];
  r2: number;
  eval: (x: number) => number;
}

/** The fit options a component stores (Scatter's older configs used fit: 'none' to mean off). */
export interface FitOptions {
  fit?: FitKind | 'none';
  /** Best-fit line on/off (defaults to on when an older config named a fit). */
  showFit?: boolean;
  /** Show the equation and R² (default on). */
  showEquation?: boolean;
}

export function fitSettings(c: FitOptions): { on: boolean; kind: FitKind; equation: boolean } {
  const kind = c.fit && c.fit !== 'none' ? c.fit : 'linear';
  return { on: c.showFit ?? (!!c.fit && c.fit !== 'none'), kind, equation: c.showEquation !== false };
}

const POLY_DEG: Partial<Record<FitKind, number>> = { linear: 1, poly2: 2, poly3: 3, poly4: 4 };

/** What a fit kind needs of the data, for a note when it can't be fitted. */
export function fitRequirement(kind: FitKind): string {
  return kind === 'exponential' ? 'needs y > 0' : kind === 'logarithmic' ? 'needs x > 0' : kind === 'power' ? 'needs x > 0 and y > 0' : 'needs more points';
}

/** Fits the points; null when there are too few points or the data doesn't suit the curve (e.g. ln of a negative). */
export function fitCurve(xs: ArrayLike<number>, ys: ArrayLike<number>, kind: FitKind): Fit | null {
  const deg = POLY_DEG[kind];
  if (deg) {
    const f = polyFit(xs, ys, deg);
    return f && f.coef.every(Number.isFinite) ? { kind, coef: f.coef, r2: f.r2, eval: (x) => evalPoly(f.coef, x) } : null;
  }
  // The others are straight lines after a log transform; R² is measured on the original values.
  const n = Math.min(xs.length, ys.length);
  const X: number[] = [];
  const Y: number[] = [];
  const raw: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const x = xs[i],
      y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if ((kind === 'exponential' || kind === 'power') && y <= 0) return null;
    if ((kind === 'logarithmic' || kind === 'power') && x <= 0) return null;
    X.push(kind === 'exponential' ? x : Math.log(x));
    Y.push(kind === 'logarithmic' ? y : Math.log(y));
    raw.push([x, y]);
  }
  const lin = polyFit(X, Y, 1);
  if (!lin) return null;
  const [c0, c1] = lin.coef;
  let coef: number[];
  let ev: (x: number) => number;
  if (kind === 'exponential') {
    coef = [Math.exp(c0), c1];
    ev = (x) => coef[0] * Math.exp(coef[1] * x);
  } else if (kind === 'logarithmic') {
    coef = [c0, c1];
    ev = (x) => (x > 0 ? coef[0] + coef[1] * Math.log(x) : NaN);
  } else {
    coef = [Math.exp(c0), c1];
    ev = (x) => (x > 0 ? coef[0] * Math.pow(x, coef[1]) : NaN);
  }
  if (!coef.every(Number.isFinite)) return null;
  const mean = raw.reduce((a, p) => a + p[1], 0) / raw.length;
  let ssTot = 0,
    ssRes = 0;
  for (const [x, y] of raw) {
    ssTot += (y - mean) ** 2;
    ssRes += (y - ev(x)) ** 2;
  }
  return { kind, coef, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, eval: ev };
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const sup = (s: string) => s.replace(/[-0-9]/g, (c) => SUP[c]);

/** A coefficient to 4 significant figures; very large or small ones as m×10ⁿ. */
export function fmtCoef(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    return `${Number((v / 10 ** e).toPrecision(3))}×10${sup(String(e))}`;
  }
  return String(Number(v.toPrecision(4)));
}

/** "y = 0.0123x² − 0.456x + 98.7" etc. `x` names the x variable (e.g. "lap"). */
export function fitEquation(f: Fit, x = 'x'): string {
  const [a, b] = f.coef;
  if (f.kind === 'exponential') return `y = ${fmtCoef(a)}·e^(${fmtCoef(b)}${x})`;
  if (f.kind === 'logarithmic') return `y = ${fmtCoef(a)} ${b < 0 ? '−' : '+'} ${fmtCoef(Math.abs(b))}·ln(${x})`;
  if (f.kind === 'power') return `y = ${fmtCoef(a)}·${x}^${b < 0 ? `(${fmtCoef(b)})` : fmtCoef(b)}`;
  const terms: string[] = [];
  for (let k = f.coef.length - 1; k >= 0; k--) {
    const c = f.coef[k];
    if (c === 0 && f.coef.length > 1) continue;
    const mag = fmtCoef(Math.abs(c));
    const body = k === 0 ? mag : `${mag}${x}${k > 1 ? sup(String(k)) : ''}`;
    terms.push(terms.length ? `${c < 0 ? '−' : '+'} ${body}` : `${c < 0 ? '−' : ''}${body}`);
  }
  return `y = ${terms.join(' ') || '0'}`;
}
