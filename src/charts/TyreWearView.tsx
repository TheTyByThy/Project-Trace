// Tyre wear: how much rubber each tyre loses on each selected lap, why (lock-ups, wheelspin, cornering
// slides) and where on the lap — against the reference. Wear is the load-weighted sliding distance from
// src/core/tyreWear.ts, which follows the game's own rubber wear (Tire Rubber Grip) closely and compares
// fairly between drivers and stints. Click a row to zoom the graphs to that section.

import { CATEGORICAL, lapHeaderTint, lapTint } from '../core/colors';
import { lapBuckets } from '../core/corners';
import { formatDelta, formatValue } from '../core/format';
import { lapLabel } from '../core/session';
import { avgSplits, hasWearChannels, lapWear, sumSplits, TYRES, WEAR_CAUSES, type LapWear, type Tyre, type WearSplit } from '../core/tyreWear';
import { selectedLaps, setCursor, setHighlight, setXMode, setZoom, trackProfile, updateComponent, useStore } from '../state/store';
import type { TyreWearConfig } from '../state/workspace';

/** Mini-sector length (m) when the track has no corners, or when chosen in the Properties. */
export const MINI_SECTOR = 200;

type Cause = (typeof WEAR_CAUSES)[number]['key'];

function causeColors(theme: 'dark' | 'light'): Record<Cause, string> {
  const pal = CATEGORICAL[theme];
  return { lock: pal[7], spin: pal[3], slide: pal[0] };
}

/** Horizontal bar: length ∝ total wear (against `max`), split into lock-up / wheelspin / slide. */
function CauseBar({ w, max, colors }: { w: WearSplit; max: number; colors: Record<Cause, string> }) {
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

/** Diverging bar for extra (red, right) or less (green, left) wear than the reference. */
function DeltaBar({ d, max }: { d: number; max: number }) {
  const f = Number.isFinite(d) && max > 0 ? Math.min(1, Math.abs(d) / max) : 0;
  return (
    <span className="delta-bar">
      <span className="mid" />
      {f > 0 && <span className={d < 0 ? 'gain' : 'loss'} style={{ width: `${f * 50}%` }} />}
    </span>
  );
}

/** The cause that changed most between two wear splits, in the direction of the total change ("less …" when lower). */
function mainCause(a: WearSplit, b: WearSplit): string {
  const d = b.total - a.total;
  const by = WEAR_CAUSES.map((c) => ({ c, v: b[c.key] - a[c.key] })).sort((x, y) => (d >= 0 ? y.v - x.v : x.v - y.v))[0];
  return by ? (d < 0 ? 'less ' : '') + by.c.label.toLowerCase() : '';
}

const pctDelta = (v: number, ref: number) => (ref > 0 ? ((v - ref) / ref) * 100 : NaN);

export function TyreWearView({ config }: { config: TyreWearConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  useStore((s) => s.settings.trackProfiles);
  const theme = useStore((s) => s.settings.theme);
  const cornerSettings = useStore((s) => s.settings.corners);
  const laps = selectedLaps();
  const ref = laps[0];
  if (!ref) return <div className="empty-state">Select a lap to see its tyre wear.</div>;
  if (ref.lap.index === -1) return <div className="empty-state">Pick a single lap as the reference (not the whole session).</div>;
  if (!hasWearChannels(ref.session))
    return (
      <div className="empty-state" style={{ maxWidth: 440 }}>
        <b>No tyre slip data in this session</b>
        <div style={{ marginTop: 8, lineHeight: 1.6 }}>The wear model needs each tyre's ndSlip and Tire Load channels and the ground speed, which Telemetrick logs for Assetto Corsa.</div>
      </div>
    );

  const colors = causeColors(theme);
  const tyre = config.tyre ?? 'all';
  const corners = trackProfile(ref.session.meta.venue).corners;
  const byCorners = (config.sections ?? 'corners') === 'corners' && corners.length > 0;
  const trackLen = ref.session.trackLength || ref.lap.length;
  const sections = byCorners
    ? lapBuckets({ session: ref.session, lap: ref.lap, settings: cornerSettings }, corners).map((g) => ({ name: g.name, entry: g.entry, exit: g.exit, apex: g.apex, straight: g.kind === 'straight' }))
    : Array.from({ length: Math.ceil(trackLen / MINI_SECTOR) }, (_, i) => {
        const a = i * MINI_SECTOR;
        const b = Math.min(trackLen, a + MINI_SECTOR);
        return { name: `${a}–${Math.round(b)} m`, entry: a, exit: b, apex: (a + b) / 2, straight: false };
      });
  const edges = sections.length ? [sections[0].entry, ...sections.map((s) => s.exit)] : undefined;

  // Wear of every selected lap, per tyre (null where a lap's session lacks the channels).
  const wear: (Record<Tyre, LapWear> | null)[] = laps.map((l) => {
    if (l.lap.index === -1) return null;
    const out = {} as Record<Tyre, LapWear>;
    for (const t of TYRES) {
      const w = lapWear(l.session, l.lap, t, edges);
      if (!w) return null;
      out[t] = w;
    }
    return out;
  });
  const refW = wear[0]!;
  const breakdown = !!config.showBreakdown;
  const cmpSpan = breakdown ? 5 : 3;
  // Cards: one per tyre, or (overview) a single card with the four tyres averaged.
  const averaged = config.cards === 'average';
  const cards: (Tyre | 'avg')[] = averaged ? ['avg'] : [...TYRES];
  const cardWear = (w: Record<Tyre, LapWear>, t: Tyre | 'avg'): { total: WearSplit; gameGripLoss: number } =>
    t === 'avg' ? { total: avgSplits(TYRES.map((x) => w[x].total)), gameGripLoss: TYRES.reduce((a, x) => a + w[x].gameGripLoss, 0) / 4 } : w[t];
  const cmp = laps.slice(1);
  const maxTyre = Math.max(1, ...wear.flatMap((w) => (w ? TYRES.map((t) => w[t].total.total) : [])));
  const showGame = config.showGame !== false && TYRES.some((t) => Number.isFinite(refW[t].gameGripLoss));

  // "Where": the chosen tyre (or all four added) per section.
  const sectionWear = (w: Record<Tyre, LapWear>, i: number) => (tyre === 'all' ? avgSplits(TYRES.map((t) => w[t].segments[i])) : w[tyre].segments[i]);
  const lapTotal = (w: Record<Tyre, LapWear>) => (tyre === 'all' ? avgSplits(TYRES.map((t) => w[t].total)) : w[tyre].total);
  const rows = sections.map((s, i) => ({ s, ref: sectionWear(refW, i), cmp: cmp.map((_, ci) => (wear[ci + 1] ? sectionWear(wear[ci + 1]!, i) : null)) }));
  const refLapTotal = lapTotal(refW);
  // Cause bars in every lap's column share one scale, so their lengths compare across laps.
  const maxShare = Math.max(1e-9, ...rows.flatMap((r) => [r.ref.total, ...r.cmp.map((c) => c?.total ?? 0)]));
  const maxAbs = Math.max(1e-9, ...rows.flatMap((r) => r.cmp.map((c) => (c ? Math.abs(c.total - r.ref.total) : 0))));
  const visible = byCorners && config.showStraights === false ? rows.filter((r) => !r.s.straight) : rows;
  const shown = config.sort === 'delta' && cmp.length ? visible.slice().sort((a, b) => (b.cmp[0]?.total ?? 0) - b.ref.total - ((a.cmp[0]?.total ?? 0) - a.ref.total)) : visible;

  // One-line summary for the first comparison lap.
  let summary = '';
  if (cmp.length && wear[1]) {
    const tot = (w: Record<Tyre, LapWear>) => sumSplits(TYRES.map((t) => w[t].total)).total;
    const d = pctDelta(tot(wear[1]!), tot(refW));
    const worstTyre = TYRES.map((t) => ({ t, d: pctDelta(wear[1]![t].total.total, refW[t].total.total) })).sort((a, b) => b.d - a.d)[0];
    const worstRow = visible.filter((r) => r.cmp[0]).sort((a, b) => b.cmp[0]!.total - b.ref.total - (a.cmp[0]!.total - a.ref.total))[0];
    summary = `${lapLabel(cmp[0].lap)} vs reference: ${formatDelta(d, 1)}% tyre wear overall`;
    if (worstTyre && worstTyre.d > 0.5) summary += `, most on ${worstTyre.t} (${formatDelta(worstTyre.d, 1)}%)`;
    if (worstRow && worstRow.cmp[0]!.total - worstRow.ref.total > 0)
      summary += `; biggest extra wear${tyre === 'all' ? '' : ` (${tyre})`} in ${worstRow.s.name} (${formatDelta(worstRow.cmp[0]!.total - worstRow.ref.total, 0)} m, ${mainCause(worstRow.ref, worstRow.cmp[0]!)})`;
    summary += '.';
  }

  return (
    <div className="html-panel">
      <div className="subtabs">
        <span className="muted" style={{ fontSize: 12 }}>
          Where:
        </span>
        <div className="seg">
          {(['all', ...TYRES] as const).map((t) => (
            <button key={t} className={tyre === t ? 'on' : ''} onClick={() => updateComponent(config.id, { tyre: t })}>
              {t === 'all' ? 'Avg' : t}
            </button>
          ))}
        </div>
        <div className="seg" title="Rows: your corners (and the straights between them) or fixed mini-sectors">
          <button className={byCorners ? 'on' : ''} disabled={!corners.length} title={corners.length ? undefined : 'No corners defined for this track yet'} onClick={() => updateComponent(config.id, { sections: 'corners' })}>
            Corners
          </button>
          <button className={!byCorners ? 'on' : ''} onClick={() => updateComponent(config.id, { sections: 'mini' })}>
            {MINI_SECTOR} m
          </button>
        </div>
        {byCorners && (
          <button
            className={'btn small' + (config.showStraights !== false ? ' active' : '')}
            onClick={() => updateComponent(config.id, { showStraights: config.showStraights === false }, 'Show straights')}
            title="Show or hide the straights between corners in the table (the whole-lap total still counts them)"
          >
            Straights
          </button>
        )}
        {cmp.length > 0 && (
          <button
            className={'btn small' + (breakdown ? ' active' : '')}
            onClick={() => updateComponent(config.id, { showBreakdown: !breakdown }, 'Comparison breakdown')}
            title="Also show each comparison lap's own wear and lock-up / wheelspin / slide breakdown, not just its difference to the reference"
          >
            Breakdown
          </button>
        )}
        {cmp.length > 0 && (
          <div className="seg">
            <button className={config.sort !== 'delta' ? 'on' : ''} onClick={() => updateComponent(config.id, { sort: 'track' })}>
              Lap order
            </button>
            <button className={config.sort === 'delta' ? 'on' : ''} onClick={() => updateComponent(config.id, { sort: 'delta' })}>
              Most extra wear
            </button>
          </div>
        )}
        <span className="grow" />
        <span className="muted" style={{ fontSize: 11 }}>
          {WEAR_CAUSES.map((c) => (
            <span key={c.key} title={c.hint} style={{ marginLeft: 8 }}>
              <span className="legend-swatch" style={{ background: colors[c.key] }} /> {c.label}
            </span>
          ))}
        </span>
      </div>

      <div className={'wear-grid' + (averaged ? ' single' : '')}>
        {cards.map((t) => (
          <div key={t} className="wear-card">
            <div className="wear-card-head">{t === 'avg' ? 'Average of the four tyres' : t}</div>
            {laps.map((l, li) => {
              const w = wear[li] && cardWear(wear[li]!, t);
              if (!w) return null;
              const d = li ? pctDelta(w.total.total, cardWear(refW, t).total.total) : NaN;
              return (
                <div key={l.key} className="wear-row" style={{ background: lapTint(l.color, 0.12) }} title={`${lapLabel(l.lap)}: ${formatValue(w.total.total, 0)} m of full sliding at 5 kN`}>
                  <span>L{l.lap.number}</span>
                  <CauseBar w={w.total} max={maxTyre} colors={colors} />
                  <span className="num">{formatValue(w.total.total, 0)} m</span>
                  <span className="num" style={{ color: !Number.isFinite(d) ? undefined : d > 0 ? 'var(--loss)' : 'var(--gain)' }}>
                    {li ? `${formatDelta(d, 1)}%` : 'ref'}
                  </span>
                  {showGame && (
                    <span className="num muted" title="Grip the game took off this tyre over the lap (Tire Rubber Grip)">
                      {Number.isFinite(w.gameGripLoss) ? `−${formatValue(w.gameGripLoss, 2)}%` : ''}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th className="l">{byCorners ? 'Section' : 'Lap distance'}</th>
            <th style={{ background: lapHeaderTint(ref.color), color: 'var(--text)' }} colSpan={2}>
              L{ref.lap.number} (ref) · {tyre === 'all' ? 'avg of 4 tyres' : tyre}
            </th>
            {cmp.map((l) => (
              <th key={l.key} colSpan={cmpSpan} style={{ background: lapHeaderTint(l.color), color: 'var(--text)' }}>
                L{l.lap.number} {breakdown ? '· Δ to ref' : 'Δ'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr
              key={r.s.name + r.s.entry}
              className="click"
              style={r.s.straight ? { color: 'var(--text-2)' } : undefined}
              onClick={() => {
                setXMode('distance');
                setZoom([r.s.entry - 40, r.s.exit + 40]);
                setCursor(r.s.apex);
              }}
              onMouseEnter={() => setHighlight({ entry: r.s.entry, exit: r.s.exit })}
              onMouseLeave={() => setHighlight(null)}
            >
              <td className="l">{r.s.name}</td>
              <td className="num" style={{ background: lapTint(ref.color) }} title={`${Math.round((r.ref.total / Math.max(refLapTotal.total, 1e-9)) * 100)}% of the lap's wear`}>
                {formatValue(r.ref.total, 0)}
              </td>
              <td style={{ background: lapTint(ref.color), width: 90 }}>
                <CauseBar w={r.ref} max={maxShare} colors={colors} />
              </td>
              {cmp.map((l, ci) => {
                const c = r.cmp[ci];
                if (!c) return <td key={l.key} colSpan={cmpSpan} style={{ background: lapTint(l.color) }} />;
                const d = c.total - r.ref.total;
                return [
                  breakdown && (
                    <td key={l.key + 'v'} className="num" style={{ background: lapTint(l.color) }}>
                      {formatValue(c.total, 0)}
                    </td>
                  ),
                  breakdown && (
                    <td key={l.key + 'mix'} style={{ background: lapTint(l.color), width: 90 }}>
                      <CauseBar w={c} max={maxShare} colors={colors} />
                    </td>
                  ),
                  <td key={l.key} className="num" style={{ background: lapTint(l.color), color: Math.abs(d) < 0.5 ? undefined : d > 0 ? 'var(--loss)' : 'var(--gain)' }}>
                    {formatDelta(d, 0)}
                  </td>,
                  <td key={l.key + 'bar'} style={{ background: lapTint(l.color), width: 90 }}>
                    <DeltaBar d={d} max={maxAbs} />
                  </td>,
                  <td key={l.key + 'why'} className="l muted" style={{ background: lapTint(l.color), fontSize: 11 }}>
                    {Math.abs(d) >= 0.5 ? mainCause(r.ref, c) : ''}
                  </td>,
                ];
              })}
            </tr>
          ))}
          <tr className="sub">
            <td className="l">
              <b>Whole lap</b>
            </td>
            <td className="num" style={{ background: lapTint(ref.color) }}>
              <b>{formatValue(refLapTotal.total, 0)}</b>
            </td>
            <td style={{ background: lapTint(ref.color) }} />
            {cmp.map((l, ci) => {
              const w = wear[ci + 1];
              if (!w) return <td key={l.key} colSpan={cmpSpan} style={{ background: lapTint(l.color) }} />;
              const d = lapTotal(w).total - refLapTotal.total;
              return (
                <td key={l.key} colSpan={cmpSpan} className="num" style={{ background: lapTint(l.color), fontWeight: 700, color: d > 0 ? 'var(--loss)' : 'var(--gain)' }}>
                  {breakdown ? `${formatValue(lapTotal(w).total, 0)} m · ` : ''}{formatDelta(d, 0)} m ({formatDelta(pctDelta(lapTotal(w).total, refLapTotal.total), 1)}%)
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      <div className="muted" style={{ padding: '8px 12px', fontSize: 12, lineHeight: 1.5 }}>
        {summary ||
          (cmp.length
            ? 'Red = more wear than the reference there; green = less.'
            : 'Wear in metres of full sliding at 5 kN (speed × normalised slip × load). Select a comparison lap (Ctrl/⌘ + click) to see where it wears the tyres more.')}
      </div>
    </div>
  );
}
