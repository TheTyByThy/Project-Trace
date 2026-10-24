// Corner report: the corners you have defined for this track (saved in its track profile), with
// per-lap minimum / entry / exit speed or time through the corner. Click a corner to zoom to it.

import { cornerMetrics, cornerWindows, suggestCorners, type CornerLapMetrics } from '../core/corners';
import { xToTime } from '../core/axis';
import { formatValue } from '../core/format';
import { lapDistAt, lapLabel } from '../core/session';
import { convertUnit } from '../core/units';
import { openMenu, promptText } from '../ui/overlays';
import { selectedLaps, setCursor, setTrackProfile, setUi, setXMode, setZoom, trackProfile, updateComponent, useStore } from '../state/store';
import type { CornersConfig } from '../state/workspace';

const METRICS: { key: CornersConfig['metric']; label: string; higherIsBetter: boolean; time?: boolean }[] = [
  { key: 'minSpeed', label: 'Min speed', higherIsBetter: true },
  { key: 'entrySpeed', label: 'Entry speed', higherIsBetter: true },
  { key: 'exitSpeed', label: 'Exit speed', higherIsBetter: true },
  { key: 'time', label: 'Time in corner', higherIsBetter: false, time: true },
];

export function CornerReportView({ config }: { config: CornersConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  const speedUnit = useStore((s) => s.settings.units.speed);
  useStore((s) => s.settings.trackProfiles);
  const laps = selectedLaps();
  const ref = laps[0];
  if (!ref) return <div className="empty-state">Select a lap to see corner statistics.</div>;
  const venue = ref.session.meta.venue;
  const prof = trackProfile(venue);
  const windows = cornerWindows(prof.corners, ref.session.trackLength);

  if (!windows.length)
    return (
      <div className="empty-state" style={{ maxWidth: 420 }}>
        <b>No corners defined for this track yet</b>
        <div style={{ margin: '8px 0 12px', lineHeight: 1.6 }}>
          Put the cursor on a corner's apex (click a graph or the track map), then right-click the graph or map and choose <b>Add corner at cursor…</b>. Corners
          are saved to the track, so you only do this once.
        </div>
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setUi({ trackProfile: true })}>
            Open track profile editor
          </button>
          {ref.lap.index !== -1 && (
            <button
              className="btn ghost"
              title="Proposes corners at speed minima of the reference lap — you can rename or delete them afterwards"
              onClick={() => setTrackProfile(venue, { corners: suggestCorners(ref.session, ref.lap) }, 'Suggest corners')}
            >
              Suggest from speed minima
            </button>
          )}
        </div>
      </div>
    );

  const metric = METRICS.find((m) => m.key === config.metric) ?? METRICS[0];
  const sc = convertUnit('kph', speedUnit) ?? { k: 1, b: 0 };
  const value = (m: CornerLapMetrics | null) => (m ? (metric.time ? m.time : m[metric.key as 'minSpeed'] * sc.k + sc.b) : NaN);
  const corners = prof.corners.slice().sort((a, b) => a.dist - b.dist);

  const cornerMenu = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const c = corners[idx];
    const st = useStore.getState();
    openMenu(e, [
      { header: c.name },
      {
        label: 'Rename…',
        onClick: async () => {
          const n = await promptText(`Rename ${c.name}`, c.name);
          if (n) setTrackProfile(venue, { corners: corners.map((x, i) => (i === idx ? { ...x, name: n } : x)) }, 'Rename corner');
        },
      },
      {
        label: 'Move to cursor',
        disabled: st.cursor == null || ref.lap.index === -1,
        onClick: () => {
          const d = Math.round(lapDistAt(ref.lap, xToTime(ref.lap, st.cursor!, st.xMode)));
          setTrackProfile(venue, { corners: corners.map((x, i) => (i === idx ? { ...x, dist: d } : x)).sort((a, b) => a.dist - b.dist) }, 'Move corner');
        },
      },
      { label: 'Delete corner', onClick: () => setTrackProfile(venue, { corners: corners.filter((_, i) => i !== idx) }, 'Delete corner') },
      { separator: true },
      { label: 'Edit all corners…', onClick: () => setUi({ trackProfile: true }) },
    ]);
  };

  return (
    <div className="html-panel">
      <div className="subtabs">
        <div className="seg">
          {METRICS.map((m) => (
            <button key={m.key} className={config.metric === m.key ? 'on' : ''} onClick={() => updateComponent(config.id, { metric: m.key })}>
              {m.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="muted" style={{ fontSize: 11 }}>
          {metric.time ? 's' : speedUnit} · ref {lapLabel(ref.lap)} · right-click a corner to edit
        </span>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th className="l">Corner</th>
            <th>At</th>
            {laps.map((l, i) => (
              <th key={l.key} style={{ borderLeft: `3px solid ${l.color}` }}>
                L{l.lap.number}
                {i === 0 ? ' (ref)' : ''}
              </th>
            ))}
            {laps.length > 1 && <th>Δ best−ref</th>}
          </tr>
        </thead>
        <tbody>
          {windows.map((w, idx) => {
            const vals = laps.map((l) => value(cornerMetrics(l.session, l.lap, w)));
            const refV = vals[0];
            const others = vals.slice(1).filter(Number.isFinite);
            const bestOther = others.length ? (metric.higherIsBetter ? Math.max(...others) : Math.min(...others)) : NaN;
            return (
              <tr
                key={w.name + w.apex}
                className="click"
                onClick={() => {
                  setXMode('distance');
                  setZoom([w.entry - 40, w.exit + 40]);
                  setCursor(w.apex);
                }}
                onContextMenu={(e) => cornerMenu(e, idx)}
              >
                <td className="l">
                  <b>{w.name}</b>
                </td>
                <td className="num muted">{w.apex.toFixed(0)} m</td>
                {vals.map((v, i) => {
                  const d = i === 0 ? 0 : v - refV;
                  const better = metric.higherIsBetter ? d > 0 : d < 0;
                  return (
                    <td key={i} className="num">
                      {formatValue(v, metric.time ? 2 : 1)}
                      {i > 0 && Number.isFinite(d) && Math.abs(d) > (metric.time ? 0.005 : 0.05) && (
                        <span style={{ color: better ? 'var(--gain)' : 'var(--loss)', marginLeft: 6, fontSize: 11 }}>
                          {d > 0 ? '+' : '−'}
                          {Math.abs(d).toFixed(metric.time ? 2 : 1)}
                        </span>
                      )}
                    </td>
                  );
                })}
                {laps.length > 1 && <td className="num muted">{Number.isFinite(bestOther - refV) ? (bestOther - refV).toFixed(metric.time ? 2 : 1) : '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
