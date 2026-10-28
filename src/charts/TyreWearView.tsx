// Tyre wear: how much rubber each tyre loses on each selected lap, why (lock-ups, wheelspin, cornering
// slides) and where on the lap — against the reference. Wear is the load-weighted sliding distance from
// src/core/tyreWear.ts, which follows the game's own rubber wear (Tire Rubber Grip) closely and compares
// fairly between drivers and stints. Click a row to zoom the graphs to that section and open its pop-out
// (the section's wear per tyre, by cause); Tyre Wear Wheels elsewhere on the sheet follow the same section.

import { lapHeaderTint, lapTint } from '../core/colors';
import { lapBuckets } from '../core/corners';
import { formatDelta, formatValue } from '../core/format';
import { avgSplits, hasWearChannels, sumSplits, TYRES, WEAR_CAUSES, type LapWear, type Tyre, type WearSplit } from '../core/tyreWear';
import { selectedLaps, setCursor, setHighlight, setXMode, setZoom, trackProfile, updateComponent, useStore } from '../state/store';
import type { TyreWearConfig } from '../state/workspace';
import { WheelsGrid } from './WearWheelsView';
import { CauseBar, causeColors, gameFactor, gameFactorText, itemWear, pctDelta, setWearFocus, useWearFocus, useWearItems, type WearItem } from './wearShared';

/** Mini-sector length (m) when the track has no corners, or when chosen in the Properties. */
export const MINI_SECTOR = 200;

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

export function TyreWearView({ config }: { config: TyreWearConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  useStore((s) => s.settings.trackProfiles);
  const theme = useStore((s) => s.settings.theme);
  const cornerSettings = useStore((s) => s.settings.corners);
  const focus = useWearFocus((s) => s.focus);
  // Stint mode: one average lap per selected stint (107% filter applied) in place of each selected lap.
  const stints = config.source === 'stints';
  const items = useWearItems(stints);
  const sel = selectedLaps();
  if (!sel[0]) return <div className="empty-state">Select a lap to see its tyre wear.</div>;
  if (!stints && sel[0].lap.index === -1) return <div className="empty-state">Pick a single lap as the reference (not the whole session).</div>;
  const ref = items[0];
  if (!ref) return <div className="empty-state">No complete laps in the selected stints (or all over the worksheet's 107% cut-off).</div>;
  if (!hasWearChannels(ref.session))
    return (
      <div className="empty-state" style={{ maxWidth: 440 }}>
        <b>No tyre slip data in this session</b>
        <div style={{ marginTop: 8, lineHeight: 1.6 }}>
          The wear model needs each tyre's ndSlip and Tire Load channels and the ground speed, which Telemetrick logs for Assetto Corsa.
        </div>
      </div>
    );

  const colors = causeColors(theme);
  const tyre = config.tyre ?? 'all';
  const corners = trackProfile(ref.session.meta.venue).corners;
  const byCorners = (config.sections ?? 'corners') === 'corners' && corners.length > 0;
  const trackLen = ref.session.trackLength || ref.laps[0].length;
  const sections = byCorners
    ? lapBuckets({ session: ref.session, lap: ref.laps[0], settings: cornerSettings }, corners).map((g) => ({
        name: g.name,
        entry: g.entry,
        exit: g.exit,
        apex: g.apex,
        straight: g.kind === 'straight',
      }))
    : Array.from({ length: Math.ceil(trackLen / MINI_SECTOR) }, (_, i) => {
        const a = i * MINI_SECTOR;
        const b = Math.min(trackLen, a + MINI_SECTOR);
        return { name: `${a}–${Math.round(b)} m`, entry: a, exit: b, apex: (a + b) / 2, straight: false };
      });
  const edges = sections.length ? [sections[0].entry, ...sections.map((s) => s.exit)] : undefined;

  // Wear of every item (lap, or a stint's average lap), per tyre (null where its session lacks the channels).
  const wear: (Record<Tyre, LapWear> | null)[] = items.map((it) => {
    const out = {} as Record<Tyre, LapWear>;
    for (const t of TYRES) {
      const w = itemWear(it, t, edges);
      if (!w) return null;
      out[t] = w;
    }
    return out;
  });
  const refW = wear[0]!;
  const breakdown = !!config.showBreakdown;
  const cmpSpan = breakdown ? 5 : 3;
  // Cards: one per tyre, or (overview) a single card with the four tyres averaged.
  // Cards: with "Avg" chosen, your preference (one per tyre, or the four averaged); a tyre button shows just that tyre.
  const averaged = tyre === 'all' && config.cards === 'average';
  const cards: (Tyre | 'avg')[] = tyre !== 'all' ? [tyre] : averaged ? ['avg'] : [...TYRES];
  const cardWear = (w: Record<Tyre, LapWear>, t: Tyre | 'avg'): { total: WearSplit; gameGripLoss: number } =>
    t === 'avg' ? { total: avgSplits(TYRES.map((x) => w[x].total)), gameGripLoss: TYRES.reduce((a, x) => a + w[x].gameGripLoss, 0) / 4 } : w[t];
  const cmp = items.slice(1);
  const maxTyre = Math.max(1, ...wear.flatMap((w) => (w ? TYRES.map((t) => w[t].total.total) : [])));
  const showGame = config.showGame === true && TYRES.some((t) => Number.isFinite(refW[t].gameGripLoss));

  // "Where": the chosen tyre (or all four added) per section.
  const sectionWear = (w: Record<Tyre, LapWear>, i: number) => (tyre === 'all' ? avgSplits(TYRES.map((t) => w[t].segments[i])) : w[tyre].segments[i]);
  const lapTotal = (w: Record<Tyre, LapWear>) => (tyre === 'all' ? avgSplits(TYRES.map((t) => w[t].total)) : w[tyre].total);
  const rows = sections.map((s, i) => ({ s, ref: sectionWear(refW, i), cmp: cmp.map((_, ci) => (wear[ci + 1] ? sectionWear(wear[ci + 1]!, i) : null)) }));
  const refLapTotal = lapTotal(refW);
  // Cause bars in every lap's column share one scale, so their lengths compare across laps.
  const maxShare = Math.max(1e-9, ...rows.flatMap((r) => [r.ref.total, ...r.cmp.map((c) => c?.total ?? 0)]));
  const maxAbs = Math.max(1e-9, ...rows.flatMap((r) => r.cmp.map((c) => (c ? Math.abs(c.total - r.ref.total) : 0))));
  const visible = byCorners && config.showStraights !== true ? rows.filter((r) => !r.s.straight) : rows;
  const shown =
    config.sort === 'delta' && cmp.length
      ? visible.slice().sort((a, b) => (b.cmp[0]?.total ?? 0) - b.ref.total - ((a.cmp[0]?.total ?? 0) - a.ref.total))
      : visible;

  // One-line summary for the first comparison lap.
  let summary = '';
  if (cmp.length && wear[1]) {
    const tot = (w: Record<Tyre, LapWear>) => sumSplits(TYRES.map((t) => w[t].total)).total;
    const d = pctDelta(tot(wear[1]!), tot(refW));
    const worstTyre = TYRES.map((t) => ({ t, d: pctDelta(wear[1]![t].total.total, refW[t].total.total) })).sort((a, b) => b.d - a.d)[0];
    const worstRow = visible.filter((r) => r.cmp[0]).sort((a, b) => b.cmp[0]!.total - b.ref.total - (a.cmp[0]!.total - a.ref.total))[0];
    summary = `${cmp[0].stint ? cmp[0].short : cmp[0].long} vs reference: ${formatDelta(d, 1)}% tyre wear overall`;
    if (worstTyre && worstTyre.d > 0.5) summary += `, most on ${worstTyre.t} (${formatDelta(worstTyre.d, 1)}%)`;
    if (worstRow && worstRow.cmp[0]!.total - worstRow.ref.total > 0)
      summary += `; biggest extra wear${tyre === 'all' ? '' : ` (${tyre})`} in ${worstRow.s.name} (${formatDelta(worstRow.cmp[0]!.total - worstRow.ref.total, 0)} m, ${mainCause(worstRow.ref, worstRow.cmp[0]!)})`;
    summary += '.';
  }

  const isFocused = (s: { entry: number; exit: number }) =>
    !!focus && focus.venue === ref.session.meta.venue && Math.abs(focus.entry - s.entry) < 0.5 && Math.abs(focus.exit - s.exit) < 0.5;
  const popout = focus && focus.source === config.id && focus.venue === ref.session.meta.venue && config.popout !== false ? focus : null;
  // Game vs model: how hard the game wore the tyres for this much modelled wear (validation of the wear setting).
  const factors = [...new Set(items.map((l) => l.session))].map((s) => ({ s, f: gameFactor(s) }));

  return (
    <>
      <div className="html-panel">
        <div className="subtabs">
          <div className="seg" title="Compare the selected laps, or each selected stint's average lap (complete laps, minus those over the worksheet's 107% filter)">
            <button className={!stints ? 'on' : ''} onClick={() => updateComponent(config.id, { source: 'laps' }, 'Tyre wear: laps')}>
              Laps
            </button>
            <button className={stints ? 'on' : ''} onClick={() => updateComponent(config.id, { source: 'stints' }, 'Tyre wear: stint average')}>
              Stint avg
            </button>
          </div>
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
            <button
              className={byCorners ? 'on' : ''}
              disabled={!corners.length}
              title={corners.length ? undefined : 'No corners defined for this track yet'}
              onClick={() => updateComponent(config.id, { sections: 'corners' })}
            >
              Corners
            </button>
            <button className={!byCorners ? 'on' : ''} onClick={() => updateComponent(config.id, { sections: 'mini' })}>
              {MINI_SECTOR} m
            </button>
          </div>
          {byCorners && (
            <button
              className={'btn small' + (config.showStraights === true ? ' active' : '')}
              onClick={() => updateComponent(config.id, { showStraights: config.showStraights !== true }, 'Show straights')}
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

        <div className={'wear-grid' + (cards.length === 1 ? ' single' : '')}>
          {cards.map((t) => (
            <div key={t} className="wear-card">
              <div className="wear-card-head">{t === 'avg' ? 'Average of the four tyres' : t}</div>
              {items.map((l, li) => {
                const w = wear[li] && cardWear(wear[li]!, t);
                if (!w) return null;
                const d = li ? pctDelta(w.total.total, cardWear(refW, t).total.total) : NaN;
                return (
                  <div
                    key={l.key}
                    className={'wear-row' + (stints ? ' stint' : '')}
                    style={{ background: lapTint(l.color, 0.12) }}
                    title={`${l.long}: ${formatValue(w.total.total, 0)} m of full sliding at 5 kN`}
                  >
                    <span>{l.short}</span>
                    <CauseBar w={w.total} max={maxTyre} colors={colors} />
                    <span className="num">{formatValue(w.total.total, 0)} m</span>
                    <span className="num" style={{ color: !Number.isFinite(d) ? undefined : d > 0 ? 'var(--loss)' : 'var(--gain)' }}>
                      {li ? `${formatDelta(d, 1)}%` : 'ref'}
                    </span>
                    {showGame && (
                      <span
                        className="num muted"
                        title={`Grip the game took off this tyre over the lap (Tire Rubber Grip).\n${gameFactorText(gameFactor(l.session))}`}
                      >
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
                {ref.short} (ref) · {tyre === 'all' ? 'avg of 4 tyres' : tyre}
              </th>
              {cmp.map((l) => (
                <th key={l.key} colSpan={cmpSpan} style={{ background: lapHeaderTint(l.color), color: 'var(--text)' }}>
                  {l.short} {breakdown ? '· Δ to ref' : 'Δ'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.s.name + r.s.entry}
                className={'click' + (isFocused(r.s) ? ' sel' : '')}
                style={r.s.straight ? { color: 'var(--text-2)' } : undefined}
                title="Click: zoom the graphs here and open this section's tyre wear (click again to close)"
                onClick={() => {
                  if (isFocused(r.s)) return setWearFocus(null);
                  setXMode('distance');
                  setZoom([r.s.entry - 40, r.s.exit + 40]);
                  setCursor(r.s.apex);
                  setWearFocus({ name: r.s.name, entry: r.s.entry, exit: r.s.exit, venue: ref.session.meta.venue, source: config.id });
                }}
                onMouseEnter={() => setHighlight({ entry: r.s.entry, exit: r.s.exit })}
                onMouseLeave={() => setHighlight(null)}
              >
                <td className="l">{r.s.name}</td>
                <td
                  className="num"
                  style={{ background: lapTint(ref.color) }}
                  title={`${Math.round((r.ref.total / Math.max(refLapTotal.total, 1e-9)) * 100)}% of the lap's wear`}
                >
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
                    <td
                      key={l.key}
                      className="num"
                      style={{ background: lapTint(l.color), color: Math.abs(d) < 0.5 ? undefined : d > 0 ? 'var(--loss)' : 'var(--gain)' }}
                    >
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
                <b>{stints ? 'Average lap' : 'Whole lap'}</b>
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
                  <td
                    key={l.key}
                    colSpan={cmpSpan}
                    className="num"
                    style={{ background: lapTint(l.color), fontWeight: 700, color: d > 0 ? 'var(--loss)' : 'var(--gain)' }}
                  >
                    {breakdown ? `${formatValue(lapTotal(w).total, 0)} m · ` : ''}
                    {formatDelta(d, 0)} m ({formatDelta(pctDelta(lapTotal(w).total, refLapTotal.total), 1)}%)
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        <div className="muted" style={{ padding: '8px 12px', fontSize: 12, lineHeight: 1.5 }}>
          {summary ||
            (cmp.length
              ? `Red = more wear than the reference${stints ? ' stint' : ''} there; green = less.`
              : stints
                ? 'Each corner is the average over the stint’s complete laps (minus any over the worksheet’s 107% cut-off). Select a lap in another stint (Ctrl/⌘ + click) to compare the stints.'
                : 'Wear in metres of full sliding at 5 kN (speed × normalised slip × load). Select a comparison lap (Ctrl/⌘ + click) to see where it wears the tyres more.')}{' '}
          Click a row to look at that corner on its own.
          {showGame && (
            <div
              className="wear-factor"
              title={
                factors.map(({ s, f }) => `${s.meta.driver || s.fileName}: ${gameFactorText(f)}`).join('\n\n') +
                "\n\nThe model's metres only depend on the driving; this factor is how much grip the game removed for them, so it scales with the wear-rate setting (1×, 2×, 5×…) and the compound."
              }
            >
              ⓘ Game wear factor:{' '}
              {factors.map(({ s, f }, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {factors.length > 1 && `${s.meta.driver || 'session'} `}
                  {f ? `${formatValue(f.perKm, 2)} %/km${f.multiplier != null ? ` ≈ ${formatValue(f.multiplier, 1)}×` : ''}` : 'n/a'}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {popout && <SectionPopout focus={popout} tyre={tyre} theme={theme} items={items} />}
    </>
  );
}

/** The clicked section on its own: the wheels (four tyres, or the chosen one) and its wear by cause, per lap. */
function SectionPopout({
  focus,
  tyre,
  theme,
  items,
}: {
  focus: { name: string; entry: number; exit: number };
  tyre: 'all' | Tyre;
  theme: 'dark' | 'light';
  items: WearItem[];
}) {
  const laps = items;
  const colors = causeColors(theme);
  const range: [number, number] = [focus.entry, focus.exit];
  const per = laps.map((l) => TYRES.map((t) => itemWear(l, t, range)?.segments[0] ?? null));
  const of = (i: number) => {
    const p = per[i];
    if (!p || p.some((x) => !x)) return null;
    return tyre === 'all' ? avgSplits(p as WearSplit[]) : (p[TYRES.indexOf(tyre)] as WearSplit);
  };
  const ref = of(0);
  const rows: { key: 'lock' | 'spin' | 'slide' | 'total'; label: string }[] = [
    ...WEAR_CAUSES.map((c) => ({ key: c.key, label: c.label })),
    { key: 'total', label: 'Total' },
  ];
  return (
    <div className="wear-popout" onClick={(e) => e.stopPropagation()}>
      <div className="wear-popout-head">
        {focus.name}
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          · {tyre === 'all' ? 'all four tyres' : tyre} · {Math.round(focus.entry)}–{Math.round(focus.exit)} m
        </span>
        <span className="grow" />
        <button className="btn icon ghost small" title="Close" onClick={() => setWearFocus(null)}>
          ✕
        </button>
      </div>
      <div className="wear-popout-body">
        <WheelsGrid items={laps} range={range} tyre={tyre} mode="share" theme={theme} maxCompare={2} size={tyre === 'all' ? 92 : 150} showShares={false} />
        {ref && (
          <table className="grid">
            <thead>
              <tr>
                <th className="l">{tyre === 'all' ? 'Avg of 4 tyres' : tyre}</th>
                {laps.map((l, i) => (
                  <th key={l.key} colSpan={i ? 2 : 1} style={{ background: lapHeaderTint(l.color), color: 'var(--text)' }}>
                    {l.short}
                    {i ? ' · Δ' : ' (ref)'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.key === 'total' ? 'sub' : ''}>
                  <td className="l">
                    {r.key !== 'total' && <span className="legend-swatch" style={{ background: colors[r.key] }} />} {r.label}
                  </td>
                  {laps.map((l, i) => {
                    const w = of(i);
                    if (!w) return <td key={l.key} colSpan={i ? 2 : 1} />;
                    const v = w[r.key];
                      if (!i)
                      return (
                        <td key={l.key} className="num" style={{ background: lapTint(l.color) }}>
                          {formatValue(v, 0)} m
                        </td>
                      );
                    const d = v - ref[r.key];
                    return [
                      <td key={l.key} className="num" style={{ background: lapTint(l.color) }}>
                        {formatValue(v, 0)} m
                      </td>,
                      <td
                        key={l.key + 'd'}
                        className="num"
                        style={{ background: lapTint(l.color), color: Math.abs(d) < 0.5 ? undefined : d > 0 ? 'var(--loss)' : 'var(--gain)' }}
                      >
                        {formatDelta(d, 0)}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="muted" style={{ padding: '6px 10px 8px', fontSize: 11.5 }}>
        Metres of full sliding at 5 kN in this section. Tyre Wear Wheels elsewhere on the sheet show this section too until you close this.
      </div>
    </div>
  );
}
