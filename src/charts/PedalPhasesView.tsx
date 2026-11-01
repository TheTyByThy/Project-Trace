// Pedal phases: where each selected lap's time goes — braking, full throttle, part throttle and rolling
// (neither pedal) — plus the time on the straights. One row per lap and a handful of columns, so several
// laps fit side by side on a laptop. Seconds or % of the lap; comparison laps absolute or as Δ to the ref.

import { lapBuckets, bucketTimes } from '../core/corners';
import { formatDelta, formatLapTime, formatValue } from '../core/format';
import { lapPhases, PHASES, type LapPhases, type Phase } from '../core/pedalPhases';
import { lapLabel } from '../core/session';
import { selectedLaps, trackProfile, updateComponent, useStore } from '../state/store';
import type { PedalPhasesConfig } from '../state/workspace';
import { LapsCompounds } from '../ui/CompoundBadge';
import { openTrackEditor } from '../ui/TrackProfileEditor';

interface Row {
  key: string;
  label: string;
  driver: string;
  color: string;
  s: ReturnType<typeof selectedLaps>[number]['session'];
  lap: ReturnType<typeof selectedLaps>[number]['lap'];
  time: number;
  p: LapPhases;
  /** Seconds on the straights between the reference lap's corners; NaN without corners. */
  straights: number;
}

export function PedalPhasesView({ config }: { config: PedalPhasesConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  useStore((s) => s.settings.trackProfiles);
  const cornerSettings = useStore((s) => s.settings.corners);
  const pct = config.units === 'pct';
  const delta = config.mode === 'delta';
  const laps = selectedLaps().filter((l) => l.lap.index !== -1);
  const ref = laps[0];
  if (!ref) return <div className="empty-state">Select a lap (and up to a few comparison laps) to see where each lap's time goes.</div>;

  const th = { brake: 2, full: cornerSettings.fullThrottle, pedal: 2 };
  // Straights: the reference lap's corner ranges, applied to every lap by distance (as the Time Breakdown does).
  const corners = trackProfile(ref.session.meta.venue).corners;
  const segs = corners.length ? lapBuckets({ session: ref.session, lap: ref.lap, settings: cornerSettings }, corners) : null;
  const rows: Row[] = laps.flatMap((l) => {
    const p = lapPhases(l.session, l.lap, th);
    if (!p) return [];
    return [
      {
        key: l.key,
        label: lapLabel(l.lap),
        driver: l.session.meta.driver || '',
        color: l.color,
        s: l.session,
        lap: l.lap,
        time: p.total,
        p,
        straights: segs ? bucketTimes(l.session, l.lap, segs).straight : NaN,
      },
    ];
  });
  if (!rows.length) return <div className="empty-state">No throttle and brake channels (Throttle Pos / Brake Pos) in the selected laps.</div>;
  const refRow = rows[0].key === ref.key ? rows[0] : null;
  const multiDriver = new Set(rows.map((r) => r.s.id)).size > 1;

  // A value in the chosen units: seconds, or % of that lap.
  const val = (r: Row, secs: number) => (pct ? (secs / r.time) * 100 : secs);
  const fmt = (v: number) => (pct ? `${formatValue(v, 1)}%` : formatValue(v, 2));
  // A difference that rounds to nothing reads 0.0, not −0.0.
  const fmtD = (d: number) => {
    const dp = pct ? 1 : 2;
    return Math.abs(d) < 0.5 * 10 ** -dp ? (0).toFixed(dp) : formatDelta(d, dp);
  };
  const unitNote = pct ? (delta ? 'Δ in percentage points of the lap' : '% of each lap') : delta ? 'Δ seconds' : 'seconds';

  /** One cell: the value, or its difference to the reference on a comparison row in Δ mode. */
  const cell = (r: Row, secs: number, refSecs: number, dist: number, what: string, goodWhenLess?: boolean, className = 'num') => {
    const v = val(r, secs);
    const showDelta = delta && refRow && r !== refRow;
    const d = showDelta ? v - val(refRow, refSecs) : NaN;
    // Only seconds are coloured: a smaller share of a slower lap isn't a gain.
    const color = !showDelta || goodWhenLess == null || pct || !Number.isFinite(d) || Math.abs(d) < (pct ? 0.05 : 0.005) ? undefined : (d < 0) === goodWhenLess ? 'var(--gain)' : 'var(--loss)';
    const title = `${r.label} · ${what}: ${formatValue(secs, 3)} s · ${formatValue((secs / r.time) * 100, 1)}% of the lap${Number.isFinite(dist) ? ` · ${formatValue(dist, 0)} m` : ''}`;
    return (
      <td key={what} className={className} title={title} style={{ color }}>
        {!Number.isFinite(v) ? '—' : showDelta ? fmtD(d) : fmt(v)}
      </td>
    );
  };

  return (
    <div className="html-panel phases">
      <div className="subtabs">
        <div className="seg" title="Seconds in each phase, or each phase's share of its lap">
          <button className={!pct ? 'on' : ''} onClick={() => updateComponent(config.id, { units: 's' }, 'Phases in seconds')}>
            s
          </button>
          <button className={pct ? 'on' : ''} onClick={() => updateComponent(config.id, { units: 'pct' }, 'Phases in %')}>
            %
          </button>
        </div>
        <div className="seg" title="Comparison laps as their own values, or as the difference to the reference lap">
          <button className={!delta ? 'on' : ''} onClick={() => updateComponent(config.id, { mode: 'absolute' }, 'Phases absolute')}>
            Absolute
          </button>
          <button className={delta ? 'on' : ''} onClick={() => updateComponent(config.id, { mode: 'delta' }, 'Phases Δ to ref')}>
            Δ to ref
          </button>
        </div>
        <span className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>
          {unitNote}
        </span>
      </div>
      <table className="grid phases-table">
        <thead>
          <tr>
            <th className="l">Lap</th>
            <th title="The lap time: the four phases add up to it">Lap time</th>
            {PHASES.map((ph) => (
              <th key={ph.key} title={PHASE_HELP[ph.key]}>
                <span className="legend-swatch" style={{ background: ph.color }} /> {ph.label}
              </th>
            ))}
            <th className="phases-straights" title="Time on the straights: everything outside the track's corners (the reference lap's corner ranges, as in the Time Breakdown)">
              Straights
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="l">
                <span className="legend-swatch" style={{ background: r.color }} /> {r.label}
                {r === refRow && <span className="muted"> ref</span>}
                <LapsCompounds s={r.s} laps={[r.lap]} label="none" />
                {multiDriver && <div className="muted phases-sub">{r.driver}</div>}
                <PhaseBar p={r.p} />
              </td>
              {delta && refRow && r !== refRow ? (
                <td className="num" style={{ color: r.time - refRow.time < -0.0005 ? 'var(--gain)' : r.time - refRow.time > 0.0005 ? 'var(--loss)' : undefined }}>
                  {formatDelta(r.time - refRow.time, 3)}
                </td>
              ) : (
                <td className="num">{formatLapTime(r.time)}</td>
              )}
              {PHASES.map((ph) => cell(r, r.p.time[ph.key], refRow?.p.time[ph.key] ?? NaN, r.p.dist[ph.key], ph.label))}
              {cell(r, r.straights, refRow?.straights ?? NaN, NaN, 'Straights', true, 'num phases-straights')}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted phases-note">
        Braking = brake ≥ 2% (whatever the throttle does: downshift blips while braking count as braking) · full throttle ≥ {th.full}% · part throttle 2–
        {th.full}% · rolling = neither pedal. The four add up to the lap time; hover a value for its seconds, % and metres.{' '}
        {segs ? (
          'Straights use the reference lap’s corner ranges, as in the Time Breakdown.'
        ) : (
          <>
            No corners for this track, so no straights —{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), openTrackEditor())}>
              add them in the Track editor
            </a>
            .
          </>
        )}
      </div>
    </div>
  );
}

const PHASE_HELP: Record<Phase, string> = {
  braking: 'Time with the brake at 2% or more — counted as braking even if the throttle is also pressed (downshift blips)',
  full: 'Time at full throttle (the corner settings’ full-throttle level, 98% by default) without braking',
  part: 'Time on the throttle but below full throttle, without braking',
  rolling: 'Time with neither pedal pressed (brake and throttle both under 2%)',
};

/** The lap split into its four phases, as one thin stacked bar under the lap's name. */
function PhaseBar({ p }: { p: LapPhases }) {
  return (
    <span className="phases-bar">
      {PHASES.map((ph) => (
        <span key={ph.key} style={{ width: `${(p.time[ph.key] / p.total) * 100}%`, background: ph.color }} />
      ))}
    </span>
  );
}
