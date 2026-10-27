// Shared by the tyre wear components: the cause colours and bars, the tyre "wheel" (rubber ring split into
// lock-up / wheelspin / cornering slide), wear of the selected laps over the whole lap or one section, the
// section in focus (clicked in a Tyre Wear table), and the game's wear factor for validation.

import { create } from 'zustand';
import { CATEGORICAL, withAlpha } from '../core/colors';
import { formatDelta, formatValue } from '../core/format';
import { avgSplits, lapWear, TYRES, WEAR_CAUSES, type Tyre, type WearSplit } from '../core/tyreWear';
import type { Session } from '../core/types';
import type { SelectedLap } from '../state/store';

export type Cause = (typeof WEAR_CAUSES)[number]['key'];

export function causeColors(theme: 'dark' | 'light'): Record<Cause, string> {
  const pal = CATEGORICAL[theme];
  return { lock: pal[7], spin: pal[3], slide: pal[0] };
}

/** Horizontal bar: length ∝ total wear (against `max`), split into lock-up / wheelspin / slide. */
export function CauseBar({ w, max, colors }: { w: WearSplit; max: number; colors: Record<Cause, string> }) {
  const f = max > 0 ? Math.min(1, w.total / max) : 0;
  const pct = (x: number) => (w.total > 0 ? Math.round((x / w.total) * 100) : 0);
  return (
    <span className="wear-bar" title={WEAR_CAUSES.map((c) => `${c.label} ${pct(w[c.key])}%`).join(' · ')}>
      <span style={{ display: 'flex', width: `${f * 100}%`, height: '100%' }}>
        {WEAR_CAUSES.map((c) => (
          <span key={c.key} style={{ width: `${pct(w[c.key])}%`, background: colors[c.key] }} />
        ))}
      </span>
    </span>
  );
}

export const pctDelta = (v: number, ref: number) => (ref > 0 ? ((v - ref) / ref) * 100 : NaN);
export const sharePct = (w: WearSplit, k: Cause) => (w.total > 0 ? (w[k] / w.total) * 100 : 0);

// ---- section in focus ----

export interface WearFocus {
  name: string;
  entry: number;
  exit: number;
  venue: string;
  /** Component whose table row set it (that component shows the pop-out). */
  source: string;
}

export const useWearFocus = create<{ focus: WearFocus | null }>(() => ({ focus: null }));
export const setWearFocus = (focus: WearFocus | null) => useWearFocus.setState({ focus });

// ---- wear of the selected laps ----

export interface FourWear {
  wear: Record<Tyre, WearSplit>;
  /** Game's grip loss over the lap (Tire Rubber Grip, % points); NaN without the channel or for a section. */
  game: Record<Tyre, number>;
}

/** One lap's wear on each tyre, over the whole lap or one lap-distance range. Null if the lap can't be measured. */
export function lapFourWear(l: SelectedLap, range?: [number, number]): FourWear | null {
  if (l.lap.index === -1) return null;
  const wear = {} as Record<Tyre, WearSplit>;
  const game = {} as Record<Tyre, number>;
  for (const t of TYRES) {
    const w = lapWear(l.session, l.lap, t, range ? [range[0], range[1]] : undefined);
    if (!w) return null;
    wear[t] = range ? w.segments[0] : w.total;
    game[t] = range ? NaN : w.gameGripLoss;
  }
  return { wear, game };
}

/** The four tyres averaged, or one tyre. */
export const pick = (f: FourWear, t: Tyre | 'avg'): WearSplit => (t === 'avg' ? avgSplits(TYRES.map((x) => f.wear[x])) : f.wear[t]);

// ---- the game's wear factor (validation) ----

/**
 * Grip the game removes per km of modelled wear, at the 1× wear rate, by compound index ('Tyres Compound').
 * Measured on the logged Formula Alpha 2026 stints; only compound 2 has a confirmed 1× session set.
 */
export const COMPOUND_1X: Record<number, number> = { 2: 1.16 };

export interface GameFactor {
  /** Grip % the game removed per km of modelled wear, all four tyres, whole session. */
  perKm: number;
  compound: number | null;
  /** perKm ÷ the compound's 1× rate, when known. */
  multiplier: number | null;
  gripLost: number;
  wearKm: number;
}

const factorCache = new WeakMap<Session, GameFactor | null>();

/** How hard the game wore the tyres for the modelled wear, over the whole session (cached per session). */
export function gameFactor(s: Session): GameFactor | null {
  if (factorCache.has(s)) return factorCache.get(s)!;
  let gripLost = 0;
  let wearM = 0;
  for (const t of TYRES) {
    const w = lapWear(s, s.sessionLap, t);
    if (!w || !Number.isFinite(w.gameGripLoss)) {
      factorCache.set(s, null);
      return null;
    }
    gripLost += w.gameGripLoss;
    wearM += w.total.total;
  }
  const comp = s.channels.get('Tyres Compound');
  const compound = comp && comp.n ? Math.round(comp.data[Math.floor(comp.n / 2)]) : null;
  const perKm = wearM > 0 ? gripLost / (wearM / 1000) : NaN;
  const base = compound != null ? COMPOUND_1X[compound] : undefined;
  const out = Number.isFinite(perKm) && wearM > 2000 ? { perKm, compound, multiplier: base ? perKm / base : null, gripLost, wearKm: wearM / 1000 } : null;
  factorCache.set(s, out);
  return out;
}

export function gameFactorText(f: GameFactor | null): string {
  if (!f) return 'Game wear factor: not enough data (needs Tire Rubber Grip and a few km).';
  const m =
    f.multiplier != null
      ? ` ≈ ${formatValue(f.multiplier, 1)}× the 1× rate for compound ${f.compound} (${COMPOUND_1X[f.compound!]} %/km)`
      : f.compound != null
        ? ` (no 1× reference recorded for compound ${f.compound})`
        : '';
  return `Game wear factor: ${formatValue(f.perKm, 2)} % grip per km of modelled wear${m}. Session: ${formatValue(f.gripLost / 4, 1)} % grip lost per tyre for ${formatValue(f.wearKm / 4, 1)} km of wear per tyre.`;
}

// ---- the wheel ----

export interface WheelRing {
  w: WearSplit;
  /** Lap colour (a thin marker ring next to the band). */
  color: string;
  label: string;
}

const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

/** An annular segment from angle a0 to a1 (radians, clockwise from 12 o'clock). */
function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}

/**
 * A tyre seen side-on: the rubber is a ring per lap (outer = reference, then comparisons inwards), each split
 * into lock-up / wheelspin / slide. 'share' mode: every ring goes all the way round (the mix); 'amount' mode:
 * a ring's length is its wear against `max`, so a tyre or lap that wears less has a shorter ring.
 */
export function WearWheel({
  rings,
  colors,
  mode,
  max,
  title,
  size = 150,
  units = 'm',
}: {
  rings: WheelRing[];
  colors: Record<Cause, string>;
  mode: 'share' | 'amount';
  max: number;
  title?: string;
  size?: number;
  /** The comparison's difference in the centre: metres, or % of the reference. */
  units?: 'm' | 'pct';
}) {
  const c = 100;
  const outer = 96;
  const rim = rings.length > 2 ? 50 : rings.length > 1 ? 56 : 60;
  const band = (outer - rim) / Math.max(1, rings.length);
  const ref = rings[0];
  const cmp = rings[1];
  const d = cmp ? cmp.w.total - ref.w.total : NaN;
  const dPct = cmp ? pctDelta(cmp.w.total, ref.w.total) : NaN;
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className="wear-wheel" role="img" aria-label={title}>
      <title>
        {rings
          .map((r) => `${r.label}: ${formatValue(r.w.total, 0)} m — ${WEAR_CAUSES.map((k) => `${k.label} ${formatValue(r.w[k.key], 0)} m`).join(', ')}`)
          .join('\n')}
      </title>
      <circle cx={c} cy={c} r={outer + 2} className="wear-wheel-tyre" />
      {rings.map((r, i) => {
        const r1 = outer - i * band - (i ? 1.5 : 0);
        const r0 = r1 - band + 2;
        const span = mode === 'amount' && max > 0 ? Math.min(1, r.w.total / max) * Math.PI * 2 : Math.PI * 2;
        let a = 0;
        const segs = WEAR_CAUSES.map((k) => {
          const f = r.w.total > 0 ? r.w[k.key] / r.w.total : 0;
          const a0 = a;
          a += f * span;
          return f > 0.002 ? <path key={k.key} d={arcPath(c, c, r0, r1, a0, a)} fill={colors[k.key]} /> : null;
        });
        return (
          <g key={i}>
            <path d={arcPath(c, c, r0, r1, 0, Math.PI * 2)} fill={withAlpha(r.color, 0.13)} />
            {segs}
            <circle cx={c} cy={c} r={r0 - 1} fill="none" stroke={r.color} strokeWidth={1.5} opacity={0.9} />
          </g>
        );
      })}
      <circle cx={c} cy={c} r={rim - 2} className="wear-wheel-rim" />
      <text x={c} y={cmp ? c - 4 : c + 2} className="wear-wheel-value">
        {formatValue(ref.w.total, 0)}
      </text>
      <text x={c} y={cmp ? c + 10 : c + 16} className="wear-wheel-unit">
        m · REF
      </text>
      {cmp && (
        <text x={c} y={c + 27} className="wear-wheel-delta" style={{ fill: Math.abs(d) < 0.5 ? undefined : d > 0 ? 'var(--loss)' : 'var(--gain)' }}>
          CMP {units === 'pct' ? (Number.isFinite(dPct) ? `${formatDelta(dPct, 0)}%` : '—') : `${formatDelta(d, 0)} m`}
        </text>
      )}
    </svg>
  );
}
