// Shared by the tyre wear components: the cause colours and bars, the tyre "wheel" (rubber ring split into
// lock-up / wheelspin / cornering slide), wear of the selected laps over the whole lap or one section, the
// section in focus (clicked in a Tyre Wear table), and the game's wear factor for validation.

import { create } from 'zustand';
import { CATEGORICAL, withAlpha } from '../core/colors';
import { formatDelta, formatValue } from '../core/format';
import { avgSplits, lapWear, TYRES, WEAR_CAUSES, type LapWear, type Tyre, type WearSplit } from '../core/tyreWear';
import { lapLabel } from '../core/session';
import type { Lap, Session } from '../core/types';
import { selectedLaps, sessionsWithSelection, useStore, type SelectedLap } from '../state/store';
import { slowLaps, useSheetCutoff } from './TrendView';

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

// ---- wear items: a selected lap, or a selected stint's average lap ----

/**
 * What the tyre-wear components compare: one selected lap, or the average lap of a selected stint (its
 * complete laps, minus those the worksheet's 107% filter drops). The first item is the reference.
 */
export interface WearItem {
  key: string;
  color: string;
  session: Session;
  /** The laps averaged (one for a lap). */
  laps: Lap[];
  /** Short label for headers and rows ("L5", "Lewis avg"). */
  short: string;
  /** Full label for tooltips and sentences. */
  long: string;
  stint: boolean;
}

export const lapItems = (sel: SelectedLap[]): WearItem[] =>
  sel.filter((l) => l.lap.index !== -1).map((l) => ({ key: l.key, color: l.color, session: l.session, laps: [l.lap], short: `L${l.lap.number}`, long: lapLabel(l.lap), stint: false }));

/** One item per stint with a selected lap (the reference's first), averaging its complete laps that aren't in `slow`. */
export function stintItems(sel: SelectedLap[], slow: Set<Lap>): WearItem[] {
  const seen = new Set<Session>();
  const out: WearItem[] = [];
  for (const l of sel) {
    if (seen.has(l.session)) continue;
    seen.add(l.session);
    const s = l.session;
    const laps = s.laps.filter((x) => x.complete && !slow.has(x));
    if (!laps.length) continue;
    const who = (s.meta.driver || 'Stint').split(/\s+/)[0].slice(0, 12);
    const at = new Date(s.meta.savedAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    out.push({
      key: 'stint:' + s.id,
      color: l.color,
      session: s,
      laps,
      short: `${who} avg`,
      long: `${s.meta.driver || 'Stint'} ${at} — average of ${laps.length} lap${laps.length > 1 ? 's' : ''} (${laps.map((x) => x.number).join(', ')})`,
      stint: true,
    });
  }
  return out;
}

/** The items a tyre-wear component compares: the selected laps, or (stint mode) one average lap per selected stint. */
export function useWearItems(stints: boolean): WearItem[] {
  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  const cutoff = useSheetCutoff();
  const sel = selectedLaps();
  if (!stints) return lapItems(sel);
  // The same slow laps the worksheet's trends leave out (judged on the stints with a selected lap).
  return stintItems(sel, slowLaps(sessionsWithSelection(sessions, lapSel), cutoff));
}

// lapWear for one lap is the same every time (until the session's channels change): keep it.
const lapWearCache = new WeakMap<Lap, Map<string, { nd: unknown; w: LapWear | null }>>();
function cachedLapWear(s: Session, lap: Lap, t: Tyre, edges?: number[]): LapWear | null {
  let m = lapWearCache.get(lap);
  if (!m) lapWearCache.set(lap, (m = new Map()));
  const k = `${t}|${edges ? edges.map((e) => e.toFixed(1)).join(',') : ''}`;
  const nd = s.channels.get(`ndSlip ${t}`);
  const hit = m.get(k);
  if (hit && hit.nd === nd) return hit.w;
  const w = lapWear(s, lap, t, edges);
  m.set(k, { nd, w });
  return w;
}

/** One tyre's wear for an item: the lap's, or the average over the stint's laps (segments averaged too). */
export function itemWear(item: WearItem, t: Tyre, edges?: number[]): LapWear | null {
  const ws = item.laps.map((l) => cachedLapWear(item.session, l, t, edges));
  if (ws.some((w) => !w)) return null;
  if (ws.length === 1) return ws[0];
  const all = ws as LapWear[];
  return {
    ...all[0],
    total: avgSplits(all.map((w) => w.total)),
    segments: all[0].segments.map((_, i) => avgSplits(all.map((w) => w.segments[i]))),
    gameGripLoss: all.reduce((a, w) => a + w.gameGripLoss, 0) / all.length,
  };
}

/** An item's wear on each tyre over the whole lap or one lap-distance range. */
export function itemFourWear(item: WearItem, range?: [number, number]): FourWear | null {
  const wear = {} as Record<Tyre, WearSplit>;
  const game = {} as Record<Tyre, number>;
  for (const t of TYRES) {
    const w = itemWear(item, t, range ? [range[0], range[1]] : undefined);
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

/**
 * The same as WearWheel, as straight bars: one horizontal bar per lap (reference on top, comparisons below),
 * split into lock-up / wheelspin / slide, inside the same square. 'amount' mode: bar length = wear against
 * `max` (shared by every tyre and lap); 'share' mode: every bar is full length and shows the mix.
 */
export function WearBars({
  rings,
  colors,
  mode,
  max,
  title,
  size = 150,
  width,
  units = 'm',
}: {
  rings: WheelRing[];
  colors: Record<Cause, string>;
  mode: 'share' | 'amount';
  max: number;
  title?: string;
  /** Height (and the width, unless `width` is given). */
  size?: number;
  /** Bars can be wider than tall, to use the tyre's whole cell. */
  width?: number;
  units?: 'm' | 'pct';
}) {
  const H = 200;
  const W = Math.round(H * Math.max(1, (width ?? size) / size));
  const pad = 8;
  const n = Math.max(1, rings.length);
  const slot = (H - 2 * pad) / n; // each lap: a label line and its bar
  const barH = Math.min(46, slot * 0.5);
  const ref = rings[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={width ?? size} height={size} className="wear-bars" role="img" aria-label={title}>
      <title>
        {rings
          .map((r) => `${r.label}: ${formatValue(r.w.total, 0)} m — ${WEAR_CAUSES.map((k) => `${k.label} ${formatValue(r.w[k.key], 0)} m`).join(', ')}`)
          .join('\n')}
      </title>
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={10} className="wear-bars-box" />
      {rings.map((r, i) => {
        const top = pad + i * slot + (slot - barH - 22) / 2;
        const y = top + 22;
        const full = W - 2 * pad - 4;
        const len = mode === 'amount' && max > 0 ? Math.min(1, r.w.total / max) * full : full;
        let x = pad + 2;
        const segs = WEAR_CAUSES.map((k) => {
          const wdt = r.w.total > 0 ? (r.w[k.key] / r.w.total) * len : 0;
          const el = wdt > 0.3 ? <rect key={k.key} x={x} y={y} width={wdt} height={barH} fill={colors[k.key]} /> : null;
          x += wdt;
          return el;
        });
        const d = r.w.total - ref.w.total;
        const dp = pctDelta(r.w.total, ref.w.total);
        const delta = units === 'pct' ? (Number.isFinite(dp) ? `${formatDelta(dp, 0)}%` : '—') : `${formatDelta(d, 0)} m`;
        return (
          <g key={i}>
            <text x={pad + 2} y={top + 14} className="wear-bars-tag" style={{ fill: r.color }}>
              {i === 0 ? 'REF' : i === 1 ? 'CMP' : 'CMP 2'}
            </text>
            <text x={W - pad - 2} y={top + 14} className="wear-bars-value">
              {formatValue(r.w.total, 0)} m
              {i > 0 && (
                <tspan className="wear-bars-delta" style={{ fill: Math.abs(d) < 0.5 ? undefined : d > 0 ? 'var(--loss)' : 'var(--gain)' }}>
                  {'  '}
                  {delta}
                </tspan>
              )}
            </text>
            <rect x={pad + 2} y={y} width={full} height={barH} rx={3} fill={withAlpha(r.color, 0.13)} />
            {segs}
            <rect x={pad + 2} y={y} width={len} height={barH} rx={3} fill="none" stroke={r.color} strokeWidth={1.5} />
          </g>
        );
      })}
    </svg>
  );
}
