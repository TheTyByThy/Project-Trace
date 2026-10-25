// Time breakdown: the whole lap split into four buckets — low, medium and high-speed corners, and the
// straights — with the time each comparison lap gains or loses against the reference in each. Corners
// are the track's own (track profile), ranged and bucketed by the corner settings; the buckets add up to
// the whole lap.

import { BUCKETS, bucketTimes, lapBuckets, type Bucket } from '../core/corners';
import { lapHeaderTint, lapTint } from '../core/colors';
import { formatDelta, formatLapTime } from '../core/format';
import { lapLabel } from '../core/session';
import { selectedLaps, trackProfile, useStore } from '../state/store';
import type { BreakdownConfig } from '../state/workspace';
import { openTrackEditor } from '../ui/TrackProfileEditor';

/** A diverging bar: gains grow left in green, losses right in red, scaled to the biggest |Δ| shown. */
function DeltaBar({ d, max }: { d: number; max: number }) {
  const f = Number.isFinite(d) && max > 0 ? Math.min(1, Math.abs(d) / max) : 0;
  return (
    <span className="delta-bar" title={formatDelta(d, 3) + ' s'}>
      <span className="mid" />
      {f > 0 && <span className={d < 0 ? 'gain' : 'loss'} style={{ width: `${f * 50}%` }} />}
    </span>
  );
}

export function TimeBreakdownView({ config }: { config: BreakdownConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  useStore((s) => s.settings.trackProfiles);
  const cornerSettings = useStore((s) => s.settings.corners);
  const laps = selectedLaps();
  const ref = laps[0];
  if (!ref) return <div className="empty-state">Select a lap to see where time is gained and lost.</div>;
  if (ref.lap.index === -1) return <div className="empty-state">Pick a single lap as the reference (not the whole session).</div>;
  const corners = trackProfile(ref.session.meta.venue).corners;
  if (!corners.length)
    return (
      <div className="empty-state" style={{ maxWidth: 420 }}>
        <b>No corners defined for this track yet</b>
        <div style={{ margin: '8px 0 12px', lineHeight: 1.6 }}>
          The breakdown splits the lap at your corners. Put the cursor on an apex and right-click a graph or the track map → <b>Add corner at cursor…</b>, or
          use the Corner Report's <b>Suggest from speed minima</b>.
        </div>
        <button className="btn" onClick={openTrackEditor}>
          Open the track editor
        </button>
      </div>
    );

  const segs = lapBuckets({ session: ref.session, lap: ref.lap, settings: cornerSettings }, corners);
  const times = laps.map((l) => bucketTimes(l.session, l.lap, segs));
  const rows = BUCKETS.map((b) => ({ ...b, count: segs.filter((g) => g.bucket === b.key).length })).filter((r) => r.count);
  const sum = (t: Record<Bucket, number>) => rows.reduce((a, r) => a + t[r.key], 0);
  const cmp = laps.slice(1);
  const deltas = cmp.map((_, ci) => Object.fromEntries(rows.map((r) => [r.key, times[ci + 1][r.key] - times[0][r.key]])) as Record<Bucket, number>);
  const maxAbs = Math.max(0.001, ...deltas.flatMap((d) => rows.map((r) => Math.abs(d[r.key])).filter(Number.isFinite)));
  const showBars = config.showBars !== false;

  // One-line summary for the first comparison lap: where most time goes.
  let summary = '';
  if (deltas[0]) {
    const worst = rows.map((r) => ({ r, d: deltas[0][r.key] })).filter((x) => Number.isFinite(x.d)).sort((a, b) => b.d - a.d)[0];
    const best = rows.map((r) => ({ r, d: deltas[0][r.key] })).filter((x) => Number.isFinite(x.d)).sort((a, b) => a.d - b.d)[0];
    const parts: string[] = [];
    if (worst && worst.d > 0.005) parts.push(`most time lost in ${worst.r.label.toLowerCase()} (${formatDelta(worst.d, 2)} s)`);
    if (best && best.d < -0.005) parts.push(`most gained in ${best.r.label.toLowerCase()} (${formatDelta(best.d, 2)} s)`);
    if (parts.length) summary = `${lapLabel(cmp[0].lap)} vs reference: ${parts.join('; ')}.`;
  }

  return (
    <div className="html-panel">
      <div className="subtabs">
        <span className="muted" style={{ fontSize: 12 }}>
          Time per bucket · ref {lapLabel(ref.lap)}
        </span>
        <span className="grow" />
        <button className="btn small" onClick={openTrackEditor} title="Track editor: corners, their ranges and speed buckets, detection settings, splits">
          Edit corners & buckets
        </button>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th className="l">Section</th>
            <th style={{ background: lapHeaderTint(ref.color), color: 'var(--text)' }}>L{ref.lap.number} (ref)</th>
            {cmp.map((l) => (
              <th key={l.key} colSpan={showBars ? 2 : 1} style={{ background: lapHeaderTint(l.color), color: 'var(--text)' }}>
                L{l.lap.number} Δ
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="l">
                <span className={'bucket-chip ' + r.key}>{r.short}</span>
                {r.label} <span className="muted">({r.count})</span>
              </td>
              <td className="num" style={{ background: lapTint(ref.color) }}>
                {config.showTimes === false ? '' : formatLapTime(times[0][r.key])}
              </td>
              {cmp.map((l, ci) => {
                const d = deltas[ci][r.key];
                return [
                  <td key={l.key} className="num" style={{ background: lapTint(l.color), color: !Number.isFinite(d) ? undefined : d < 0 ? 'var(--gain)' : d > 0 ? 'var(--loss)' : undefined }}>
                    {formatDelta(d, 3)}
                  </td>,
                  showBars && (
                    <td key={l.key + 'bar'} style={{ background: lapTint(l.color), width: 110 }}>
                      <DeltaBar d={d} max={maxAbs} />
                    </td>
                  ),
                ];
              })}
            </tr>
          ))}
          <tr className="sub">
            <td className="l">
              <b>Whole lap</b>
            </td>
            <td className="num" style={{ background: lapTint(ref.color) }}>
              {formatLapTime(sum(times[0]))}
            </td>
            {cmp.map((l, ci) => {
              const d = sum(times[ci + 1]) - sum(times[0]);
              return [
                <td key={l.key} className="num" style={{ background: lapTint(l.color), fontWeight: 700, color: !Number.isFinite(d) ? undefined : d < 0 ? 'var(--gain)' : d > 0 ? 'var(--loss)' : undefined }}>
                  {formatDelta(d, 3)}
                </td>,
                showBars && <td key={l.key + 'bar'} style={{ background: lapTint(l.color) }} />,
              ];
            })}
          </tr>
        </tbody>
      </table>
      <div className="muted" style={{ padding: '8px 12px', fontSize: 12, lineHeight: 1.5 }}>
        {cmp.length
          ? summary || 'Negative (green) = the comparison lap is faster there; positive (red) = slower.'
          : 'Select a comparison lap (Ctrl/⌘ + click in the sidebar) to see where it gains or loses time against the reference.'}
      </div>
    </div>
  );
}
