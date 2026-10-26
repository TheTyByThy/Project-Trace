// Time / Distance graph — the core MoTeC-style component.
//  • Panes stacked vertically share the x-axis; channels with the same unit share a y-scale.
//  • Every selected lap is overlaid in its lap colour; the reference lap is drawn last and uses
//    per-channel colours or its lap colour (toggle with J).
//  • Optional time-variance pane (Δ vs reference) at the top.
//  • Click / drag = move the cursor, double-click-and-drag = zoom, Shift+drag = measure,
//    wheel = zoom, right/middle-drag = pan, drag a pane border = resize panes.

import { useCallback, useEffect, useRef } from 'react';
import { computeVariance, lapSeries, varianceAt, xToTime } from '../core/axis';
import { CATEGORICAL, channelColors, withAlpha } from '../core/colors';
import { formatAxisDistance, formatAxisTime, formatDelta, formatValue } from '../core/format';
import { crossingTime } from '../core/session';
import { rangeStats, niceTicks } from '../core/stats';
import type { ChannelInfo, Samples } from '../core/types';
import { pane as newPane } from '../state/components';
import {
  activeWorkspace,
  selectedLaps,
  setCursor,
  setGraphMarkers,
  toggleDatum,
  setMeasure,
  setZoom,
  trackProfile,
  updateComponent,
  useStore,
  viewRange,
  type SelectedLap,
} from '../state/store';
import type { GraphConfig } from '../state/workspace';
import { markAtCursor } from '../actions';
import { keyHint } from '../shortcuts';
import { openMenu } from '../ui/overlays';
import { openTrackEditor } from '../ui/TrackProfileEditor';
import { chartTheme, drawTrace, fmtTick, lowerBound, prepCanvas, useElementSize, useStoreListener } from './canvas';
import { channelDps, channelLabel, conv, displayData, lapRange } from './data';

/** Plot margins; the Bars component uses the same ones so it lines up under a graph. */
export const LEFT = 54;
export const RIGHT = 10;
const TOP = 4;
const BOTTOM = 22;
const DEFAULT_VARIANCE_WEIGHT = 0.55;
const DOUBLE_CLICK_MS = 380;

interface TraceInfo {
  name: string;
  color: string;
  unit: string;
  dps: number;
  k: number;
  b: number;
  min: number;
  max: number;
  present: boolean;
  /** Kept in the pane but not drawn (and not part of the y-scale). */
  hidden: boolean;
}

interface PaneLayout {
  kind: 'variance' | 'channels';
  index: number; // index into config.panes (-1 for variance)
  top: number;
  bottom: number;
  traces: TraceInfo[];
  vMin: number;
  vMax: number;
  /** Legend rows as drawn, for clicking a channel name to show / hide it. */
  legendRows: { y: number; h: number; x1: number; name: string }[];
}

interface Layout {
  w: number;
  h: number;
  v0: number;
  v1: number;
  panes: PaneLayout[];
  laps: SelectedLap[];
}

const pxOf = (L: Layout, x: number) => LEFT + ((x - L.v0) / (L.v1 - L.v0)) * (L.w - LEFT - RIGHT);
const xOfPx = (L: Layout, px: number) => L.v0 + ((px - LEFT) / (L.w - LEFT - RIGHT)) * (L.v1 - L.v0);

function visibleRange(sel: SelectedLap, ch: ChannelInfo, v0: number, v1: number, mode: 'time' | 'distance'): [number, number] | null {
  const ser = lapSeries(sel.lap, ch, mode);
  const a = Math.max(0, lowerBound(ser.xs, v0) - 1);
  const b = Math.min(ser.xs.length - 1, lowerBound(ser.xs, v1));
  if (b < a) return null;
  const st = rangeStats(ch.data, ser.i0 + a, ser.i0 + b);
  return st.count ? [st.min, st.max] : null;
}

/** Interpolated (or held, for discrete channels) value at session time t. */
function valueAt(ch: ChannelInfo, data: Samples, t: number): number {
  const f = (t - ch.t0) * ch.rate;
  if (ch.discrete) return data[Math.max(0, Math.min(ch.n - 1, Math.floor(f + 1e-6)))];
  const i0 = Math.max(0, Math.min(ch.n - 2, Math.floor(f)));
  const fr = Math.max(0, Math.min(1, f - i0));
  return data[i0] + (data[i0 + 1] - data[i0]) * fr;
}

export function GraphView({ config }: { config: GraphConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<Layout | null>(null);
  const dragRef = useRef<{
    mode: 'scrub' | 'select' | 'measure' | 'pan' | 'resize';
    startPx: number;
    curPx: number;
    startY: number;
    moved: boolean;
    zoom0: [number, number];
    sep?: number;
    weights?: number[];
  } | null>(null);
  const lastUpRef = useRef({ t: 0, x: 0 });
  const hoverSepRef = useRef(-1);
  const dropRef = useRef<{ pane: number; newPane: boolean } | null>(null);

  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const xMode = useStore((s) => s.xMode);
  const zoom = useStore((s) => s.zoom);
  const dataVersion = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);
  const refColors = useStore((s) => s.settings.refColors);
  const distUnit = useStore((s) => s.settings.units.distance);
  const profiles = useStore((s) => s.settings.trackProfiles);
  const channelPropsAll = useStore((s) => activeWorkspace(s)?.channelProps);

  const showVar = (laps: SelectedLap[]) => config.showVariance && laps.length > 1;
  /** Weights for every pane, top to bottom (variance first when shown). */
  const allWeights = (laps: SelectedLap[]) => [
    ...(showVar(laps) ? [config.varianceWeight ?? DEFAULT_VARIANCE_WEIGHT] : []),
    ...config.panes.map((p) => p.weight),
  ];

  // ------------------------------------------------------------------ base layer
  const drawBase = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(baseRef.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    const st = useStore.getState();
    const laps = selectedLaps(st);
    const [v0, v1] = viewRange(st);
    const ref = laps[0];
    const weights = allWeights(laps);
    const totalW = weights.reduce((a, b) => a + b, 0);
    const plotH = h - TOP - BOTTOM;
    const L: Layout = { w, h, v0, v1, panes: [], laps };
    let y = TOP;
    let wi = 0;
    const mkPane = (kind: PaneLayout['kind'], index: number): PaneLayout => {
      const ph = (weights[wi++] / Math.max(0.0001, totalW)) * plotH;
      const p: PaneLayout = { kind, index, top: y, bottom: y + ph, traces: [], vMin: 0, vMax: 1, legendRows: [] };
      y += ph;
      return p;
    };
    if (showVar(laps)) L.panes.push(mkPane('variance', -1));
    config.panes.forEach((_, i) => L.panes.push(mkPane('channels', i)));
    layoutRef.current = L;

    const px = (x: number) => pxOf(L, x);
    const plotL = LEFT;
    const plotR = w - RIGHT;
    ctx.font = T.font;
    ctx.textBaseline = 'middle';

    if (!laps.length) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText('Open a session and select a lap to see traces', w / 2, h / 2);
      return;
    }

    // ---- x axis labels (no vertical grid lines: sector and corner markers are the reference lines) ----
    const { step: xStep, ticks: xTicks } = niceTicks(v0, v1, Math.max(3, Math.floor((plotR - plotL) / 90)));
    ctx.fillStyle = T.text3;
    ctx.textAlign = 'center';
    for (const t of xTicks) ctx.fillText(xMode === 'time' ? formatAxisTime(t, xStep) : formatAxisDistance(t, xStep, distUnit), px(t), h - BOTTOM / 2);
    ctx.textAlign = 'right';
    ctx.fillText(xMode === 'time' ? (ref.lap.index === -1 ? 'session time' : 'lap time') : distUnit, plotL - 6, h - BOTTOM / 2);

    // ---- sector / section / corner markers (colour-coded, low opacity; labels along the top) ----
    if (ref.lap.index !== -1) {
      const prof = trackProfile(ref.session.meta.venue);
      const pal = CATEGORICAL[theme];
      const markers: { x: number; label: string; color: string }[] = [];
      const toX = (d: number) => (xMode === 'distance' ? d : crossingTime(ref.lap, d) - ref.lap.start);
      if (config.showSectors) ref.session.sectorSplits.forEach((d, i) => markers.push({ x: toX(d), label: `S${i + 2}`, color: pal[6] }));
      if (config.showSplits ?? config.showSectors) prof.sections.forEach((s) => markers.push({ x: toX(s.dist), label: s.name, color: pal[2] }));
      // Corners are always a single line at the apex (whatever their range).
      if (config.showCorners) prof.corners.forEach((c) => markers.push({ x: toX(c.dist), label: c.name, color: pal[3] }));
      ctx.lineWidth = 1;
      for (const m of markers) {
        if (!Number.isFinite(m.x) || m.x < v0 || m.x > v1) continue;
        const X = Math.round(px(m.x)) + 0.5;
        ctx.strokeStyle = withAlpha(m.color, 0.45);
        ctx.beginPath();
        ctx.moveTo(X, TOP);
        ctx.lineTo(X, h - BOTTOM);
        ctx.stroke();
      }
      // Labels sit at the top of the first pane (the variance pane when it is shown).
      ctx.font = `600 ${T.font}`;
      ctx.textAlign = 'center';
      for (const m of markers) {
        if (!Number.isFinite(m.x) || m.x < v0 || m.x > v1) continue;
        const X = px(m.x);
        const tw = ctx.measureText(m.label).width + 8;
        ctx.fillStyle = withAlpha(m.color, 0.22);
        ctx.fillRect(X - tw / 2, TOP + 1, tw, 14);
        ctx.fillStyle = T.text;
        ctx.fillText(m.label, X, TOP + 8);
      }
      ctx.font = T.font;
    }

    // ---- panes ----
    for (const P of L.panes) {
      const ph = P.bottom - P.top;
      ctx.strokeStyle = T.border;
      ctx.beginPath();
      ctx.moveTo(plotL, Math.round(P.bottom) + 0.5);
      ctx.lineTo(plotR, Math.round(P.bottom) + 0.5);
      ctx.stroke();

      if (P.kind === 'variance') {
        let mx = 0.1;
        const vars = laps.slice(1).map((l) => ({ l, v: computeVariance(ref.lap, l.lap) }));
        for (const { v } of vars) {
          const xs = xMode === 'distance' ? v.dist : v.refTime;
          const a = Math.max(0, lowerBound(xs, v0) - 1);
          const b = Math.min(xs.length - 1, lowerBound(xs, v1));
          for (let i = a; i <= b; i++) mx = Math.max(mx, Math.abs(v.delta[i]));
        }
        mx *= 1.12;
        P.vMin = -mx;
        P.vMax = mx;
        const py = (val: number) => P.top + 6 + ((P.vMax - val) / (P.vMax - P.vMin)) * (ph - 12);
        drawYAxis(ctx, T, P, py, -mx, mx, config.showGrid !== false);
        // Zero line: clearly visible so you can see at a glance which side of the reference a lap is on.
        ctx.strokeStyle = withAlpha(T.text, 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plotL, Math.round(py(0)) + 0.5);
        ctx.lineTo(plotR, Math.round(py(0)) + 0.5);
        ctx.stroke();
        ctx.save();
        ctx.beginPath();
        ctx.rect(plotL, P.top, plotR - plotL, ph);
        ctx.clip();
        for (const { l, v } of vars) {
          ctx.strokeStyle = l.color;
          ctx.lineWidth = 1.5;
          drawTrace(ctx, { xs: xMode === 'distance' ? v.dist : v.refTime, data: v.delta, off: 0, k: 1, b: 0, x0: v0, x1: v1, px, py, step: false });
        }
        ctx.restore();
        continue;
      }

      const cfg = config.panes[P.index];
      const colors = channelColors(cfg.channels, theme, channelPropsAll ?? {});
      const traces: TraceInfo[] = cfg.channels.map((name, ci) => {
        let mn = Infinity,
          mx = -Infinity,
          present = false,
          unit = '',
          dps = 2,
          k = 1,
          b = 0;
        for (const l of laps) {
          const ch = l.session.channels.get(name);
          if (!ch) continue;
          present = true;
          const c = conv(ch);
          k = c.k;
          b = c.b;
          unit = c.unit;
          dps = channelDps(ch);
          const r = config.yRange === 'visible' ? visibleRange(l, ch, v0, v1, xMode) : lapRange(l.lap, ch);
          if (!r) continue;
          mn = Math.min(mn, r[0] * k + b);
          mx = Math.max(mx, r[1] * k + b);
          if (ch.discrete) {
            mn = Math.min(mn, Math.floor(r[0] * k + b));
            mx = Math.max(mx, Math.ceil(r[1] * k + b));
          }
        }
        const props = channelPropsAll?.[name];
        if (props?.min != null) mn = props.min;
        if (props?.max != null) mx = props.max;
        if (!Number.isFinite(mn)) {
          mn = 0;
          mx = 1;
        }
        if (mx - mn < 1e-9) {
          mn -= 1;
          mx += 1;
        }
        return { name, color: colors[ci], unit, dps, k, b, min: mn, max: mx, present, hidden: !!cfg.hidden?.includes(name) };
      });
      // Hidden channels don't take part in the scale (unless every channel is hidden).
      const scaled = traces.some((t) => !t.hidden) ? traces.filter((t) => !t.hidden) : traces;
      const units = new Set(scaled.filter((t) => t.present).map((t) => t.unit));
      const shared = cfg.scale === 'shared' || (cfg.scale === 'auto' && units.size <= 1);
      if (shared) {
        let mn = Math.min(...scaled.map((t) => t.min));
        let mx = Math.max(...scaled.map((t) => t.max));
        if (cfg.min != null) mn = cfg.min;
        if (cfg.max != null) mx = cfg.max;
        if (!Number.isFinite(mn)) (mn = 0), (mx = 1);
        traces.forEach((t) => {
          t.min = mn;
          t.max = mx;
        });
      }
      for (const t of traces) {
        const pad = (t.max - t.min) * 0.06;
        t.min -= pad;
        t.max += pad;
      }
      P.traces = traces;
      const first = traces.find((t) => t.present && !t.hidden) ?? traces.find((t) => t.present) ?? traces[0];
      if (first) {
        P.vMin = first.min;
        P.vMax = first.max;
        drawYAxis(ctx, T, P, (v) => P.top + ((first.max - v) / (first.max - first.min)) * ph, first.min, first.max, config.showGrid !== false);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(plotL, P.top, plotR - plotL, ph);
      ctx.clip();
      ctx.lineJoin = 'round';
      // Overlays first (solid, lap colour), reference on top.
      const order = laps.slice(1).concat(laps.slice(0, 1));
      for (const t of traces) {
        if (t.hidden) continue;
        const py = (v: number) => P.top + ((t.max - v) / (t.max - t.min)) * ph;
        for (const l of order) {
          const ch = l.session.channels.get(t.name);
          if (!ch) continue;
          const ser = lapSeries(l.lap, ch, xMode);
          const isRef = l === laps[0];
          ctx.strokeStyle = isRef ? (refColors === 'channel' ? t.color : l.color) : l.color;
          ctx.lineWidth = isRef ? config.refLineWidth ?? 1.5 : config.lapLineWidth ?? 1.2;
          drawTrace(ctx, { xs: ser.xs, data: displayData(ch), off: ser.i0, k: t.k, b: t.b, x0: v0, x1: v1, px, py, step: ch.discrete });
        }
      }
      ctx.restore();
    }

    ctx.strokeStyle = T.border;
    ctx.beginPath();
    ctx.moveTo(plotL + 0.5, TOP);
    ctx.lineTo(plotL + 0.5, h - BOTTOM);
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, sessions, lapSel, refKey, xMode, zoom, dataVersion, theme, refColors, distUnit, channelPropsAll, profiles]);

  // ------------------------------------------------------------------ overlay layer
  const drawOverlay = useCallback(() => {
    const L = layoutRef.current;
    const { w, h } = size;
    const ctx = prepCanvas(overRef.current, w, h);
    if (!ctx || !L) return;
    const T = chartTheme();
    const st = useStore.getState();
    const { cursor, measure } = st;
    const mode = st.xMode;
    const laps = L.laps;
    const px = (x: number) => pxOf(L, x);
    ctx.font = T.font;
    ctx.textBaseline = 'middle';

    // pane resize handle highlight
    const hs = hoverSepRef.current;
    if (hs >= 0 && L.panes[hs]) {
      ctx.fillStyle = withAlpha(T.accent, 0.55);
      ctx.fillRect(LEFT, Math.round(L.panes[hs].bottom) - 1, w - LEFT - RIGHT, 3);
    }

    if (measure) {
      const a = px(Math.min(measure[0], measure[1]));
      const b = px(Math.max(measure[0], measure[1]));
      ctx.fillStyle = withAlpha(T.accent, 0.1);
      ctx.fillRect(a, TOP, b - a, h - TOP - BOTTOM);
      ctx.strokeStyle = withAlpha(T.accent, 0.6);
      ctx.beginPath();
      ctx.moveTo(Math.round(a) + 0.5, TOP);
      ctx.lineTo(Math.round(a) + 0.5, h - BOTTOM);
      ctx.moveTo(Math.round(b) + 0.5, TOP);
      ctx.lineTo(Math.round(b) + 0.5, h - BOTTOM);
      ctx.stroke();
      const span = Math.abs(measure[1] - measure[0]);
      ctx.fillStyle = T.text;
      ctx.textAlign = 'center';
      ctx.fillText(mode === 'time' ? `Δ ${span.toFixed(3)} s` : `Δ ${span.toFixed(1)} m`, (a + b) / 2, TOP + 9);
    }
    const d = dragRef.current;
    if (d && d.moved && (d.mode === 'select' || d.mode === 'measure')) {
      const a = Math.min(d.startPx, d.curPx);
      const b = Math.max(d.startPx, d.curPx);
      ctx.fillStyle = d.mode === 'select' ? withAlpha(T.text, 0.08) : withAlpha(T.accent, 0.12);
      ctx.fillRect(a, TOP, b - a, h - TOP - BOTTOM);
      ctx.strokeStyle = withAlpha(T.text, 0.35);
      ctx.strokeRect(a + 0.5, TOP + 0.5, b - a, h - TOP - BOTTOM);
      if (d.mode === 'select') {
        ctx.fillStyle = T.text2;
        ctx.textAlign = 'center';
        ctx.fillText('release to zoom', (a + b) / 2, TOP + 9);
      }
    }
    const drop = dropRef.current;
    if (drop) {
      ctx.strokeStyle = T.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      if (drop.newPane) {
        ctx.strokeRect(LEFT + 2, h - BOTTOM - 26, w - LEFT - RIGHT - 4, 24);
        ctx.fillStyle = T.accent;
        ctx.textAlign = 'center';
        ctx.fillText('Drop to add as a new pane', w / 2, h - BOTTOM - 14);
      } else {
        const P = L.panes.find((p) => p.kind === 'channels' && p.index === drop.pane);
        if (P) ctx.strokeRect(LEFT + 2, P.top + 2, w - LEFT - RIGHT - 4, P.bottom - P.top - 4);
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    if (cursor != null && cursor >= L.v0 && cursor <= L.v1) {
      const X = Math.round(px(cursor)) + 0.5;
      // A pinned cursor (datum) is drawn in the accent colour.
      const cc = st.datum ? T.accent : T.cursor;
      ctx.strokeStyle = cc;
      ctx.lineWidth = st.datum ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(X, TOP);
      ctx.lineTo(X, h - BOTTOM);
      ctx.stroke();
      const label = (st.datum ? '⚑ datum ' : '') + (mode === 'time' ? formatAxisTime(cursor, 0.01) : `${cursor.toFixed(0)} m`);
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = cc;
      ctx.fillRect(X - tw / 2, h - BOTTOM + 2, tw, BOTTOM - 4);
      ctx.fillStyle = T.surface;
      ctx.textAlign = 'center';
      ctx.fillText(label, X, h - BOTTOM / 2);
    }

    // legends
    const refColorsMode = st.settings.refColors;
    for (const P of config.showLegend === false ? [] : L.panes) {
      const rows: LegendRow[] = [];
      if (P.kind === 'variance') {
        rows.push({
          name: '',
          swatch: T.text3,
          label: 'Time variance vs ref (s)',
          values: laps.slice(1).map((l) => {
            const dv = cursor != null ? varianceAt(computeVariance(laps[0].lap, l.lap), cursor, mode) : NaN;
            return { color: l.color, text: formatDelta(dv, 3) };
          }),
        });
      } else {
        for (const t of P.traces) {
          if (t.hidden) {
            // Still listed (dimmed, hollow swatch) so it can be clicked back on.
            rows.push({ name: t.name, swatch: refColorsMode === 'channel' ? t.color : laps[0].color, label: `${channelLabel(t.name)} — hidden`, values: [], hidden: true });
            continue;
          }
          const values: LegendValue[] = [];
          let refVal = NaN;
          for (const l of laps) {
            const ch = l.session.channels.get(t.name);
            const isRef = l === laps[0];
            const color = isRef ? (refColorsMode === 'channel' ? t.color : l.color) : l.color;
            let text = ch ? '—' : 'n/a';
            let delta: string | undefined;
            if (ch && measure && isRef) {
              const ta = xToTime(l.lap, Math.min(measure[0], measure[1]), mode);
              const tb = xToTime(l.lap, Math.max(measure[0], measure[1]), mode);
              const s = rangeStats(ch.data, Math.max(0, Math.ceil((ta - ch.t0) * ch.rate)), Math.min(ch.n - 1, Math.floor((tb - ch.t0) * ch.rate)));
              const f = (v: number) => formatValue(v * t.k + t.b, t.dps);
              text = `min ${f(s.min)}  avg ${f(s.mean)}  max ${f(s.max)}  Δ ${formatValue((s.last - s.first) * t.k, t.dps)}`;
            } else if (ch && cursor != null) {
              const tt = xToTime(l.lap, cursor, mode);
              if (l.lap.index === -1 || (tt >= l.lap.start - 0.3 && tt <= l.lap.end + 0.3)) {
                const v = valueAt(ch, displayData(ch), tt) * t.k + t.b;
                text = formatValue(v, t.dps);
                if (isRef) refVal = v;
                else if (Number.isFinite(refVal) && Number.isFinite(v)) {
                  const dv = v - refVal;
                  delta = `Δ${dv >= 0 ? '+' : '−'}${Math.abs(dv).toFixed(t.dps)}`;
                }
              }
            }
            values.push({ color, text, delta });
            if (measure && isRef) break;
          }
          rows.push({
            name: t.name,
            swatch: refColorsMode === 'channel' ? t.color : laps[0].color,
            label: channelLabel(t.name) + (t.unit ? ` [${t.unit}]` : '') + (t.present ? '' : ' — not in session'),
            values: laps.length === 1 || measure ? values.slice(0, 1).map((v) => ({ ...v, color: '' })) : values,
          });
        }
      }
      // Leave room for the marker labels along the top of the first pane.
      const labelRoom = P === L.panes[0] && (config.showSectors || (config.showSplits ?? config.showSectors) || config.showCorners) ? 16 : 0;
      drawLegend(ctx, T, P, rows, labelRoom);
    }
  }, [size, config.showLegend, config.showSectors, config.showSplits, config.showCorners]);

  useEffect(() => {
    drawBase();
    drawOverlay();
  }, [drawBase, drawOverlay]);
  useStoreListener(drawOverlay, [drawOverlay]);

  // ------------------------------------------------------------------ interaction
  const local = (e: { clientX: number; clientY: number }) => {
    const r = overRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const paneAtY = (y: number) => layoutRef.current?.panes.find((p) => y >= p.top && y < p.bottom);
  /** Index i of the border between panes i and i+1 under y (any pane, incl. variance), or -1. */
  const separatorAt = (y: number) => {
    const L = layoutRef.current;
    if (!L) return -1;
    for (let i = 0; i < L.panes.length - 1; i++) if (Math.abs(L.panes[i].bottom - y) <= 5) return i;
    return -1;
  };
  const xIn = (L: Layout, x: number) => Math.max(LEFT, Math.min(L.w - RIGHT, x));
  /** The channel whose legend name is under (x, y), with its pane index. */
  const legendHit = (x: number, y: number) => {
    if (config.showLegend === false) return null;
    const P = paneAtY(y);
    if (!P || P.kind !== 'channels') return null;
    const row = P.legendRows.find((r) => r.name && y >= r.y && y < r.y + r.h && x >= LEFT && x <= r.x1 + 4);
    return row ? { pane: P.index, name: row.name } : null;
  };
  /** Show / hide a channel in its pane without removing it. */
  const toggleHidden = (pane: number, name: string) => {
    const panes = config.panes.map((p, i) => {
      if (i !== pane) return p;
      const hidden = p.hidden ?? [];
      return { ...p, hidden: hidden.includes(name) ? hidden.filter((n) => n !== name) : [...hidden, name] };
    });
    updateComponent(config.id, { panes } as Partial<GraphConfig>, 'Show / hide channel');
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const L = layoutRef.current;
    if (!L || !L.laps.length) return;
    const { x, y } = local(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const zoom0 = viewRange();
    // Click a channel's name in the legend to show / hide it.
    const hit = e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey ? legendHit(x, y) : null;
    if (hit) {
      toggleHidden(hit.pane, hit.name);
      return;
    }
    const sep = separatorAt(y);
    if (e.button === 0 && sep >= 0) {
      dragRef.current = { mode: 'resize', startPx: x, curPx: x, startY: y, moved: false, zoom0, sep, weights: allWeights(L.laps) };
      return;
    }
    if (e.button === 1 || e.button === 2 || e.ctrlKey || e.metaKey) {
      dragRef.current = { mode: 'pan', startPx: x, curPx: x, startY: y, moved: false, zoom0 };
      return;
    }
    if (e.shiftKey) {
      dragRef.current = { mode: 'measure', startPx: x, curPx: x, startY: y, moved: false, zoom0 };
      return;
    }
    const isDouble = performance.now() - lastUpRef.current.t < DOUBLE_CLICK_MS && Math.abs(x - lastUpRef.current.x) < 8;
    if (useStore.getState().settings.cursorMode !== 'scrub') {
      // Classic (MoTeC) mode: drag zooms, click places the cursor, double-click resets the zoom.
      if (isDouble) {
        lastUpRef.current = { t: 0, x: 0 };
        setZoom(null);
        return;
      }
      dragRef.current = { mode: 'select', startPx: x, curPx: x, startY: y, moved: false, zoom0 };
      return;
    }
    // Scrub mode: drag moves the cursor; second press of a double-click → drag selects a zoom range.
    dragRef.current = { mode: isDouble ? 'select' : 'scrub', startPx: x, curPx: x, startY: y, moved: false, zoom0 };
    if (!isDouble) {
      setMeasure(null);
      setCursor(xOfPx(L, xIn(L, x)));
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const L = layoutRef.current;
    if (!L) return;
    const { x, y } = local(e);
    const d = dragRef.current;
    const el = overRef.current!;
    if (!d) {
      const sep = separatorAt(y);
      if (sep !== hoverSepRef.current) {
        hoverSepRef.current = sep;
        drawOverlay();
      }
      el.style.cursor = sep >= 0 ? 'row-resize' : legendHit(x, y) ? 'pointer' : 'crosshair';
      if (useStore.getState().settings.cursorMode === 'hover' && x >= LEFT && x <= L.w - RIGHT) setCursor(xOfPx(L, x));
      return;
    }
    d.curPx = x;
    if (Math.abs(x - d.startPx) > 3 || Math.abs(y - d.startY) > 3) d.moved = true;
    if (d.mode === 'scrub') setCursor(xOfPx(L, xIn(L, x)));
    else if (d.mode === 'pan' && d.moved) {
      const span = d.zoom0[1] - d.zoom0[0];
      const dx = ((x - d.startPx) / (L.w - LEFT - RIGHT)) * span;
      setZoom([d.zoom0[0] - dx, d.zoom0[1] - dx]);
    } else if (d.mode === 'resize' && d.weights && d.sep != null) {
      const i = d.sep;
      const total = d.weights.reduce((a, b) => a + b, 0);
      const plotH = L.h - TOP - BOTTOM;
      const dw = ((y - d.startY) / plotH) * total;
      const pairTotal = d.weights[i] + d.weights[i + 1];
      const minW = total * 0.04;
      const a = Math.max(minW, Math.min(pairTotal - minW, d.weights[i] + dw));
      const next = d.weights.slice();
      next[i] = a;
      next[i + 1] = pairTotal - a;
      const hasVar = showVar(L.laps);
      const paneWeights = hasVar ? next.slice(1) : next;
      updateComponent(
        config.id,
        { panes: config.panes.map((p, k) => ({ ...p, weight: paneWeights[k] })), ...(hasVar ? { varianceWeight: next[0] } : {}) } as Partial<GraphConfig>,
        'Resize pane',
      );
    } else drawOverlay();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const L = layoutRef.current;
    const d = dragRef.current;
    dragRef.current = null;
    if (!L || !d) return;
    const { x } = local(e);
    if ((d.mode === 'select' || d.mode === 'measure') && d.moved && Math.abs(x - d.startPx) > 4) {
      const a = xOfPx(L, xIn(L, Math.min(d.startPx, x)));
      const b = xOfPx(L, xIn(L, Math.max(d.startPx, x)));
      if (d.mode === 'select') setZoom([a, b]);
      else setMeasure([a, b]);
    }
    const classic = useStore.getState().settings.cursorMode !== 'scrub';
    if (classic && d.mode === 'select' && !d.moved && e.button === 0) {
      setMeasure(null);
      setCursor(xOfPx(L, xIn(L, x)));
    }
    const plainClick = !d.moved && (d.mode === 'scrub' || (classic && d.mode === 'select'));
    lastUpRef.current = plainClick ? { t: performance.now(), x } : { t: 0, x: 0 };
    drawOverlay();
  };

  useEffect(() => {
    const el = overRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const L = layoutRef.current;
      if (!L || !L.laps.length) return;
      e.preventDefault();
      const [a, b] = viewRange();
      const span = b - a;
      const r = el.getBoundingClientRect();
      const mx = xOfPx(L, e.clientX - r.left);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        const dx = ((e.shiftKey ? e.deltaY : e.deltaX) / (L.w - LEFT - RIGHT)) * span;
        setZoom([a + dx, b + dx]);
      } else {
        const f = Math.pow(1.0015, e.deltaY);
        setZoom([mx - (mx - a) * f, mx + (b - mx) * f]);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const addChannel = (name: string, paneIdx: number | 'new') => {
    const panes = config.panes.map((p) => ({ ...p, channels: p.channels.slice() }));
    if (paneIdx === 'new' || !panes[paneIdx]) panes.push(newPane([name]));
    else if (!panes[paneIdx].channels.includes(name)) panes[paneIdx].channels.push(name);
    updateComponent(config.id, { panes } as Partial<GraphConfig>, 'Add channel');
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const st = useStore.getState();
    const canMark = st.cursor != null && !!selectedLaps(st)[0] && selectedLaps(st)[0].lap.index !== -1;
    // Kept deliberately short (channels are added by dragging them from the sidebar); everything else
    // lives in Properties (appended by the frame).
    openMenu(e, [
      { label: 'Sector lines (S2, S3…)', checked: config.showSectors, shortcut: keyHint('toggle-sectors'), onClick: () => setGraphMarkers({ showSectors: !config.showSectors }) },
      {
        label: 'Split lines (your splits)',
        checked: config.showSplits ?? config.showSectors,
        shortcut: keyHint('toggle-splits'),
        onClick: () => setGraphMarkers({ showSplits: !(config.showSplits ?? config.showSectors) }),
      },
      { label: 'Corner lines', checked: config.showCorners, shortcut: keyHint('toggle-corners'), onClick: () => setGraphMarkers({ showCorners: !config.showCorners }) },
      { separator: true },
      { label: st.datum ? 'Release datum' : 'Set datum at cursor', checked: st.datum, disabled: !st.datum && st.cursor == null, shortcut: keyHint('toggle-datum'), onClick: toggleDatum },
      { separator: true },
      { label: 'Add corner at cursor…', disabled: !canMark, shortcut: keyHint('add-corner'), onClick: () => markAtCursor('corner') },
      { label: 'Add split at cursor…', disabled: !canMark, shortcut: keyHint('add-split'), onClick: () => markAtCursor('split') },
      { label: 'Edit corners & track…', shortcut: keyHint('track-profile'), onClick: openTrackEditor },
    ]);
  };

  const dropTarget = (e: React.DragEvent) => {
    const { y } = local(e);
    const L = layoutRef.current;
    if (!L) return { pane: -1, newPane: true };
    const P = paneAtY(y);
    const newPaneZone = e.shiftKey || y > L.h - BOTTOM - 26 || !P || P.kind !== 'channels';
    return { pane: P && P.kind === 'channels' ? P.index : -1, newPane: newPaneZone };
  };

  return (
    <div
      ref={wrapRef}
      className="chart"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-pt-channel')) return;
        e.preventDefault();
        e.stopPropagation();
        dropRef.current = dropTarget(e);
        drawOverlay();
      }}
      onDragLeave={() => {
        dropRef.current = null;
        drawOverlay();
      }}
      onDrop={(e) => {
        const name = e.dataTransfer.getData('application/x-pt-channel');
        const t = dropTarget(e);
        dropRef.current = null;
        if (!name) return;
        e.preventDefault();
        e.stopPropagation();
        addChannel(name, t.newPane ? 'new' : t.pane);
      }}
    >
      <canvas ref={baseRef} />
      <canvas
        ref={overRef}
        style={{ cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          if (hoverSepRef.current >= 0 && !dragRef.current) {
            hoverSepRef.current = -1;
            drawOverlay();
          }
        }}
      />
    </div>
  );
}

function drawYAxis(ctx: CanvasRenderingContext2D, T: ReturnType<typeof chartTheme>, P: PaneLayout, py: (v: number) => number, mn: number, mx: number, grid = true) {
  const ph = P.bottom - P.top;
  const { step, ticks } = niceTicks(mn, mx, Math.max(2, Math.floor(ph / 26)));
  if (grid) {
    ctx.strokeStyle = T.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const w = ctx.canvas.width / (window.devicePixelRatio || 1);
    for (const t of ticks) {
      const Y = Math.round(py(t)) + 0.5;
      if (Y < P.top + 2 || Y > P.bottom - 2) continue;
      ctx.moveTo(LEFT, Y);
      ctx.lineTo(w - RIGHT, Y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = T.text3;
  ctx.textAlign = 'right';
  for (const t of ticks) {
    const Y = py(t);
    if (Y < P.top + 6 || Y > P.bottom - 6) continue;
    ctx.fillText(fmtTick(t, step), LEFT - 6, Y);
  }
}

interface LegendValue {
  color: string;
  text: string;
  delta?: string;
}
interface LegendRow {
  /** Channel name ('' for the variance row). */
  name: string;
  swatch: string;
  label: string;
  values: LegendValue[];
  hidden?: boolean;
}

function drawLegend(ctx: CanvasRenderingContext2D, T: ReturnType<typeof chartTheme>, P: PaneLayout, rows: LegendRow[], offset = 0) {
  P.legendRows = [];
  if (!rows.length) return;
  const rowH = 15;
  const maxRows = Math.max(1, Math.floor((P.bottom - P.top - 6 - offset) / rowH));
  const shown = rows.slice(0, maxRows);
  ctx.font = T.font;
  let wMax = 0;
  const measured = shown.map((r) => {
    const lw = ctx.measureText(r.label).width;
    ctx.font = T.mono;
    const vw = r.values.reduce((a, v) => a + ctx.measureText(v.text + (v.delta ? ' ' + v.delta : '')).width + (v.color ? 18 : 10), 0);
    ctx.font = T.font;
    wMax = Math.max(wMax, lw + vw + 24);
    return { lw };
  });
  const x0 = LEFT + 6;
  const y0 = P.top + 4 + offset;
  ctx.fillStyle = withAlpha(T.surface.startsWith('#') ? T.surface : '#15181d', 0.82);
  ctx.fillRect(x0 - 3, y0 - 1, Math.min(wMax + 6, ctx.canvas.width), shown.length * rowH + 3);
  shown.forEach((r, i) => {
    const y = y0 + i * rowH + rowH / 2;
    P.legendRows.push({ y: y0 + i * rowH, h: rowH, x1: x0 + 13 + measured[i].lw, name: r.name });
    if (r.hidden) {
      ctx.strokeStyle = r.swatch;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, y - 3.5, 7, 7);
    } else {
      ctx.fillStyle = r.swatch;
      ctx.fillRect(x0, y - 4, 8, 8);
    }
    ctx.fillStyle = r.hidden ? T.text3 : T.text2;
    ctx.textAlign = 'left';
    ctx.font = T.font;
    ctx.fillText(r.label, x0 + 13, y);
    let x = x0 + 13 + measured[i].lw + 10;
    for (const v of r.values) {
      ctx.font = T.mono;
      // Each lap's value sits on a translucent background in that lap's colour.
      const tw = ctx.measureText(v.text).width + (v.delta ? ctx.measureText(' ' + v.delta).width : 0);
      if (v.color) {
        ctx.fillStyle = withAlpha(v.color, 0.3);
        ctx.fillRect(x, y - rowH / 2 + 1, tw + 8, rowH - 2);
        x += 4;
      }
      ctx.fillStyle = T.text;
      ctx.fillText(v.text, x, y);
      x += ctx.measureText(v.text).width;
      if (v.delta) {
        ctx.fillStyle = T.text2;
        ctx.fillText(' ' + v.delta, x, y);
        x += ctx.measureText(' ' + v.delta).width;
      }
      x += v.color ? 10 : 6;
      ctx.font = T.font;
    }
  });
  if (rows.length > shown.length) {
    ctx.fillStyle = T.text3;
    ctx.fillText(`+${rows.length - shown.length} more`, x0 + 13, y0 + shown.length * rowH + 6);
  }
}
