// Lap report: lap and sector (or custom section) times for every loaded session.
// Purple = best in session. Click = make reference, Ctrl/⌘+click = toggle overlay.

import { useMemo } from 'react';
import { formatDelta, formatLapTime, formatValue, prettyTrack } from '../core/format';
import { fastestLap, segmentTimes, theoreticalBest } from '../core/session';
import { rangeStats } from '../core/stats';
import { lapKey, type Lap, type Session } from '../core/types';
import { convertUnit } from '../core/units';
import { selectLap, trackProfile, updateComponent, useStore } from '../state/store';
import type { LapReportConfig } from '../state/workspace';
import { lapColor } from '../core/colors';

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

export function LapReportView({ config }: { config: LapReportConfig }) {
  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const theme = useStore((s) => s.settings.theme);
  const speedUnit = useStore((s) => s.settings.units.speed);
  const profiles = useStore((s) => s.settings.trackProfiles);
  const dataVersion = useStore((s) => s.dataVersion);

  const tables = useMemo(
    () =>
      sessions.map((s) => {
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
          return { lap, splits, ...lapExtras(s, lap) };
        });
        const best = splitNames.map((_, i) => {
          let b = Infinity;
          for (const r of rows) {
            const v = r.splits[i];
            if (!r.lap.invalid && Number.isFinite(v) && v > 0 && v < b) b = v;
          }
          return b;
        });
        const fl = fastestLap(s);
        const ideal = config.split === 'sectors' ? theoreticalBest(s) : best.every(Number.isFinite) && best.length ? { time: best.reduce((a, b) => a + b, 0), sectors: best } : null;
        return { s, splitNames, rows, best, fl, ideal };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, config.split, profiles, dataVersion, speedUnit],
  );

  if (!sessions.length) return <div className="empty-state">Open a session to see lap times.</div>;

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
          click = reference · Ctrl/⌘+click = overlay
        </span>
      </div>
      {tables.map(({ s, splitNames, rows, best, fl, ideal }) => (
        <div key={s.id}>
          {sessions.length > 1 && (
            <div className="section-title">
              {prettyTrack(s.meta.venue).track} · {new Date(s.meta.savedAt ?? 0).toLocaleString()}
            </div>
          )}
          {config.split === 'sections' && !splitNames.length && (
            <div className="muted" style={{ padding: '8px 12px', fontSize: 12 }}>
              No custom sections yet — right-click the track map and choose “Add section split at cursor”.
            </div>
          )}
          <table className="grid">
            <thead>
              <tr>
                <th className="l" style={{ width: 22 }}></th>
                <th className="l">Lap</th>
                <th>Time</th>
                <th>Δ best</th>
                {splitNames.map((n) => (
                  <th key={n}>{n}</th>
                ))}
                {config.showStats && <th>V max</th>}
                {config.showStats && s.key.fuel && <th>Fuel</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lap, splits, vmax, fuel }) => {
                const key = lapKey({ sessionId: s.id, lapIndex: lap.index });
                const sel = lapSel.find((l) => l.key === key);
                const isBest = fl === lap;
                return (
                  <tr
                    key={lap.index}
                    className={'click' + (sel ? ' sel' : '')}
                    onClick={(e) => selectLap(key, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'reference' : 'replace')}
                  >
                    <td className="l">{sel && <span className="swatch" style={{ background: lapColor(sel.slot, theme), outline: key === refKey ? '2px solid var(--text)' : undefined }} />}</td>
                    <td className="l">
                      {lap.number}{' '}
                      {lap.kind === 'out' && <span className="tag">out</span>}
                      {lap.kind === 'in' && <span className="tag">in</span>}
                      {lap.kind === 'partial' && <span className="tag">partial</span>}
                      {lap.invalid && <span className="tag bad">invalid</span>}
                      {isBest && <span className="tag best">best</span>}
                    </td>
                    <td className={'num' + (isBest ? ' best' : '') + (lap.invalid ? ' bad' : '')}>{lap.complete ? formatLapTime(lap.time) : <span className="muted">{formatLapTime(lap.time)}</span>}</td>
                    <td className="num muted">{lap.complete && fl ? (isBest ? '' : formatDelta(lap.time - fl.time)) : ''}</td>
                    {splitNames.map((_, i) => {
                      const v = splits[i];
                      const b = Number.isFinite(v) && Math.abs(v - best[i]) < 1e-6;
                      return (
                        <td key={i} className={'num' + (b ? ' best' : '')}>
                          {Number.isFinite(v) && v > 0 ? formatLapTime(v) : <span className="muted">—</span>}
                        </td>
                      );
                    })}
                    {config.showStats && <td className="num">{formatValue(vmax, 1)}</td>}
                    {config.showStats && s.key.fuel && <td className="num">{formatValue(fuel, 2)}</td>}
                  </tr>
                );
              })}
              {ideal && (
                <tr className="sub">
                  <td></td>
                  <td className="l">Ideal</td>
                  <td className="num">{formatLapTime(ideal.time)}</td>
                  <td className="num">{fl ? formatDelta(ideal.time - fl.time) : ''}</td>
                  {splitNames.map((_, i) => (
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
