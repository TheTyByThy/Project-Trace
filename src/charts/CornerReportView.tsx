// Corner report: the corners you have defined for this track (saved in its track profile) and the
// straights between them, with per-lap minimum / entry / exit speed or time. Corner ranges come from the
// driving (lift / braking point to full throttle, padded by the corner settings) and each corner is
// bucketed as low / medium / high speed; the totals show the time in each bucket and on straights,
// with the gain/loss against the reference. Click a row to zoom to it.

import { BUCKETS, bucketSegments, cornerMetrics, cornerWindows, suggestCorners, trackSegments, type Bucket, type CornerLapMetrics, type TrackSegment } from '../core/corners';
import { openTrackEditor } from '../ui/TrackProfileEditor';
import { lapHeaderTint, lapTint } from '../core/colors';
import { formatLapTime, formatValue } from '../core/format';
import { lapLabel } from '../core/session';
import { convertUnit } from '../core/units';
import { selectedLaps, setCursor, setHighlight, setTrackProfile, setXMode, setZoom, trackProfile, updateComponent, useStore } from '../state/store';
import type { CornersConfig } from '../state/workspace';

/** Times of a minute or more as m:ss.ss (e.g. 1:41.40), shorter ones in seconds. */
const fmtTime = (v: number) => (Number.isFinite(v) && Math.abs(v) >= 60 ? formatLapTime(v, 2) : formatValue(v, 2));

const METRICS: { key: CornersConfig['metric']; label: string; higherIsBetter: boolean; time?: boolean }[] = [
  { key: 'time', label: 'Time in corner', higherIsBetter: false, time: true },
  { key: 'minSpeed', label: 'Min speed', higherIsBetter: true },
  { key: 'entrySpeed', label: 'Entry speed', higherIsBetter: true },
  { key: 'exitSpeed', label: 'Exit speed', higherIsBetter: true },
];

export function CornerReportView({ config }: { config: CornersConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  const speedUnit = useStore((s) => s.settings.units.speed);
  useStore((s) => s.settings.trackProfiles);
  const cornerSettings = useStore((s) => s.settings.corners);
  const laps = selectedLaps();
  const ref = laps[0];
  if (!ref) return <div className="empty-state">Select a lap to see corner statistics.</div>;
  const venue = ref.session.meta.venue;
  const prof = trackProfile(venue);
  const ctx = { session: ref.session, lap: ref.lap, settings: cornerSettings };
  const windows = cornerWindows(prof.corners, ref.session.trackLength, ctx);

  if (!windows.length)
    return (
      <div className="empty-state" style={{ maxWidth: 420 }}>
        <b>No corners defined for this track yet</b>
        <div style={{ margin: '8px 0 12px', lineHeight: 1.6 }}>
          Put the cursor on a corner's apex (click a graph or the track map), then right-click the graph or map and choose <b>Add corner at cursor…</b>. Corners
          are saved to the track, so you only do this once.
        </div>
        <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn" onClick={openTrackEditor}>
            Open the track editor
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
  const segments = bucketSegments(ctx, trackSegments(windows, ref.session.trackLength));
  const shownSegments = config.showStraights === false ? segments.filter((g) => g.kind === 'corner') : segments;
  // Metrics for every lap × segment (time feeds the totals).
  const metrics = new Map<TrackSegment, (CornerLapMetrics | null)[]>(segments.map((g) => [g, laps.map((l) => cornerMetrics(l.session, l.lap, g))]));
  // Time per bucket (low / medium / high-speed corners, straights) for each lap; they add up to the lap.
  const totals = (b: Bucket) => laps.map((_, li) => segments.filter((g) => g.bucket === b).reduce((acc, g) => acc + (metrics.get(g)![li]?.time ?? NaN), 0));
  const totalRows = BUCKETS.map((b) => ({ ...b, count: segments.filter((g) => g.bucket === b.key).length, vals: totals(b.key) })).filter((r) => r.count);
  const lapTotal = laps.map((_, li) => totalRows.reduce((acc, r) => acc + r.vals[li], 0));

  const deltaSpan = (d: number, better: boolean, dps: number) => (
    <span style={{ color: better ? 'var(--gain)' : 'var(--loss)', marginLeft: 6, fontSize: 11 }}>
      {d > 0 ? '+' : '−'}
      {Math.abs(d).toFixed(dps)}
    </span>
  );

  return (
    <div className="html-panel">
      <div className="subtabs nowrap">
        <div className="seg">
          {METRICS.map((m) => (
            <button key={m.key} className={config.metric === m.key ? 'on' : ''} onClick={() => updateComponent(config.id, { metric: m.key })}>
              {m.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="muted shrink" style={{ fontSize: 11 }} title="Click a row to zoom to it; hover to highlight it on the track map">
          {metric.time ? 's' : speedUnit} · ref {lapLabel(ref.lap)} · click a row to zoom to it
        </span>
        <button
          className={'btn small' + (config.showStraights !== false ? ' active' : '')}
          onClick={() => updateComponent(config.id, { showStraights: config.showStraights === false }, 'Show straights')}
          title="Show or hide the straights between corners in the table (totals still count them)"
        >
          Straights
        </button>
      </div>
      {config.showTotals !== false && (
        <table className="grid">
          <thead>
            <tr>
              <th className="l">Total time</th>
              {laps.map((l, i) => (
                <th key={l.key} style={{ background: lapHeaderTint(l.color), color: 'var(--text)' }}>
                  L{l.lap.number}
                  {i === 0 ? ' (ref)' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...totalRows.map((r) => ({ key: r.key as string, label: `${r.label} (${r.count})`, vals: r.vals, bucket: r.key as Bucket | null })), { key: 'lap', label: 'Whole lap', vals: lapTotal, bucket: null }].map(({ key, label, vals, bucket }) => (
              <tr key={key} className={bucket ? '' : 'sub'}>
                <td className="l">
                  {bucket && <span className={'bucket-chip ' + bucket}>{BUCKETS.find((b) => b.key === bucket)!.short}</span>}
                  <b>{label}</b>
                </td>
                {vals.map((v, i) => {
                  const d = v - vals[0];
                  return (
                    <td key={i} className="num" style={{ background: lapTint(laps[i].color) }}>
                      {fmtTime(v)}
                      {i > 0 && Number.isFinite(d) && Math.abs(d) > 0.005 && deltaSpan(d, d < 0, 2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="grid">
        <thead>
          <tr>
            <th className="l">{config.showStraights === false ? 'Corner' : 'Corner / straight'}</th>
            <th>Range</th>
            {laps.map((l, i) => (
              <th key={l.key} style={{ background: lapHeaderTint(l.color), color: 'var(--text)' }}>
                L{l.lap.number}
                {i === 0 ? ' (ref)' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shownSegments.map((g) => {
            const vals = metrics.get(g)!.map(value);
            const refV = vals[0];
            const straight = g.kind === 'straight';
            return (
              <tr
                key={g.kind + g.name + g.entry}
                className="click"
                style={straight ? { color: 'var(--text-2)' } : undefined}
                onClick={() => {
                  setXMode('distance');
                  setZoom([g.entry - 40, g.exit + 40]);
                  setCursor(g.apex);
                }}
                onMouseEnter={() => setHighlight({ entry: g.entry, exit: g.exit })}
                onMouseLeave={() => setHighlight(null)}
              >
                <td className="l">
                  {!straight && (
                    <span className={'bucket-chip ' + g.bucket} title={`${BUCKETS.find((b) => b.key === g.bucket)!.label}${g.overridden ? ' (set by you in the track editor)' : ''} — min ${formatValue(g.refMinSpeed * sc.k + sc.b, 0)} ${speedUnit} on the reference`}>
                      {BUCKETS.find((b) => b.key === g.bucket)!.short}
                    </span>
                  )}
                  {straight ? <i>{g.name}</i> : <b>{g.name}</b>}
                </td>
                <td className="num muted">
                  {g.entry.toFixed(0)}–{g.exit.toFixed(0)} m
                </td>
                {vals.map((v, i) => {
                  const d = i === 0 ? 0 : v - refV;
                  const better = metric.higherIsBetter ? d > 0 : d < 0;
                  return (
                    <td key={i} className="num" style={{ background: lapTint(laps[i].color) }}>
                      {metric.time ? fmtTime(v) : formatValue(v, 1)}
                      {i > 0 && Number.isFinite(d) && Math.abs(d) > (metric.time ? 0.005 : 0.05) && deltaSpan(d, better, metric.time ? 2 : 1)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
