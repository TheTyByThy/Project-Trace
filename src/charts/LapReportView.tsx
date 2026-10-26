// Stint report (every lap of every open session) and Lap report (only the selected laps): lap and
// sector (or custom section) times. Bests are shown as a cell background: green = the best in that
// session (stint), purple = the best of every lap currently open at this track.
// Click = make reference, Ctrl/⌘+click = toggle overlay.

import { Fragment, useMemo } from 'react';
import { lapTint } from '../core/colors';
import { formatDelta, formatLapTime, formatValue, prettyTrack } from '../core/format';
import { fastestLap, segmentTimes, theoreticalBest } from '../core/session';
import { rangeStats } from '../core/stats';
import { lapKey, type Lap, type Session } from '../core/types';
import { convertUnit } from '../core/units';
import { sectionNames, selectLap, selectedLaps, trackProfile, updateComponent, useStore } from '../state/store';
import type { LapReportConfig, SelectedLapReportConfig } from '../state/workspace';

function lapExtras(s: Session, lap: Lap) {
  let vmax = NaN;
  let fuel = NaN;
  if (s.key.speed) {
    const ch = s.channels.get(s.key.speed)!;
    const st = rangeStats(ch.data, Math.ceil((lap.start - ch.t0) * ch.rate), Math.floor((lap.end - ch.t0) * ch.rate));
    const c = convertUnit(ch.unit || 'kph', useStore.getState().settings.units.speed) ?? { k: 1, b: 0 };
    vmax = st.max * c.k + c.b;
  }
  if (s.key.fuel) {
    const ch = s.channels.get(s.key.fuel)!;
    const st = rangeStats(ch.data, Math.ceil((lap.start - ch.t0) * ch.rate), Math.floor((lap.end - ch.t0) * ch.rate));
    fuel = st.first - st.last;
  }
  return { vmax, fuel };
}

const EPS = 1e-6;
const valid = (v: number) => Number.isFinite(v) && v > 0;

/** CSS class for a time: purple when it is the best of all open laps, green when it is the session best. */
function bestClass(v: number, sessionBest: number, overallBest: number): string {
  if (!valid(v) || Math.abs(v - sessionBest) > EPS) return '';
  return Math.abs(v - overallBest) <= EPS ? ' best' : ' pb';
}

export function LapReportView({ config }: { config: LapReportConfig | SelectedLapReportConfig }) {
  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  useStore((s) => s.settings.theme);
  const selected = selectedLaps();
  const lapColors = new Map(selected.map((l) => [l.key, l.color]));
  const speedUnit = useStore((s) => s.settings.units.speed);
  const profiles = useStore((s) => s.settings.trackProfiles);
  const dataVersion = useStore((s) => s.dataVersion);
  const onlySelected = config.type === 'lapreport';
  const deltaMode = config.type === 'lapreport' && config.sectorMode === 'delta';
  const show = {
    delta: config.showDelta !== false,
    splits: config.showSplits !== false,
    ideal: config.showIdeal !== false && !onlySelected,
    tags: config.showTags !== false,
  };

  const tables = useMemo(
    () => {
      const out = sessions.map((s) => {
        const sections = trackProfile(s.meta.venue).sections;
        const splitNames =
          config.split === 'sectors'
            ? s.sectorSplits.length
              ? [...s.sectorSplits.map((_, i) => `S${i + 1}`), `S${s.sectorSplits.length + 1}`]
              : []
            : config.split === 'sections' && sections.length
              ? sectionNames(trackProfile(s.meta.venue))
              : [];
        const rows = s.laps.map((lap) => {
          const splits =
            config.split === 'sectors' ? lap.sectors : config.split === 'sections' && sections.length ? segmentTimes(s, lap, sections.map((x) => x.dist)) : [];
          return { lap, key: lapKey({ sessionId: s.id, lapIndex: lap.index }), splits, ...lapExtras(s, lap) };
        });
        const best = splitNames.map((_, i) => {
          let b = Infinity;
          for (const r of rows) {
            const v = r.splits[i];
            if (!r.lap.invalid && valid(v) && v < b) b = v;
          }
          return b;
        });
        const fl = fastestLap(s);
        const ideal = config.split === 'sectors' ? theoreticalBest(s) : best.every(Number.isFinite) && best.length ? { time: best.reduce((a, b) => a + b, 0), sectors: best } : null;
        return { s, splitNames, rows, best, fl, ideal, overallLap: Infinity, overallSplits: [] as number[] };
      });
      // Bests across every open session at the same track (splits only when the layouts match).
      for (const t of out) {
        const peers = out.filter((o) => o.s.meta.venue === t.s.meta.venue);
        t.overallLap = Math.min(...peers.map((o) => o.fl?.time ?? Infinity));
        t.overallSplits = t.best.map((b, i) => Math.min(b, ...peers.filter((o) => o.splitNames.length === t.splitNames.length).map((o) => o.best[i] ?? Infinity)));
      }
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, config.split, profiles, dataVersion, speedUnit],
  );

  type Table = (typeof tables)[number];
  if (!sessions.length) return <div className="empty-state">Open a session to see lap times.</div>;
  if (!selected.length) return <div className="empty-state">Select a lap to see {onlySelected ? 'its times' : 'its stint'}.</div>;

  const refRow = (() => {
    for (const t of tables) for (const r of t.rows) if (r.key === refKey) return r;
    return undefined;
  })();
  // Only stints with a selected lap are shown (the Lap Report further narrows to the selected laps).
  const shown = tables
    .filter((t) => t.rows.some((r) => lapColors.has(r.key)))
    .map((t) => ({ ...t, rows: onlySelected ? t.rows.filter((r) => lapColors.has(r.key)) : t.rows }));
  // Each row keeps its own stint, for its bests and session label.
  type Group = { id: string; title: string | null; splitNames: string[]; rows: (Table['rows'][number] & { t: Table })[]; t: Table | null };
  let groups: Group[];
  if (onlySelected) {
    // Lap report: one table of every selected lap — reference first, then comparisons in selection
    // order — whatever session they come from.
    const order = new Map(selected.map((l, i) => [l.key, i]));
    const rows = shown.flatMap((t) => t.rows.map((r) => ({ ...r, t }))).sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
    const refT = rows[0]?.t;
    const splitNames = refT ? refT.splitNames : [];
    groups = [{ id: 'selected', title: null, splitNames, rows, t: null }];
  } else
    groups = shown.map((t) => ({
      id: t.s.id,
      title: shown.length > 1 ? `${prettyTrack(t.s.meta.venue).track} · ${new Date(t.s.meta.savedAt ?? 0).toLocaleString()}` : null,
      splitNames: t.splitNames,
      rows: t.rows.map((r) => ({ ...r, t })),
      t,
    }));
  // Columns shared by every row: the widest set of splits, and fuel if any session logs it.
  const headSplits = groups.reduce<string[]>((a, g) => (g.splitNames.length > a.length ? g.splitNames : a), []);
  const hasFuel = groups.some((g) => g.rows.some((r) => r.t.s.key.fuel));
  const colCount = 3 + (show.delta ? 1 : 0) + (show.splits ? headSplits.length : 0) + (config.showStats ? 1 + (hasFuel ? 1 : 0) : 0);
  const multiSession = onlySelected && new Set(groups[0]?.rows.map((r) => r.t.s.id)).size > 1;

  return (
    <div className="html-panel">
      <div className="subtabs">
        <span className="muted" style={{ fontSize: 12 }}>
          Splits:
        </span>
        <div className="seg">
          {(['sectors', 'sections', 'none'] as const).map((k) => (
            <button key={k} className={config.split === k ? 'on' : ''} onClick={() => updateComponent(config.id, { split: k })}>
              {k === 'sectors' ? 'Game sectors' : k === 'sections' ? 'Custom sections' : 'None'}
            </button>
          ))}
        </div>
        {onlySelected && (
          <div className="seg" title="Comparison laps' sectors as absolute times or as the difference to the reference lap">
            <button className={!deltaMode ? 'on' : ''} onClick={() => updateComponent(config.id, { sectorMode: 'absolute' })}>
              Absolute
            </button>
            <button className={deltaMode ? 'on' : ''} onClick={() => updateComponent(config.id, { sectorMode: 'delta' })}>
              Δ to ref
            </button>
          </div>
        )}
        <span className="grow" />
        <span className="muted" style={{ fontSize: 11 }}>
          <span className="legend-chip pb" /> stint best <span className="legend-chip best" /> best of all open laps
        </span>
      </div>
      {config.split === 'sections' && !headSplits.length && (
        <div className="muted" style={{ padding: '8px 12px', fontSize: 12 }}>
          No custom sections yet — right-click a graph or the track map and choose “Add split at cursor”.
        </div>
      )}
      {/* One table for every session, so the columns always line up; sessions are titled rows. */}
      <table className="grid">
        <thead>
          <tr>
            <th className="l" style={{ width: 22 }}></th>
            <th className="l">Lap</th>
            <th>Time</th>
            {show.delta && <th>{onlySelected ? 'Δ ref' : 'Δ best'}</th>}
            {show.splits && headSplits.map((n, i) => <th key={i}>{n}</th>)}
            {config.showStats && <th>V max</th>}
            {config.showStats && hasFuel && <th>Fuel</th>}
          </tr>
        </thead>
        <tbody>
          {groups.map(({ id, title, rows, t: group }) => {
            const splitNames = headSplits;
            return (
              <Fragment key={id}>
                {title && (
                  <tr className="group-title">
                    <td colSpan={colCount}>{title}</td>
                  </tr>
                )}
                {rows.map(({ lap, key, splits, vmax, fuel, t }) => {
                  const { s, best, fl, overallLap, overallSplits } = t;
                  const sel = lapSel.find((l) => l.key === key);
                  const isBest = fl === lap;
                  const delta = onlySelected
                    ? refRow && key !== refKey && lap.complete && refRow.lap.complete
                      ? formatDelta(lap.time - refRow.lap.time)
                      : ''
                    : lap.complete && fl && !isBest
                      ? formatDelta(lap.time - fl.time)
                      : '';
                  return (
                    <tr key={key} className={'click' + (sel ? ' sel' : '')} onClick={(e) => selectLap(key, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'reference' : 'replace')}>
                      <td className="l">{sel && <span className="swatch" style={{ background: lapColors.get(key), outline: key === refKey ? '2px solid var(--text)' : undefined }} />}</td>
                      <td className="l" style={sel ? { background: lapTint(lapColors.get(key)!) } : undefined}>
                        {lap.number}{' '}
                        {multiSession && (
                          <span className="muted" style={{ fontSize: 11 }} title={s.fileName}>
                            {s.meta.driver || prettyTrack(s.meta.venue).track} · {new Date(s.meta.savedAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                          </span>
                        )}
                        {show.tags && lap.kind === 'out' && <span className="tag">out</span>}
                        {show.tags && lap.kind === 'in' && <span className="tag">in</span>}
                        {show.tags && lap.kind === 'partial' && <span className="tag">partial</span>}
                        {show.tags && lap.invalid && <span className="tag bad">invalid</span>}
                        {show.tags && onlySelected && key === refKey && <span className="tag">ref</span>}
                      </td>
                      <td className={'num' + (isBest && fl ? bestClass(lap.time, fl.time, overallLap) : '') + (lap.invalid ? ' bad' : '')}>
                        {lap.complete ? formatLapTime(lap.time) : <span className="muted">{formatLapTime(lap.time)}</span>}
                      </td>
                      {show.delta && <td className="num muted">{delta}</td>}
                      {show.splits &&
                        splitNames.map((_, i) => {
                          const v = splits[i];
                          if (deltaMode && refRow && key !== refKey) {
                            const d = v - refRow.splits[i];
                            return (
                              <td key={i} className="num" style={{ color: !Number.isFinite(d) ? undefined : d < 0 ? 'var(--gain)' : d > 0 ? 'var(--loss)' : undefined }}>
                                {valid(v) && valid(refRow.splits[i]) ? formatDelta(d) : <span className="muted">—</span>}
                              </td>
                            );
                          }
                          return (
                            <td key={i} className={'num' + (lap.invalid ? '' : bestClass(v, best[i], overallSplits[i]))}>
                              {valid(v) ? formatLapTime(v) : <span className="muted">—</span>}
                            </td>
                          );
                        })}
                      {config.showStats && <td className="num">{formatValue(vmax, 1)}</td>}
                      {config.showStats && hasFuel && <td className="num">{s.key.fuel ? formatValue(fuel, 2) : ''}</td>}
                    </tr>
                  );
                })}
                {show.ideal && group?.ideal && (
                  <tr className="sub">
                    <td></td>
                    <td className="l">Ideal</td>
                    <td className="num">{formatLapTime(group.ideal.time)}</td>
                    {show.delta && <td className="num">{group.fl ? formatDelta(group.ideal.time - group.fl.time) : ''}</td>}
                    {show.splits &&
                      splitNames.map((_, i) => (
                        <td key={i} className="num">
                          {formatLapTime(group.ideal!.sectors[i])}
                        </td>
                      ))}
                    {config.showStats && <td></td>}
                    {config.showStats && hasFuel && <td></td>}
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
