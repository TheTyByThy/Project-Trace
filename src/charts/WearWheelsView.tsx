// Tyre Wear Wheels: the four tyres laid out like the car. Each tyre's rubber is a ring split into lock-up /
// wheelspin / cornering slide — the reference lap outside, comparison laps inside — with the wear in metres
// and the comparison's difference in the middle. Shows the whole lap, or the section clicked in a Tyre Wear
// table (the "focus"), so one glance says which tyre is working hardest and why.

import { formatDelta, formatValue } from '../core/format';
import { hasWearChannels, TYRES, WEAR_CAUSES, type Tyre } from '../core/tyreWear';
import { lapLabel } from '../core/session';
import { selectedLaps, updateComponent, useStore, type SelectedLap } from '../state/store';
import type { WearWheelsConfig } from '../state/workspace';
import { useElementSize } from './canvas';
import { causeColors, lapFourWear, pctDelta, pick, setWearFocus, sharePct, useWearFocus, WearWheel, type FourWear } from './wearShared';

/** Which tyres a wheels view shows. */
export type WheelTyres = 'all' | 'avg' | 'front' | 'rear' | Tyre;
const tyresFor = (t: WheelTyres): (Tyre | 'avg')[] => (t === 'all' ? [...TYRES] : t === 'front' ? ['FL', 'FR'] : t === 'rear' ? ['RL', 'RR'] : [t]);

/** "REF" / "CMP" tag in the lap's colour, so the rings are never ambiguous. */
function RingTag({ i, color }: { i: number; color: string }) {
  return (
    <span className="ring-tag" style={{ borderColor: color, background: i === 0 ? color : 'transparent', color: i === 0 ? 'var(--bg)' : color }}>
      {i === 0 ? 'REF' : i === 1 ? 'CMP' : 'CMP 2'}
    </span>
  );
}

/** Key: a mini wheel with the reference as the outer ring and the comparison laps inside, each named. */
export function RingKey({ laps }: { laps: SelectedLap[] }) {
  const r = [11, 7.5, 4.5];
  return (
    <span className="ring-key" title="Outer ring = the reference lap; inner ring(s) = comparison lap(s)">
      <svg viewBox="0 0 26 26" width={26} height={26}>
        {laps.map((l, i) => (
          <circle key={l.key} cx={13} cy={13} r={r[i]} fill="none" stroke={l.color} strokeWidth={i === 0 ? 3 : 2.2} />
        ))}
      </svg>
      {laps.map((l, i) => (
        <span key={l.key}>
          {i === 0 ? 'outer' : i === 1 ? 'inner' : 'innermost'} <RingTag i={i} color={l.color} /> {lapLabel(l.lap)}
        </span>
      ))}
    </span>
  );
}

/** The wheels for some laps over a lap-distance range (or the whole lap): four tyres, an axle, one tyre, or the average. */
export function WheelsGrid({
  laps,
  range,
  tyre,
  mode,
  theme,
  maxCompare = 1,
  size,
  showShares = true,
  units = 'm',
}: {
  laps: SelectedLap[];
  range?: [number, number];
  tyre: WheelTyres;
  mode: 'share' | 'amount';
  theme: 'dark' | 'light';
  maxCompare?: number;
  size: number;
  /** Each lap's lock-up · wheelspin · slide metres under each wheel (off where a table shows the numbers). */
  showShares?: boolean;
  /** 'm': causes and differences in metres; 'pct': each cause's share of that lap's wear, and the difference as % of the reference. */
  units?: 'm' | 'pct';
}) {
  const colors = causeColors(theme);
  const shown = laps.slice(0, 1 + maxCompare);
  const wear = shown.map((l) => lapFourWear(l, range));
  const ok = shown.map((l, i) => ({ l, w: wear[i] })).filter((x): x is { l: SelectedLap; w: FourWear } => !!x.w);
  if (!ok.length)
    return (
      <div className="muted" style={{ padding: 12 }}>
        No tyre slip data for these laps.
      </div>
    );
  const tyres = tyresFor(tyre);
  const max = Math.max(1e-9, ...ok.flatMap(({ w }) => tyres.map((t) => pick(w, t).total)));
  return (
    <div className={'wheels-car' + (tyres.length === 1 ? ' one' : '')}>
      {tyres.map((t) => {
        const rings = ok.map(({ l, w }) => ({ w: pick(w, t), color: l.color, label: lapLabel(l.lap) + (l.isRef ? ' (ref)' : '') }));
        const ref = rings[0];
        return (
          <div key={t} className="wheel-cell">
            <div className="wheel-name">{t === 'avg' ? 'Average of 4' : t}</div>
            <WearWheel rings={rings} colors={colors} mode={mode} max={max} size={size} title={t} units={units} />
            {showShares && (
              <div className="wheel-shares">
                {rings.map((r, i) => (
                  <div
                    key={i}
                    title={`${r.label}: lock-up · wheelspin · cornering slide${units === 'pct' ? ' as % of the lap’s wear on this tyre' : ', metres of full sliding at 5 kN'}`}
                  >
                    <RingTag i={i} color={r.color} />{' '}
                    {WEAR_CAUSES.map((c, k) => (
                      <span key={c.key}>
                        {k > 0 && <span className="muted"> · </span>}
                        <span style={{ color: colors[c.key] }}>{units === 'pct' ? `${formatValue(sharePct(r.w, c.key), 0)}%` : `${formatValue(r.w[c.key], 0)} m`}</span>
                      </span>
                    ))}
                    {units === 'pct' && <span className="muted"> = {formatValue(r.w.total, 0)} m</span>}
                    {i > 0 && (
                      <span className="muted">
                        {' '}
                        (Δ{' '}
                        {units === 'pct'
                          ? Number.isFinite(pctDelta(r.w.total, ref.w.total))
                            ? `${formatDelta(pctDelta(r.w.total, ref.w.total), 0)}%`
                            : '—'
                          : `${formatDelta(r.w.total - ref.w.total, 0)} m`}
                        )
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
export function WearWheelsView({ config }: { config: WearWheelsConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);
  const focus = useWearFocus((s) => s.focus);
  const [gridRef, size] = useElementSize<HTMLDivElement>();
  const laps = selectedLaps();
  const ref = laps[0];
  if (!ref) return <div className="empty-state">Select a lap to see its tyre wear.</div>;
  if (ref.lap.index === -1) return <div className="empty-state">Pick a single lap as the reference (not the whole session).</div>;
  if (!hasWearChannels(ref.session)) return <div className="empty-state">No tyre slip data (ndSlip / Tire Load) in this session.</div>;

  const colors = causeColors(theme);
  const mode = config.mode ?? 'share';
  const maxCompare = config.maxCompare ?? 1;
  const useFocus = config.followFocus !== false && focus && focus.venue === ref.session.meta.venue;
  const range: [number, number] | undefined = useFocus ? [focus.entry, focus.exit] : undefined;
  const tyre = config.tyre ?? 'all';
  const units = config.units ?? 'm';
  const cols = tyresFor(tyre).length > 1 ? 2 : 1;
  const rowsN = tyre === 'all' ? 2 : 1;
  // Below each wheel: its name and one line of metres per lap shown.
  const below = 26 + 17 * Math.min(laps.length, 1 + maxCompare);
  const wheel = Math.max(70, Math.min(420, Math.floor(Math.min((size.w - 8) / cols - 28, (size.h - 4 - 6 * (rowsN - 1)) / rowsN - below))));

  return (
    <div className="html-panel wear-wheels">
      <div className="subtabs">
        <RingKey laps={laps.slice(0, 1 + maxCompare)} />
        {useFocus ? (
          <span className="tag focus-tag" title="Set by clicking a row in a Tyre Wear table">
            {focus!.name}
            <button className="btn icon ghost small" title="Back to the whole lap" onClick={() => setWearFocus(null)}>
              ✕
            </button>
          </span>
        ) : null}
        <span className="grow" />
        <div className="seg" title="Lock-up / wheelspin / slide and the comparison's difference in metres, or as %. The total stays in metres.">
          <button className={units === 'm' ? 'on' : ''} onClick={() => updateComponent(config.id, { units: 'm' }, 'Wheels in metres')}>
            m
          </button>
          <button className={units === 'pct' ? 'on' : ''} onClick={() => updateComponent(config.id, { units: 'pct' }, 'Wheels in %')}>
            %
          </button>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>
          {WEAR_CAUSES.map((c) => (
            <span key={c.key} title={c.hint} style={{ marginLeft: 8 }}>
              <span className="legend-swatch" style={{ background: colors[c.key] }} /> {c.label}
            </span>
          ))}
        </span>
      </div>
      <div ref={gridRef} className="wheels-wrap">
        {size.w > 0 && <WheelsGrid laps={laps} range={range} tyre={tyre} mode={mode} theme={theme} maxCompare={maxCompare} size={wheel} units={units} />}
      </div>
    </div>
  );
}
