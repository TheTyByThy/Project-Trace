// Corner report: corners auto-detected on the reference lap, with per-lap minimum / entry / exit
// speed or time through the corner. Click a corner to zoom the graphs to it.

import { useMemo } from 'react';
import { cornerMetrics, detectCorners, type CornerLapMetrics } from '../core/corners';
import { formatValue } from '../core/format';
import { lapLabel } from '../core/session';
import { convertUnit } from '../core/units';
import { promptText } from '../ui/overlays';
import { selectedLaps, setCursor, setTrackProfile, setXMode, setZoom, trackProfile, updateComponent, useStore } from '../state/store';
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
  const dataVersion = useStore((s) => s.dataVersion);
  const speedUnit = useStore((s) => s.settings.units.speed);
  useStore((s) => s.settings.trackProfiles);
  const laps = selectedLaps();
  const ref = laps[0];
  const corners = useMemo(() => (ref && ref.lap.index !== -1 ? detectCorners(ref.session, ref.lap) : []), [ref?.key, dataVersion]);
  if (!ref) return <div className="empty-state">Select a lap to detect corners.</div>;
  if (!corners.length) return <div className="empty-state">No corners detected (needs a speed channel and a full lap).</div>;
  const metric = METRICS.find((m) => m.key === config.metric) ?? METRICS[0];
  const sc = convertUnit('kph', speedUnit) ?? { k: 1, b: 0 };
  const names = trackProfile(ref.session.meta.venue).cornerNames;
  const value = (m: CornerLapMetrics | null) => (m ? (metric.time ? m.time : m[metric.key as 'minSpeed'] * sc.k + sc.b) : NaN);

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
          {metric.time ? 's' : speedUnit} · detected on ref {lapLabel(ref.lap)} · double-click a name to rename
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
          {corners.map((c) => {
            const vals = laps.map((l) => value(cornerMetrics(l.session, l.lap, c)));
            const refV = vals[0];
            const others = vals.slice(1).filter(Number.isFinite);
            const bestOther = others.length ? (metric.higherIsBetter ? Math.max(...others) : Math.min(...others)) : NaN;
            return (
              <tr
                key={c.name}
                className="click"
                onClick={() => {
                  setXMode('distance');
                  setZoom([c.entry - 60, c.exit + 60]);
                  setCursor(c.apex);
                }}
              >
                <td
                  className="l"
                  onDoubleClick={async (e) => {
                    e.stopPropagation();
                    const n = await promptText(`Rename ${c.name}`, names[c.name] ?? c.name);
                    if (n != null) setTrackProfile(ref.session.meta.venue, { cornerNames: { ...names, [c.name]: n } });
                  }}
                >
                  <b>{names[c.name] || c.name}</b>
                </td>
                <td className="num muted">{c.apex.toFixed(0)} m</td>
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
