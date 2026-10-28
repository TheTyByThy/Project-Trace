// Tyre Wear Summary: the whole car over the whole lap — all four tyres added up, and that total split into
// lock-up / wheelspin / cornering slide — or the same for each tyre (four small tables laid out like the car). Just numbers: the first row in metres, the others as their difference
// from it (metres or %, switched in the header). Rows are the selected laps, or one average lap per stint with a selected lap
// (complete laps, minus those the worksheet's 107% filter drops).

import { formatDelta, formatDateTime, formatValue } from '../core/format';
import { hasWearChannels, lapWear, TYRES, WEAR_CAUSES, type Tyre, type WearSplit } from '../core/tyreWear';
import { lapLabel } from '../core/session';
import type { Lap, Session } from '../core/types';
import { selectedLaps, sessionsWithSelection, updateComponent, useStore } from '../state/store';
import type { WearSummaryConfig } from '../state/workspace';
import { slowLaps, useSheetCutoff } from './TrendView';
import { causeColors, lapFourWear, pctDelta } from './wearShared';

const KEYS = ['lock', 'spin', 'slide', 'total'] as const;

/** Wear of the whole car (four tyres added up) and of each tyre. */
type Parts = Record<'car' | Tyre, WearSplit>;
const empty = (): WearSplit => ({ lock: 0, spin: 0, slide: 0, total: 0 }) as WearSplit;

/** Each tyre's wear plus the four added up. */
function withCar(w: Record<Tyre, WearSplit>): Parts {
  const car = empty();
  for (const t of TYRES) for (const k of KEYS) car[k] += w[t][k];
  return { ...w, car };
}

/** One lap's wear (car and each tyre), or null if a tyre can't be measured. */
function lapParts(s: Session, lap: Lap): Parts | null {
  const w = {} as Record<Tyre, WearSplit>;
  for (const t of TYRES) {
    const x = lapWear(s, lap, t);
    if (!x) return null;
    w[t] = x.total;
  }
  return withCar(w);
}

interface Row {
  key: string;
  label: React.ReactNode;
  /** Shorter label for the per-tyre tables. */
  short: React.ReactNode;
  w: Parts;
  title?: string;
}

export function WearSummaryView({ config }: { config: WearSummaryConfig }) {
  const lapSel = useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  const sessions = useStore((s) => s.sessions);
  const theme = useStore((s) => s.settings.theme);
  const cutoff = useSheetCutoff();
  const stints = config.source === 'stints';
  const laps = selectedLaps();
  const colors = causeColors(theme);
  const units = config.units ?? 'm';

  let rows: Row[] = [];
  if (stints) {
    // One average lap per stint that has the reference or a comparison lap selected (the reference's stint
    // first): its complete laps, minus the ones over the worksheet's 107% cut-off (judged across all open stints).
    const slow = slowLaps(sessionsWithSelection(sessions, lapSel), cutoff);
    const picked = laps.map((l) => l.session).filter((s, i, a) => a.indexOf(s) === i);
    rows = picked.flatMap((s) => {
      if (!hasWearChannels(s)) return [];
      const used = s.laps
        .filter((l) => l.complete && !slow.has(l))
        .flatMap((l) => {
          const w = lapParts(s, l);
          return w ? [{ l, w }] : [];
        });
      if (!used.length) return [];
      const avg = { car: empty(), FL: empty(), FR: empty(), RL: empty(), RR: empty() } as Parts;
      for (const { w } of used) for (const p of ['car', ...TYRES] as const) for (const k of KEYS) avg[p][k] += w[p][k] / used.length;
      const color = laps.find((l) => l.session.id === s.id)?.color;
      return [
        {
          key: s.id,
          w: avg,
          title: `${s.fileName}\nLaps averaged: ${used.map((u) => u.l.number).join(', ')} (complete laps${cutoff != null ? `, minus those over ${cutoff}% of the fastest — the worksheet's filter` : '; the 107% filter is off'})`,
          short: (
            <>
              {color && <span className="legend-swatch" style={{ background: color }} />} {s.meta.driver || 'Stint'}
              <div className="muted wear-summary-sub">
                avg {used.length} lap{used.length > 1 ? 's' : ''}
              </div>
            </>
          ),
          label: (
            <>
              {color && <span className="legend-swatch" style={{ background: color }} />} {s.meta.driver || 'Stint'}
              <div className="muted wear-summary-sub">
                {formatDateTime(s.meta.savedAt)} · avg of {used.length} lap{used.length > 1 ? 's' : ''}
                {cutoff != null ? ` ≤ ${cutoff}%` : ''}
              </div>
            </>
          ),
        },
      ];
    });
    if (!rows.length)
      return (
        <div className="empty-state">
          {picked.length ? 'No complete laps with tyre slip data in the selected stints.' : 'Select a reference lap (and comparison laps) to see their stints’ average laps.'}
        </div>
      );
  } else {
    const ref = laps[0];
    if (!ref) return <div className="empty-state">Select a lap to see its tyre wear.</div>;
    if (ref.lap.index === -1) return <div className="empty-state">Pick a single lap as the reference (not the whole session).</div>;
    if (!hasWearChannels(ref.session)) return <div className="empty-state">No tyre slip data (ndSlip / Tire Load) in this session.</div>;
    rows = laps.slice(0, 1 + (config.maxCompare ?? 3)).flatMap((l, i) => {
      const f = lapFourWear(l);
      if (!f) return [];
      return [
        {
          key: l.key,
          w: withCar(f.wear),
          title: `${lapLabel(l.lap)}${i === 0 ? ' (reference)' : ''}`,
          short: (
            <>
              <span className="legend-swatch" style={{ background: l.color }} /> {lapLabel(l.lap)}
            </>
          ),
          label: (
            <>
              <span className="legend-swatch" style={{ background: l.color }} /> {lapLabel(l.lap)}
              <span className="muted"> {i === 0 ? 'ref' : 'vs ref'}</span>
            </>
          ),
        },
      ];
    });
    if (rows[0]?.key !== ref.key) return <div className="empty-state">No tyre slip data for the reference lap.</div>;
  }

  const base = rows[0].w;
  const diff = (v: number, r: number) => {
    if (units === 'pct') {
      const p = pctDelta(v, r);
      return Number.isFinite(p) ? `${formatDelta(p, 1)}%` : '—';
    }
    return `${formatDelta(v - r, 0)} m`;
  };
  const what = stints ? 'Other stints: difference from the first stint' : 'Comparison laps: difference from the reference';
  const perTyre = config.perTyre === true;
  const toggle = (
    <div className="seg small" title={`${what} in metres, or as %`}>
      <button className={units === 'm' ? 'on' : ''} onClick={() => updateComponent(config.id, { units: 'm' }, 'Wear summary in metres')}>
        m
      </button>
      <button className={units === 'pct' ? 'on' : ''} onClick={() => updateComponent(config.id, { units: 'pct' }, 'Wear summary in %')}>
        %
      </button>
    </div>
  );

  /** One table: a row per lap / stint, for the whole car or one tyre. */
  const table = (part: 'car' | Tyre, corner: React.ReactNode) => {
    // The causes first, then the total on the far right (outlined, so it stands out).
    const cols = [
      ...WEAR_CAUSES.map((c) => ({ key: c.key, label: perTyre ? { lock: 'Lock', spin: 'Spin', slide: 'Slide' }[c.key] : c.label, color: colors[c.key] })),
      { key: 'total' as const, label: part === 'car' ? 'All four tyres' : 'Total', color: undefined },
    ];
    const totalCls = (k: string) => (k === 'total' ? ' wear-summary-total' : '');
    const b = base[part];
    return (
      <table className={'grid wear-summary-table' + (perTyre ? ' compact' : '')}>
        <thead>
          <tr>
            <th className="l" title={stints ? 'Average lap of each selected stint' : 'Whole lap'}>
              {corner}
            </th>
            {cols.map((c) => (
              <th key={c.key} className={totalCls(c.key)} style={c.color ? { color: c.color } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} title={r.title}>
              <td className="l">{perTyre ? r.short : r.label}</td>
              {cols.map((c) => {
                const v = r.w[part][c.key];
                return i === 0 ? (
                  <td key={c.key} className={'num wear-summary-value' + totalCls(c.key)}>
                    {formatValue(v, 0)} m
                  </td>
                ) : (
                  <td
                    key={c.key}
                    className={'num wear-summary-value' + totalCls(c.key)}
                    title={`${formatValue(v, 0)} m`}
                    style={{ color: Math.abs(v - b[c.key]) < 0.5 ? undefined : v > b[c.key] ? 'var(--loss)' : 'var(--gain)' }}
                  >
                    {diff(v, b[c.key])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  if (!perTyre) return <div className="html-panel wear-summary">{table('car', toggle)}</div>;
  return (
    <div className="html-panel wear-summary">
      <div className="wear-summary-tyres">
        {TYRES.map((t, i) => (
          <div key={t} className="wear-summary-tyre">
            {table(
              t,
              <span className="wear-summary-tyre-name">
                {t}
                {i === 0 && toggle}
              </span>,
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
