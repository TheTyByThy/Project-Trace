// Optimum Corners: the best time through each of the track's corners across the laps you choose (the
// eligible laps), against the fastest of them (the reference). Corner by corner, from laps actually driven —
// never stitched into a lap, so there's no "optimum lap time", only the time there is to find. Clicking a
// corner selects the reference plus the lap that drove that corner best and zooms everything to it, so the
// usual graph, delta map and GPS lines show exactly how the best one was done.
//
// One component, three looks: the corner table, a track map shaded by the time to find, and a slim corner
// picker (for the sheet that copies the Driver tab). The eligible laps are picked in a pop-up and aren't
// saved: until you pick, they are the complete laps of the current stint.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { BUCKETS } from '../core/corners';
import { formatDelta, formatLapTime, formatValue } from '../core/format';
import { optimumCorners, type EligibleLap, type Optimum, type OptimumCorner } from '../core/optimum';
import { crossingTime, lapCounts } from '../core/session';
import { lapKey, type Lap, type Session } from '../core/types';
import { convertUnit } from '../core/units';
import { selectedLaps, selectLap, setCursor, setHighlight, setXMode, setZoom, trackProfile, trackRotation, useStore } from '../state/store';
import type { OptimumConfig } from '../state/workspace';
import { SessionCompounds } from '../ui/CompoundBadge';
import { SessionSortBar } from '../ui/Sidebar';
import { openTrackEditor } from '../ui/TrackProfileEditor';
import { chartTheme, prepCanvas, useElementSize } from './canvas';
import { lapPath, makeProjector, positionAt } from './trackGeo';

// ---- state (not saved: it resets with the app, by design) ----

interface OptimumState {
  /** Eligible lap keys per track; a track without an entry uses the current stint's complete laps. */
  byVenue: Record<string, string[]>;
  sort: 'track' | 'gain';
  /** The corner in focus (its name), set by clicking one. */
  active: string | null;
  /** Which component shows the lap pop-up (so two on a sheet don't both open it). */
  dialogOwner: string | null;
}

export const useOptimum = create<OptimumState>(() => ({ byVenue: {}, sort: 'track', active: null, dialogOwner: null }));

export const setEligible = (venue: string, keys: string[] | null) =>
  useOptimum.setState((s) => {
    const byVenue = { ...s.byVenue };
    if (keys) byVenue[venue] = keys;
    else delete byVenue[venue];
    return { byVenue };
  });

// ---- the data every look shares ----

interface OptimumData {
  venue: string;
  /** Sessions at this track (the pop-up lists them). */
  pool: Session[];
  /** The stint the default follows (the selected lap's). */
  current: Session;
  /** Every complete lap at this track. */
  candidates: EligibleLap[];
  eligible: EligibleLap[];
  /** True once laps were picked in the pop-up (otherwise the current stint). */
  picked: boolean;
  opt: Optimum | null;
  hasCorners: boolean;
}

const cache = { key: '', value: null as Optimum | null };

function useOptimumData(): OptimumData | null {
  useStore((s) => s.sessions);
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  useStore((s) => s.settings.trackProfiles);
  useStore((s) => s.settings.corners);
  useOptimum((s) => s.byVenue);
  return optimumData();
}

/** The optimum for the current selection's track and the eligible laps (also used outside React). */
export function optimumData(): OptimumData | null {
  const { sessions, dataVersion, settings } = useStore.getState();
  const cornerSettings = settings.corners;
  const byVenue = useOptimum.getState().byVenue;
  const cur = selectedLaps()[0];
  if (!cur) return null;
  const venue = cur.session.meta.venue;
  const pool = sessions.filter((s) => s.meta.venue === venue);
  const candidates = pool.flatMap((s) => s.laps.filter((l) => l.complete && l.index !== -1).map((lap) => ({ key: lapKey({ sessionId: s.id, lapIndex: lap.index }), session: s, lap })));
  const keys = byVenue[venue];
  const eligible = keys ? candidates.filter((l) => keys.includes(l.key)) : candidates.filter((l) => l.session === cur.session && lapCounts(l.session, l.lap));
  const corners = trackProfile(venue).corners;
  // The corner metrics are a little work per lap; the table, map and picker share one result.
  const k = [venue, dataVersion, eligible.map((l) => l.key).join(','), JSON.stringify(corners), JSON.stringify(cornerSettings)].join('|');
  if (cache.key !== k) cache.value = optimumCorners(eligible, corners, cornerSettings);
  cache.key = k;
  return { venue, pool, current: cur.session, candidates, eligible, picked: !!keys, opt: cache.value, hasCorners: corners.length > 0 };
}

// ---- helpers ----

const firstName = (s: Session) => (s.meta.driver || 'Stint').split(/\s+/)[0].slice(0, 12);
const stintTime = (s: Session) => new Date(s.meta.savedAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const stintLabel = (s: Session) => `${firstName(s)} ${stintTime(s)}`;
/** "L5", or "L5 · Martin 19:49" when the laps come from more than one stint. */
const lapName = (l: EligibleLap, multi: boolean) => `L${l.lap.number}${multi ? ` · ${stintLabel(l.session)}` : ''}`;
const fmtS = (v: number, dps = 3) => (Number.isFinite(v) ? formatValue(v, dps) : '—');

/** Focus a corner: the reference plus the lap that drove it best, zoomed to the corner. */
export function focusCorner(o: Optimum, c: OptimumCorner) {
  useOptimum.setState({ active: c.seg.name });
  selectLap(o.ref.key, 'replace');
  if (c.best && c.best.key !== o.ref.key) selectLap(c.best.key, 'add');
  setXMode('distance');
  setZoom([c.seg.entry - 40, c.seg.exit + 40]);
  setCursor(c.seg.apex);
}

/** Leave the corner: no corner in focus and the whole lap back in view (the selected laps stay). */
export function unfocusCorner() {
  useOptimum.setState({ active: null });
  setHighlight(null);
  setZoom(null);
}

/** Click on a corner: focus it, or leave it when it's the one in focus. */
const toggleCorner = (o: Optimum, c: OptimumCorner) => (useOptimum.getState().active === c.seg.name ? unfocusCorner() : focusCorner(o, c));

const inTrackOrder = (o: Optimum) => o.corners;
const sorted = (o: Optimum, sort: OptimumState['sort']) =>
  sort === 'gain' ? o.corners.slice().sort((a, b) => (Number.isFinite(b.gain) ? b.gain : -1) - (Number.isFinite(a.gain) ? a.gain : -1)) : inTrackOrder(o);

// ---- the component ----

export function OptimumView({ config }: { config: OptimumConfig }) {
  const d = useOptimumData();
  const owner = useOptimum((s) => s.dialogOwner);
  const view = config.view ?? 'table';
  if (!d) return <div className="empty-state">Select a lap: its stint's laps are compared corner by corner (choose other laps with Choose laps…).</div>;
  const dialog = owner === config.id && createPortal(<EligibleDialog d={d} />, document.body);
  if (!d.hasCorners)
    return (
      <div className="empty-state" style={{ maxWidth: 420 }}>
        <b>No corners for this track yet</b>
        <div style={{ margin: '8px 0 12px', lineHeight: 1.6 }}>The comparison uses the track's corners. Add them once in the Track editor and they're used everywhere.</div>
        <button className="btn" onClick={openTrackEditor}>
          Open the track editor
        </button>
      </div>
    );
  const open = () => useOptimum.setState({ dialogOwner: config.id });
  const body = !d.opt ? (
    <div className="empty-state">
      No complete laps ticked.{' '}
      <a href="#" onClick={(e) => (e.preventDefault(), open())}>
        Choose laps…
      </a>
    </div>
  ) : view === 'map' ? (
    <OptimumMap o={d.opt} />
  ) : view === 'picker' ? (
    <OptimumPicker d={d} o={d.opt} onChoose={open} />
  ) : (
    <OptimumTable d={d} o={d.opt} onChoose={open} />
  );
  return (
    <>
      {body}
      {dialog}
    </>
  );
}

// ---- the corner table ----

function LapsButton({ d, onChoose }: { d: OptimumData; onChoose: () => void }) {
  return (
    <button
      className="btn small"
      onClick={onChoose}
      title={d.picked ? 'The laps you picked' : `The complete laps of the current stint (${stintLabel(d.current)}${d.current.invalidCounts ? '' : ', without invalid laps'})`}
    >
      Choose laps… <span className="muted">({d.eligible.length}{d.picked ? '' : ' · this stint'})</span>
    </button>
  );
}

function OptimumTable({ d, o, onChoose }: { d: OptimumData; o: Optimum; onChoose: () => void }) {
  const sort = useOptimum((s) => s.sort);
  const active = useOptimum((s) => s.active);
  const speedUnit = useStore((s) => s.settings.units.speed);
  const sc = convertUnit('kph', speedUnit) ?? { k: 1, b: 0 };
  const spd = (v: number | undefined) => (v != null && Number.isFinite(v) ? formatValue(v * sc.k + sc.b, 0) : '—');
  const multi = new Set(o.laps.map((l) => l.session)).size > 1;
  const max = Math.max(1e-6, ...o.corners.map((c) => (Number.isFinite(c.gain) ? c.gain : 0)));
  const found = o.corners.filter((c) => c.gain > 0.0005);
  const fromLaps = new Set(found.map((c) => c.best!.key)).size;
  return (
    <div className="html-panel optimum">
      <div className="subtabs">
        <LapsButton d={d} onChoose={onChoose} />
        <span className="grow" />
        <div className="seg" title="Corners in track order, or the most time to find first">
          <button className={sort === 'track' ? 'on' : ''} onClick={() => useOptimum.setState({ sort: 'track' })}>
            Track order
          </button>
          <button className={sort === 'gain' ? 'on' : ''} onClick={() => useOptimum.setState({ sort: 'gain' })}>
            Most time
          </button>
        </div>
      </div>
      <div className="opt-summary">
        <div className="opt-total" title="What the reference lap loses to the best of the eligible laps, added up over every corner">
          <b>{formatValue(o.total, 3)} s</b>
          <span>to find in the corners</span>
        </div>
        <div className="muted opt-sub">
          Reference <b style={{ color: 'var(--text)' }}>{lapName(o.ref, multi)}</b> {formatLapTime(o.ref.lap.time)}, the fastest of {o.laps.length} eligible lap
          {o.laps.length === 1 ? '' : 's'}. {found.length} of {o.corners.length} corners were driven faster on another lap{found.length ? ` (${fromLaps} lap${fromLaps === 1 ? '' : 's'})` : ''}. Click a corner
          to see how (click it again to leave it).
        </div>
      </div>
      <table className="grid opt-table">
        <thead>
          <tr>
            <th className="l">Corner</th>
            <th title="The reference lap's time through the corner">Ref</th>
            <th title="The best time through the corner on any eligible lap">Best</th>
            <th className="l">Best lap</th>
            <th className="l" title="How much slower the reference is than the best through this corner">
              Δ ref to best
            </th>
            <th title={`Minimum speed of the best lap minus the reference's (${speedUnit}), on the corners with time to find. + = the best lap carried more speed; − = it was quicker despite less (the time came from entry or exit). Hover for both speeds.`}>
              Δ min speed
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted(o, sort).map((c) => {
            const refBest = c.best?.key === o.ref.key;
            const f = Number.isFinite(c.gain) ? c.gain / max : 0;
            const bucket = BUCKETS.find((b) => b.key === c.seg.bucket)!;
            return (
              <tr
                key={c.seg.name + c.seg.entry}
                className={'click' + (active === c.seg.name ? ' sel' : '')}
                onClick={() => toggleCorner(o, c)}
                title={active === c.seg.name ? 'Click again to leave this corner' : undefined}
                onMouseEnter={() => setHighlight({ entry: c.seg.entry, exit: c.seg.exit })}
                onMouseLeave={() => setHighlight(null)}
              >
                <td className="l" title={`${c.seg.entry.toFixed(0)}–${c.seg.exit.toFixed(0)} m · ${bucket.label}`}>
                  <span className={'bucket-chip ' + c.seg.bucket}>{bucket.short}</span>
                  <b>{c.seg.name}</b>
                </td>
                <td className="num">{fmtS(c.ref?.time ?? NaN)}</td>
                <td className={'num' + (c.bestM ? ' best' : '')}>{fmtS(c.bestM?.time ?? NaN)}</td>
                <td className="l">
                  {!c.best ? (
                    <span className="muted">—</span>
                  ) : refBest ? (
                    <span className="tag best" title="Nothing beat the reference here">
                      ref
                    </span>
                  ) : (
                    <span title={`${c.best.session.meta.driver} · ${c.best.session.fileName}`}>
                      {lapName(c.best, multi)} <span className="muted">{formatLapTime(c.best.lap.time)}</span>
                    </span>
                  )}
                </td>
                <td className="l opt-gain">
                  <span className="opt-bar">
                    <span style={{ width: `${f * 100}%` }} />
                  </span>
                  <span className="num" style={{ color: c.gain > 0.0005 ? 'var(--loss)' : 'var(--text-3)' }}>
                    {Number.isFinite(c.gain) ? (c.gain > 0.0005 ? formatDelta(c.gain, 3) : '0.000') : '—'}
                  </span>
                </td>
                <MinSpeedDelta c={c} sc={sc.k} unit={speedUnit} spd={spd} />
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="muted phases-note">
        Corner ranges are detected on the reference lap (as in the Corner Report) and only corners count, not straights. Each corner's best is a real lap's —
        nothing is stitched into a lap, so there is no optimum lap time, just the time to find.
      </div>
    </div>
  );
}

/**
 * The best lap's minimum speed minus the reference's, only where there's time to find: where the reference
 * is the best, the best lap is the reference itself and the difference is always nothing.
 */
function MinSpeedDelta({ c, sc, unit, spd }: { c: OptimumCorner; sc: number; unit: string; spd: (v: number | undefined) => string }) {
  const title = `Min speed: ref ${spd(c.ref?.minSpeed)} · best ${spd(c.bestM?.minSpeed)} ${unit}`;
  if (!(c.gain > 0.0005) || !c.ref || !c.bestM)
    return (
      <td className="num" title={title}>
        <span className="muted">·</span>
      </td>
    );
  const d = (c.bestM.minSpeed - c.ref.minSpeed) * sc;
  const r = Math.round(d);
  return (
    <td className="num" title={title + (r < 0 ? ' — quicker with less minimum speed: the time came from entry or exit' : '')} style={{ color: r > 0 ? 'var(--gain)' : r < 0 ? 'var(--warning)' : 'var(--text-3)' }}>
      {r === 0 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r)}`}
    </td>
  );
}

// ---- the corner picker (for the Driver copy) ----

function OptimumPicker({ d, o, onChoose }: { d: OptimumData; o: Optimum; onChoose: () => void }) {
  const active = useOptimum((s) => s.active);
  const multi = new Set(o.laps.map((l) => l.session)).size > 1;
  const list = o.corners;
  const i = Math.max(0, list.findIndex((c) => c.seg.name === active));
  const c = list[i];
  const go = (k: number) => focusCorner(o, list[(k + list.length) % list.length]);
  return (
    <div className="html-panel optimum opt-picker">
      <button className="btn icon" title="Previous corner" onClick={() => go(i - 1)}>
        ‹
      </button>
      <select value={c.seg.name} onChange={(e) => focusCorner(o, list.find((x) => x.seg.name === e.target.value)!)}>
        {list.map((x) => (
          <option key={x.seg.name + x.seg.entry} value={x.seg.name}>
            {x.seg.name}
            {x.gain > 0.0005 ? `  ${formatDelta(x.gain, 3)} s` : '  (ref is best)'}
          </option>
        ))}
      </select>
      <button className="btn icon" title="Next corner" onClick={() => go(i + 1)}>
        ›
      </button>
      {active === c.seg.name ? (
        <span className="opt-picker-text">
          ref {lapName(o.ref, multi)} <b>{fmtS(c.ref?.time ?? NaN)}</b> · best{' '}
          {c.best && c.best.key !== o.ref.key ? (
            <>
              {lapName(c.best, multi)} <b>{fmtS(c.bestM?.time ?? NaN)}</b> <span style={{ color: 'var(--loss)' }}>({formatDelta(c.gain, 3)} s on the ref)</span>
            </>
          ) : (
            <span className="tag best">the ref</span>
          )}
        </span>
      ) : (
        <span className="muted opt-picker-text">Pick a corner to zoom to it with its best lap</span>
      )}
      <span className="grow" />
      <span className="muted opt-picker-text" title="Added up over every corner">
        {formatValue(o.total, 3)} s to find
      </span>
      <LapsButton d={d} onChoose={onChoose} />
    </div>
  );
}

// ---- the map: corners shaded by the time to find ----

function OptimumMap({ o }: { o: Optimum }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<{ x: number; y: number; c: OptimumCorner }[]>([]);
  const active = useOptimum((s) => s.active);
  const theme = useStore((s) => s.settings.theme);
  useStore((s) => s.settings.trackProfiles);
  useStore((s) => s.workingRotation);

  const draw = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(canvasRef.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    const best = getComputedStyle(document.documentElement).getPropertyValue('--best').trim() || '#9085e9';
    hitsRef.current = [];
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    const { session: s, lap } = o.ref;
    const path = lapPath(s, lap);
    if (!path || path.t.length < 10) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText('No position channels (Car Coord X/Y or GPS) in this session', w / 2, h / 2);
      return;
    }
    const venue = s.meta.venue;
    const proj = makeProjector(trackRotation(venue, useStore.getState()), trackProfile(venue).mirror);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < path.t.length; i++) {
      const [a, b] = proj(path.x[i], path.y[i]);
      minX = Math.min(minX, a);
      maxX = Math.max(maxX, a);
      minY = Math.min(minY, b);
      maxY = Math.max(maxY, b);
    }
    const pad = 30;
    const legendH = 26;
    const sc = Math.min((w - 2 * pad) / Math.max(1, maxX - minX), (h - 2 * pad - legendH) / Math.max(1, maxY - minY));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const toScreen = (x: number, y: number): [number, number] => {
      const [a, b] = proj(x, y);
      return [w / 2 + (a - cx) * sc, (h - legendH) / 2 + (b - cy) * sc];
    };
    const at = (dist: number): [number, number] | null => {
      const t = crossingTime(lap, dist);
      if (!Number.isFinite(t)) return null;
      const [x, y] = positionAt(path, t);
      return toScreen(x, y);
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The whole lap as the road.
    ctx.strokeStyle = T.road;
    ctx.lineWidth = 10;
    ctx.beginPath();
    for (let i = 0; i < path.t.length; i++) {
      const [a, b] = toScreen(path.x[i], path.y[i]);
      if (i) ctx.lineTo(a, b);
      else ctx.moveTo(a, b);
    }
    ctx.stroke();
    // Each corner coloured by the time to find: purple where the reference is already the best, red
    // (stronger for more) where another lap was quicker.
    const max = Math.max(1e-6, ...o.corners.map((c) => (Number.isFinite(c.gain) ? c.gain : 0)));
    // Labels already placed, so a label that would overlap one moves up or down until it's clear.
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const place = (cx: number, cy: number, tw: number): [number, number] => {
      const hit = (x: number, y: number) => boxes.some((b) => x - tw / 2 - 3 < b.x1 && x + tw / 2 + 3 > b.x0 && y - 8 < b.y1 && y + 8 > b.y0);
      for (const dy of [0, -17, 17, -34, 34, -51, 51]) {
        const y = Math.max(10, Math.min(h - 10, cy + dy));
        if (!hit(cx, y)) return [cx, y];
      }
      return [cx, cy];
    };
    for (const c of o.corners) {
      const pts: [number, number][] = [];
      for (let dd = c.seg.entry; dd <= c.seg.exit; dd += 4) {
        const p = at(dd);
        if (p) pts.push(p);
      }
      if (pts.length < 2) continue;
      const f = Number.isFinite(c.gain) ? c.gain / max : 0;
      const isActive = active === c.seg.name;
      ctx.globalAlpha = c.gain > 0.0005 ? 0.35 + 0.65 * f : 0.85;
      ctx.strokeStyle = c.gain > 0.0005 ? T.loss : best;
      ctx.lineWidth = isActive ? 9 : 6;
      ctx.beginPath();
      pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (isActive) {
        ctx.strokeStyle = T.text;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      const apex = at(c.seg.apex) ?? pts[Math.floor(pts.length / 2)];
      hitsRef.current.push({ x: apex[0], y: apex[1], c });
    }
    // Labels on top of every corner's line: corner name and the time to find there.
    for (const { x: ax, y: ay, c } of hitsRef.current) {
      const isActive = active === c.seg.name;
      const apex = [ax, ay];
      const label = c.gain > 0.0005 ? `${c.seg.name} ${formatValue(c.gain, 2)}` : c.seg.name;
      ctx.font = (isActive ? 'bold ' : '') + T.font;
      const tw = ctx.measureText(label).width;
      const [lx, ly] = place(Math.min(w - tw / 2 - 4, Math.max(tw / 2 + 4, apex[0])), Math.max(10, apex[1] - 15), tw);
      boxes.push({ x0: lx - tw / 2 - 3, x1: lx + tw / 2 + 3, y0: ly - 8, y1: ly + 8 });
      ctx.fillStyle = T.surface;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(lx - tw / 2 - 3, ly - 8, tw + 6, 16);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.gain > 0.0005 ? T.text : T.text2;
      ctx.textAlign = 'center';
      ctx.fillText(label, lx, ly);
    }
    // Legend.
    ctx.font = T.font;
    ctx.textAlign = 'left';
    const y = h - legendH / 2;
    ctx.fillStyle = T.loss;
    ctx.fillRect(10, y - 4, 22, 8);
    ctx.fillStyle = T.text2;
    ctx.fillText('time to find (s; stronger = more)', 38, y);
    const x2 = 38 + ctx.measureText('time to find (s; stronger = more)').width + 18;
    ctx.fillStyle = best;
    ctx.fillRect(x2, y - 4, 22, 8);
    ctx.fillStyle = T.text2;
    ctx.fillText('the reference is the best · click a corner (again to leave it)', x2 + 28, y);
  }, [size, o, active, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(draw, [draw]);
  return (
    <div
      ref={wrapRef}
      className="opt-map"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        let hit: OptimumCorner | null = null;
        let bd = 28 * 28;
        for (const p of hitsRef.current) {
          const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (dd < bd) {
            bd = dd;
            hit = p.c;
          }
        }
        // A corner: focus it (or leave it if it's the one in focus); empty track: leave the corner.
        if (hit) toggleCorner(o, hit);
        else if (useOptimum.getState().active) unfocusCorner();
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

// ---- the eligible-laps pop-up ----

/** "1:39.5" or "99.5" → seconds (NaN if it isn't a time). */
function parseTime(v: string): number {
  const m = v.trim().match(/^(?:(\d+):)?(\d+(?:\.\d*)?)$/);
  return m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) : NaN;
}

function TriCheck({ state, onChange, title }: { state: 'all' | 'some' | 'none'; onChange: (v: boolean) => void; title?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return <input ref={ref} type="checkbox" title={title} checked={state === 'all'} onChange={(e) => onChange(e.target.checked)} />;
}

function EligibleDialog({ d }: { d: OptimumData }) {
  const close = () => useOptimum.setState({ dialogOwner: null });
  const fastest = Math.min(...d.candidates.map((l) => l.lap.time));
  const [from, setFrom] = useState(() => (Number.isFinite(fastest) ? formatLapTime(fastest) : ''));
  const [to, setTo] = useState(() => (Number.isFinite(fastest) ? formatLapTime(fastest * 1.02) : ''));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const ticked = new Set(d.eligible.map((l) => l.key));
  const put = (keys: Iterable<string>) => setEligible(d.venue, [...new Set(keys)]);
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(ticked);
    for (const k of keys) on ? next.add(k) : next.delete(k);
    put(next);
  };
  const lo = parseTime(from);
  const hi = parseTime(to);
  const rangeOk = Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo;
  const inRange = d.candidates.filter((l) => rangeOk && l.lap.time >= lo - 1e-9 && l.lap.time <= hi + 1e-9).map((l) => l.key);
  const pct = (p: number) => d.candidates.filter((l) => l.lap.time <= fastest * (1 + p / 100) + 1e-9).map((l) => l.key);
  const ref = d.eligible.length ? d.eligible.reduce((a, b) => (b.lap.time < a.lap.time ? b : a)) : null;
  const multi = d.pool.length > 1;
  // Same order as the Sessions & laps list (Sort stints here sorts both).
  const stints = d.pool;

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal opt-dialog" style={{ width: 760 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Eligible laps</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            The best of each corner is taken from these; the fastest of them is the reference.
          </span>
        </div>
        <div className="modal-body">
          <div className="opt-quick">
            <button className="btn small" onClick={() => put(d.candidates.map((l) => l.key))}>
              All
            </button>
            <button className="btn small" onClick={() => put([])}>
              None
            </button>
            <button className="btn small" title="Untick the invalid laps" onClick={() => put(d.eligible.filter((l) => !l.lap.invalid).map((l) => l.key))}>
              No invalid laps
            </button>
            <button className="btn small" title={`Back to the default: the complete laps of the current stint (${stintLabel(d.current)})`} onClick={() => setEligible(d.venue, null)}>
              Current stint
            </button>
            <span className="opt-sep" />
            <span className="muted">Within % of the fastest ({formatLapTime(fastest)}):</span>
            {[0.5, 1, 2, 3, 5].map((p) => (
              <button key={p} className="btn small" title={`Only the laps within ${p}% of the fastest lap here`} onClick={() => put(pct(p))}>
                {p}%
              </button>
            ))}
          </div>
          <div className="opt-quick">
            <span className="muted">Lap time from</span>
            <input className="opt-time" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="1:39.000" />
            <span className="muted">to</span>
            <input className="opt-time" value={to} onChange={(e) => setTo(e.target.value)} placeholder="1:41.000" />
            <button className="btn small" disabled={!rangeOk} title="Tick only the laps in this range" onClick={() => put(inRange)}>
              Only these ({inRange.length})
            </button>
            <button className="btn small" disabled={!rangeOk} title="Tick the laps in this range as well" onClick={() => toggle(inRange, true)}>
              Add these
            </button>
            <button className="btn small" disabled={!rangeOk} title="Untick the laps in this range" onClick={() => toggle(inRange, false)}>
              Remove these
            </button>
          </div>
          {stints.length > 1 && <SessionSortBar />}
          {stints.map((s) => {
            const laps = s.laps.filter((l) => l.index !== -1);
            const keys = d.candidates.filter((l) => l.session === s).map((l) => l.key);
            const n = keys.filter((k) => ticked.has(k)).length;
            const best = Math.min(...laps.filter((l) => l.complete).map((l) => l.time));
            return (
              <div key={s.id} className="opt-stint">
                <label className="opt-stint-head">
                  <TriCheck state={n === 0 ? 'none' : n === keys.length ? 'all' : 'some'} onChange={(v) => toggle(keys, v)} title="Tick or untick the whole stint" />
                  <b>{s.meta.driver || 'Stint'}</b>
                  <span className="muted">
                    {new Date(s.meta.savedAt ?? 0).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · best {formatLapTime(best)} · {n}/{keys.length} ticked
                  </span>
                  <SessionCompounds s={s} />
                  {s === d.current && <span className="tag">current</span>}
                </label>
                <div className="opt-laps">
                  {laps.map((l: Lap) => {
                    const k = lapKey({ sessionId: s.id, lapIndex: l.index });
                    const on = ticked.has(k);
                    const isRef = ref?.key === k;
                    return (
                      <label key={k} className={'opt-lap' + (on ? ' on' : '') + (l.complete ? '' : ' off')} title={l.complete ? undefined : 'Not a full lap (out / in / partial), so it can’t be compared'}>
                        <input type="checkbox" disabled={!l.complete} checked={on} onChange={(e) => toggle([k], e.target.checked)} />
                        <span>L{l.number}</span>
                        <span className="num">{formatLapTime(l.time)}</span>
                        {l.kind === 'out' && <span className="tag">out</span>}
                        {l.kind === 'in' && <span className="tag">in</span>}
                        {l.invalid && <span className="tag bad">inv</span>}
                        {isRef && <span className="tag best">ref</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="modal-foot" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {d.eligible.length} lap{d.eligible.length === 1 ? '' : 's'} ticked
            {ref ? ` · reference ${lapName(ref, multi)} ${formatLapTime(ref.lap.time)} (the fastest ticked)` : ' — tick at least one'}
            {d.picked ? '' : ' · following the current stint'}
          </span>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
