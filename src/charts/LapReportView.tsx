// Stint report (every lap of every open session) and Lap report (only the selected laps): lap and
// sector (or custom section) times. Bests are shown as a cell background: green = the best in that
// session (stint), purple = the best of every lap currently open at this track.
// Click = make reference, Ctrl/⌘+click = toggle overlay.

import { useMemo } from 'react';
import { formatDelta, formatLapTime, formatValue, prettyTrack } from '../core/format';
import { fastestLap, segmentTimes, theoreticalBest } from '../core/session';
import { rangeStats } from '../core/stats';
import { lapKey, type Lap, type Session } from '../core/types';
import { convertUnit } from '../core/units';
import { selectLap, selectedLaps, trackProfile, updateComponent, useStore } from '../state/store';
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
              ? ['Start', ...sections.map((x) => x.name)]
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

  if (!sessions.length) return <div className="empty-state">Open a session to see lap times.</div>;
  if (onlySelected && !selected.length) return <div className="empty-state">Select a lap to see its times.</div>;

  const refRow = (() => {
    for (const t of tables) for (const r of t.rows) if (r.key === refKey) return r;
    return undefined;
  })();
  const shown = tables
    .map((t) => ({ ...t, rows: onlySelected ? t.rows.filter((r) => lapColors.has(r.key)) : t.rows }))
    .filter((t) => t.rows.length);
  // Lap report: reference first, then comparisons in selection order.
  if (onlySelected) {
    const order = new Map(selected.map((l, i) => [l.key, i]));
    for (const t of shown) t.rows.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  }

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
        <span className="grow" />
        <span className="muted" style={{ fontSize: 11 }}>
          <span className="legend-chip pb" /> stint best <span className="legend-chip best" /> best of all open laps
        </span>
      </div>
      {shown.map(({ s, splitNames, rows, best, fl, ideal, overallLap, overallSplits }) => (
        <div key={s.id}>
          {sessions.length > 1 && (
            <div className="section-title">
              {prettyTrack(s.meta.venue).track} · {new Date(s.meta.savedAt ?? 0).toLocaleString()}
            </div>
          )}
          {config.split === 'sections' && !splitNames.length && (
            <div className="muted" style={{ padding: '8px 12px', fontSize: 12 }}>
              No custom sections yet — right-click a graph or the track map and choose “Add split at cursor”.
            </div>
          )}
          <table className="grid">
            <thead>
              <tr>
                <th className="l" style={{ width: 22 }}></th>
                <th className="l">Lap</th>
                <th>Time</th>
                {show.delta && <th>{onlySelected ? 'Δ ref' : 'Δ best'}</th>}
                {show.splits && splitNames.map((n) => <th key={n}>{n}</th>)}
                {config.showStats && <th>V max</th>}
                {config.showStats && s.key.fuel && <th>Fuel</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lap, key, splits, vmax, fuel }) => {
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
                  <tr
                    key={lap.index}
                    className={'click' + (sel ? ' sel' : '')}
                    onClick={(e) => selectLap(key, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'reference' : 'replace')}
                  >
                    <td className="l">{sel && <span className="swatch" style={{ background: lapColors.get(key), outline: key === refKey ? '2px solid var(--text)' : undefined }} />}</td>
                    <td className="l">
                      {lap.number}{' '}
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
                        return (
                          <td key={i} className={'num' + (lap.invalid ? '' : bestClass(v, best[i], overallSplits[i]))}>
                            {valid(v) ? formatLapTime(v) : <span className="muted">—</span>}
                          </td>
                        );
                      })}
                    {config.showStats && <td className="num">{formatValue(vmax, 1)}</td>}
                    {config.showStats && s.key.fuel && <td className="num">{formatValue(fuel, 2)}</td>}
                  </tr>
                );
              })}
              {show.ideal && ideal && (
                <tr className="sub">
                  <td></td>
                  <td className="l">Ideal</td>
                  <td className="num">{formatLapTime(ideal.time)}</td>
                  {show.delta && <td className="num">{fl ? formatDelta(ideal.time - fl.time) : ''}</td>}
                  {show.splits &&
                    splitNames.map((_, i) => (
                      <td key={i} className="num">
                        {formatLapTime(ideal.sectors[i])}
                      </td>
                    ))}
                  {config.showStats && <td></td>}
                  {config.showStats && s.key.fuel && <td></td>}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
