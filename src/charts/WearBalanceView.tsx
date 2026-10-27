// Tyre Wear Balance: front axle vs rear axle and left side vs right side. For the selected laps (whole lap,
// or the corner clicked in a Tyre Wear table): each side's wear per tyre, its share in %, and what the
// difference is made of (lock-up / wheelspin / cornering slide). Below, lap by lap through each open stint,
// with laps whose difference comes from a one-off (say a single lock-up on one side) flagged.

import { lapHeaderTint, lapTint } from '../core/colors';
import { formatDelta, formatLapTime, formatValue } from '../core/format';
import { lapLabel } from '../core/session';
import { avgSplits, hasWearChannels, lapWear, TYRES, WEAR_CAUSES, type Tyre, type WearSplit } from '../core/tyreWear';
import { lapKey, type Lap, type Session } from '../core/types';
import { selectedLaps, selectLap, sessionsWithSelection, useStore, type SelectedLap } from '../state/store';
import type { WearBalanceConfig } from '../state/workspace';
import { slowLaps, useSheetCutoff } from './TrendView';
import { CauseBar, causeColors, lapFourWear, setWearFocus, useWearFocus, type Cause } from './wearShared';

/** Short cause names for the narrow lap table. */
const SHORT: Record<Cause, string> = { lock: 'lock-up', spin: 'wheelspin', slide: 'slide' };

type Pair = { key: 'fr' | 'lr'; title: string; a: string; b: string; ta: Tyre[]; tb: Tyre[] };
const PAIRS: Pair[] = [
  { key: 'fr', title: 'Front vs rear', a: 'Front', b: 'Rear', ta: ['FL', 'FR'], tb: ['RL', 'RR'] },
  { key: 'lr', title: 'Left vs right', a: 'Left', b: 'Right', ta: ['FL', 'RL'], tb: ['FR', 'RR'] },
];

/** One side's wear per tyre (its two tyres averaged). */
const side = (w: Record<Tyre, WearSplit>, ts: Tyre[]) => avgSplits(ts.map((t) => w[t]));

/** The difference b − a by cause, biggest first. */
function diffByCause(a: WearSplit, b: WearSplit) {
  return WEAR_CAUSES.map((c) => ({ c, d: b[c.key] - a[c.key] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
}

function SplitBar({ a, b, labelA, labelB }: { a: number; b: number; labelA: string; labelB: string }) {
  const fa = a + b > 0 ? a / (a + b) : 0.5;
  return (
    <div className="balance-split" title={`${labelA} ${(fa * 100).toFixed(1)}% · ${labelB} ${((1 - fa) * 100).toFixed(1)}% of the wear`}>
      <span className="a" style={{ width: `${fa * 100}%` }}>
        {labelA} {Math.round(fa * 100)}%
      </span>
      <span className="b" style={{ width: `${(1 - fa) * 100}%` }}>
        {labelB} {Math.round((1 - fa) * 100)}%
      </span>
      <span className="mid" />
    </div>
  );
}

/** "Rear +340 m (+29%): wheelspin +310 · slide +60 · lock-up −30" — the heavier side and what makes up the gap. */
function DiffLine({ p, A, B, colors }: { p: Pair; A: WearSplit; B: WearSplit; colors: Record<Cause, string> }) {
  const d = B.total - A.total;
  const heavy = d >= 0 ? p.b : p.a;
  const parts = diffByCause(d >= 0 ? A : B, d >= 0 ? B : A).filter((x) => Math.abs(x.d) >= 0.5);
  const pct = Math.min(A.total, B.total) > 0 ? (Math.abs(d) / Math.min(A.total, B.total)) * 100 : NaN;
  return (
    <span>
      <b>
        {heavy} +{formatValue(Math.abs(d), 0)} m
      </b>{' '}
      <span className="muted">({formatValue(pct, 0)}% more per tyre)</span>
      {parts.length > 0 && ': '}
      {parts.map((x, i) => (
        <span key={x.c.key}>
          {i > 0 && <span className="muted"> · </span>}
          <span style={{ color: colors[x.c.key] }}>
            {x.c.label.toLowerCase()} {formatDelta(x.d, 0)}
          </span>
        </span>
      ))}
    </span>
  );
}

interface LapRow {
  s: Session;
  lap: Lap;
  key: string;
  w: Record<Tyre, WearSplit>;
}

/** Laps whose difference for a cause sits far from the stint's usual: a one-off (e.g. a single lock-up on one side). */
function oneOffs(rows: LapRow[], p: Pair): Map<string, { c: (typeof WEAR_CAUSES)[number]; d: number }> {
  const out = new Map<string, { c: (typeof WEAR_CAUSES)[number]; d: number }>();
  if (rows.length < 4) return out;
  // A one-off has to stand out from the stint's usual spread and matter: at least 5% of a lap's wear per tyre (≥ 50 m).
  const totals = rows.map((r) => avgSplits(TYRES.map((t) => r.w[t])).total).sort((x, y) => x - y);
  const typical = totals[Math.floor(totals.length / 2)];
  for (const c of WEAR_CAUSES) {
    const ds = rows.map((r) => side(r.w, p.tb)[c.key] - side(r.w, p.ta)[c.key]);
    const sorted = ds.slice().sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)];
    const mad = sorted.map((x) => Math.abs(x - med)).sort((x, y) => x - y)[Math.floor(sorted.length / 2)];
    const lim = Math.max(50, 0.05 * typical, 4.5 * 1.4826 * mad);
    rows.forEach((r, i) => {
      const off = ds[i] - med;
      if (Math.abs(off) > lim && (!out.has(r.key) || Math.abs(off) > Math.abs(out.get(r.key)!.d))) out.set(r.key, { c, d: off });
    });
  }
  return out;
}

export function WearBalanceView({ config }: { config: WearBalanceConfig }) {
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  const allSessions = useStore((s) => s.sessions);
  const theme = useStore((s) => s.settings.theme);
  const focus = useWearFocus((s) => s.focus);
  const cutoff = useSheetCutoff();
  const laps = selectedLaps();
  const ref = laps[0];
  if (!ref) return <div className="empty-state">Select a lap to see the tyre wear balance.</div>;
  if (ref.lap.index === -1) return <div className="empty-state">Pick a single lap as the reference (not the whole session).</div>;
  if (!hasWearChannels(ref.session)) return <div className="empty-state">No tyre slip data (ndSlip / Tire Load) in this session.</div>;

  const colors = causeColors(theme);
  const useFocus = config.followFocus !== false && focus && focus.venue === ref.session.meta.venue;
  const range: [number, number] | undefined = useFocus ? [focus.entry, focus.exit] : undefined;
  const shown = laps.slice(0, 1 + (config.maxCompare ?? 1));
  const wear = shown.map((l) => ({ l, w: lapFourWear(l, range)?.wear })).filter((x): x is { l: SelectedLap; w: Record<Tyre, WearSplit> } => !!x.w);
  const tag = (i: number, color: string) => (
    <span className="ring-tag" style={{ borderColor: color, background: i === 0 ? color : 'transparent', color: i === 0 ? 'var(--bg)' : color }}>
      {i === 0 ? 'REF' : 'CMP'}
    </span>
  );

  // Lap by lap through each open stint (slow laps left out when the worksheet's 107% filter is on).
  const sessions = sessionsWithSelection(allSessions, lapSel);
  const slow = slowLaps(sessions, cutoff);
  const stints = sessions.map((s) => {
    const rows: LapRow[] = [];
    for (const lap of s.laps) {
      if (!lap.complete || slow.has(lap)) continue;
      const w = {} as Record<Tyre, WearSplit>;
      let ok = true;
      for (const t of TYRES) {
        const lw = lapWear(s, lap, t);
        if (!lw) ok = false;
        else w[t] = lw.total;
      }
      if (ok) rows.push({ s, lap, key: lapKey({ sessionId: s.id, lapIndex: lap.index }), w });
    }
    return { s, rows, flags: Object.fromEntries(PAIRS.map((p) => [p.key, oneOffs(rows, p)])) as Record<Pair['key'], ReturnType<typeof oneOffs>> };
  });

  return (
    <div className="html-panel">
      <div className="subtabs">
        {useFocus ? (
          <span className="tag focus-tag" title="Set by clicking a row in a Tyre Wear table or the Corner Report">
            {focus!.name}
            <button className="btn icon ghost small" title="Back to the whole lap" onClick={() => setWearFocus(null)}>
              ✕
            </button>
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            Whole lap · per tyre (each side's two tyres averaged)
          </span>
        )}
        <span className="grow" />
        <span className="muted" style={{ fontSize: 11 }}>
          {WEAR_CAUSES.map((c) => (
            <span key={c.key} title={c.hint} style={{ marginLeft: 8 }}>
              <span className="legend-swatch" style={{ background: colors[c.key] }} /> {c.label}
            </span>
          ))}
        </span>
      </div>

      <div className="balance-cards">
        {PAIRS.map((p) => {
          const maxSide = Math.max(1e-9, ...wear.flatMap(({ w }) => [side(w, p.ta).total, side(w, p.tb).total]));
          return (
            <div key={p.key} className="wear-card balance-card">
              <div className="wear-card-head">
                {p.title}{' '}
                <span className="muted" style={{ fontWeight: 400 }}>
                  · {p.a.toLowerCase()} {p.ta.join(' + ')} vs {p.b.toLowerCase()} {p.tb.join(' + ')}
                </span>
              </div>
              {wear.map(({ l, w }, i) => {
                const A = side(w, p.ta);
                const B = side(w, p.tb);
                return (
                  <div key={l.key} className="balance-lap" style={{ background: lapTint(l.color, 0.1) }}>
                    <div className="balance-lap-head">
                      {tag(i, l.color)} <span>{lapLabel(l.lap)}</span>
                      <span className="grow" />
                      <DiffLine p={p} A={A} B={B} colors={colors} />
                    </div>
                    <SplitBar a={A.total} b={B.total} labelA={p.a} labelB={p.b} />
                    {[
                      [p.a, A],
                      [p.b, B],
                    ].map(([name, S]) => (
                      <div key={name as string} className="balance-side">
                        <span className="balance-side-name">{name as string}</span>
                        <CauseBar w={S as WearSplit} max={maxSide} colors={colors} />
                        <span className="num">
                          {WEAR_CAUSES.map((c, k) => (
                            <span key={c.key}>
                              {k > 0 && <span className="muted"> · </span>}
                              <span style={{ color: colors[c.key] }}>{formatValue((S as WearSplit)[c.key], 0)}</span>
                            </span>
                          ))}{' '}
                          <span className="muted">= {formatValue((S as WearSplit).total, 0)} m</span>
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {config.showLaps === true &&
        stints.map(({ s, rows, flags }) => (
          <table key={s.id} className="grid balance-table">
            <thead>
              <tr>
                <th className="l">
                  {s.meta.driver || 'Stint'} · {new Date(s.meta.savedAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </th>
                <th>Time</th>
                {PAIRS.map((p) => (
                  <th key={p.key} colSpan={2}>
                    {p.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sel = lapSel.find((l) => l.key === r.key);
                const notes = PAIRS.map((p) => ({ p, f: flags[p.key].get(r.key) })).filter((x) => x.f);
                return [
                  <tr
                    key={r.key}
                    className={'click' + (sel ? ' sel' : '') + (notes.length ? ' flagged' : '')}
                    title="Click: make this the reference · Ctrl/⌘+click: add or remove it as a comparison"
                    onClick={(e) => selectLap(r.key, e.ctrlKey || e.metaKey ? 'toggle' : 'replace')}
                  >
                    <td className="l" style={sel ? { background: lapHeaderTint(selectedLaps().find((x) => x.key === r.key)?.color ?? '#888') } : undefined}>
                      L{r.lap.number}
                      {r.key === refKey ? ' (ref)' : ''}
                    </td>
                    <td className="num">{formatLapTime(r.lap.time)}</td>
                    {PAIRS.map((p) => {
                      const A = side(r.w, p.ta);
                      const B = side(r.w, p.tb);
                      const top = diffByCause(A, B)[0];
                      const d = B.total - A.total;
                      return [
                        <td key={p.key + 'bar'} style={{ width: 96 }}>
                          <SplitBar a={A.total} b={B.total} labelA={p.a[0]} labelB={p.b[0]} />
                        </td>,
                        <td
                          key={p.key + 'd'}
                          className="num"
                          style={{ fontSize: 11.5 }}
                          title={`${p.b} − ${p.a} per tyre, and the cause that makes up most of it`}
                        >
                          {d >= 0 ? p.b[0] : p.a[0]} +{formatValue(Math.abs(d), 0)} m <span style={{ color: colors[top.c.key] }}>{SHORT[top.c.key]}</span>
                        </td>,
                      ];
                    })}
                  </tr>,
                  notes.length > 0 && (
                    <tr key={r.key + 'note'} className="flagged oneoff-note">
                      <td colSpan={6} className="l">
                        <span className="muted">One-off on L{r.lap.number}: </span>
                        {notes.map(({ p, f }) => {
                          const toB = f!.d > 0;
                          const sideName = (toB ? p.b : p.a).toLowerCase();
                          return (
                            <span
                              key={p.key}
                              style={{ color: colors[f!.c.key], marginRight: 12 }}
                              title={`This lap's ${p.title.toLowerCase()} gap from ${f!.c.label.toLowerCase()} is ${formatValue(Math.abs(f!.d), 0)} m away from the stint's usual — a one-off rather than the way you drive`}
                            >
                              ⚠ {SHORT[f!.c.key]} +{formatValue(Math.abs(f!.d), 0)} m on the {sideName} ({p.title.toLowerCase()})
                            </span>
                          );
                        })}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        ))}
      <div className="muted" style={{ padding: '8px 12px', fontSize: 12, lineHeight: 1.5 }}>
        Wear per tyre in metres of full sliding at 5 kN (each side's two tyres averaged); % = that side's share. The coloured numbers are lock-up · wheelspin ·
        cornering slide.
        {config.showLaps === true && (
          <>
            {' '}
            <b>⚠ One-off</b> marks a lap whose difference for a cause is far from the stint's usual (e.g. a single lock-up on one side) — the rest of the gap
            is how you drive.
            {cutoff != null && ` Laps over ${cutoff}% of the fastest are left out (the worksheet's 107% filter).`}
          </>
        )}
      </div>
    </div>
  );
}
