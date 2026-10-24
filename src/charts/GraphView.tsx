// Time / Distance graph — the core MoTeC-style component.
//  • Panes stacked vertically share the x-axis; channels with the same unit share a y-scale.
//  • Every selected lap is overlaid; the reference lap is drawn last and solid.
//  • Optional time-variance pane (Δ vs reference) at the top.
//  • Click = cursor, drag = zoom, Shift+drag = measure range, wheel = zoom, right/middle-drag = pan,
//    double-click = reset zoom. Drag channels in from the sidebar to add them.

import { useCallback, useEffect, useRef } from 'react';
import { computeVariance, lapSeries, varianceAt, xToTime } from '../core/axis';
import { CATEGORICAL, channelColors, LAP_DASHES, withAlpha } from '../core/colors';
import { detectCorners } from '../core/corners';
import { formatAxisDistance, formatAxisTime, formatDelta, formatValue } from '../core/format';
import { crossingTime } from '../core/session';
import { rangeStats, niceTicks } from '../core/stats';
import type { ChannelInfo } from '../core/types';
import { pane as newPane } from '../state/components';
import {
  activeWorkspace,
  selectedLaps,
  setChannelProps,
  setCursor,
  setMeasure,
  setZoom,
  trackProfile,
  updateComponent,
  useStore,
  viewRange,
  type SelectedLap,
} from '../state/store';
import type { GraphConfig, GraphPane } from '../state/workspace';
import { openChannelPicker, openChannelProps, openMenu } from '../ui/overlays';
import { chartTheme, drawTrace, fmtTick, lowerBound, prepCanvas, useElementSize, useStoreListener } from './canvas';
import { channelDps, conv, lapRange } from './data';

const LEFT = 54;
const RIGHT = 10;
const TOP = 4;
const BOTTOM = 22;
const VARIANCE_WEIGHT = 0.55;

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
}

interface PaneLayout {
  kind: 'variance' | 'channels';
  index: number; // index into config.panes (-1 for variance)
  top: number;
  bottom: number;
  traces: TraceInfo[];
  colorByLap: boolean;
  shared: boolean;
  vMin: number;
  vMax: number;
  legendRows: { y: number; h: number; name: string }[];
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

export function GraphView({ config }: { config: GraphConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<Layout | null>(null);
  const dragRef = useRef<{
    mode: 'select' | 'measure' | 'pan' | 'resize';
    startPx: number;
    curPx: number;
    startY: number;
    moved: boolean;
    zoom0: [number, number];
    paneIdx?: number;
    weights?: number[];
  } | null>(null);
  const dropRef = useRef<{ pane: number; newPane: boolean } | null>(null);

  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const xMode = useStore((s) => s.xMode);
  const zoom = useStore((s) => s.zoom);
  const dataVersion = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);
  const overlayStyle = useStore((s) => s.settings.overlayStyle);
  const distUnit = useStore((s) => s.settings.units.distance);
  const channelPropsAll = useStore((s) => activeWorkspace(s)?.channelProps);

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
    const panesCfg = config.panes;
    const showVar = config.showVariance && laps.length > 1;
    const totalW = panesCfg.reduce((a, p) => a + p.weight, 0) + (showVar ? VARIANCE_WEIGHT : 0);
    const plotH = h - TOP - BOTTOM;
    const L: Layout = { w, h, v0, v1, panes: [], laps };
    let y = TOP;
    const mkPane = (kind: PaneLayout['kind'], index: number, weight: number): PaneLayout => {
      const ph = (weight / Math.max(0.0001, totalW)) * plotH;
      const p: PaneLayout = { kind, index, top: y, bottom: y + ph, traces: [], colorByLap: false, shared: true, vMin: 0, vMax: 1, legendRows: [] };
      y += ph;
      return p;
    };
    if (showVar) L.panes.push(mkPane('variance', -1, VARIANCE_WEIGHT));
    panesCfg.forEach((p, i) => L.panes.push(mkPane('channels', i, p.weight)));
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

    // ---- x grid ----
    const { step: xStep, ticks: xTicks } = niceTicks(v0, v1, Math.max(3, Math.floor((plotR - plotL) / 90)));
    ctx.strokeStyle = T.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of xTicks) {
      const X = Math.round(px(t)) + 0.5;
      ctx.moveTo(X, TOP);
      ctx.lineTo(X, h - BOTTOM);
    }
    ctx.stroke();
    ctx.fillStyle = T.text3;
    ctx.textAlign = 'center';
    for (const t of xTicks) {
      const label = xMode === 'time' ? formatAxisTime(t, xStep) : formatAxisDistance(t, xStep, distUnit);
      ctx.fillText(label, px(t), h - BOTTOM / 2);
    }
    ctx.textAlign = 'right';
    ctx.fillText(xMode === 'time' ? (ref.lap.index === -1 ? 'session time' : 'lap time') : distUnit, plotL - 6, h - BOTTOM / 2);

    // ---- sector / section / corner markers ----
    if (ref.lap.index !== -1) {
      const markers: { x: number; label: string; strong: boolean }[] = [];
      const toX = (d: number) => (xMode === 'distance' ? d : crossingTime(ref.lap, d) - ref.lap.start);
      if (config.showSectors) {
        ref.session.sectorSplits.forEach((d, i) => markers.push({ x: toX(d), label: `S${i + 2}`, strong: true }));
        trackProfile(ref.session.meta.venue).sections.forEach((s) => markers.push({ x: toX(s.dist), label: s.name, strong: false }));
      }
      if (config.showCorners) {
        const names = trackProfile(ref.session.meta.venue).cornerNames;
        detectCorners(ref.session, ref.lap).forEach((c) => markers.push({ x: toX(c.apex), label: names[c.name] || c.name, strong: false }));
      }
      for (const m of markers) {
        if (!Number.isFinite(m.x) || m.x < v0 || m.x > v1) continue;
        const X = Math.round(px(m.x)) + 0.5;
        ctx.strokeStyle = m.strong ? T.gridStrong : T.grid;
        ctx.setLineDash(m.strong ? [4, 3] : [2, 3]);
        ctx.beginPath();
        ctx.moveTo(X, TOP);
        ctx.lineTo(X, h - BOTTOM);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = T.text3;
        ctx.textAlign = 'left';
        ctx.fillText(m.label, X + 3, h - BOTTOM - 7);
      }
    }

    // ---- panes ----
    for (const P of L.panes) {
      const ph = P.bottom - P.top;
      // pane separator
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
        drawYAxis(ctx, T, P, py, -mx, mx, 's');
        ctx.strokeStyle = T.gridStrong;
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
          ctx.setLineDash(laps.length > 4 ? LAP_DASHES[l.slot % 8] : []);
          drawTrace(ctx, { xs: xMode === 'distance' ? v.dist : v.refTime, data: v.delta, off: 0, k: 1, b: 0, x0: v0, x1: v1, px, py, step: false });
        }
        ctx.setLineDash([]);
        ctx.restore();
        continue;
      }

      const cfg = panesCfg[P.index];
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
        return { name, color: colors[ci], unit, dps, k, b, min: mn, max: mx, present };
      });
      const units = new Set(traces.filter((t) => t.present).map((t) => t.unit));
      P.shared = cfg.scale === 'shared' || (cfg.scale === 'auto' && units.size <= 1);
      P.colorByLap = laps.length > 1 && (overlayStyle === 'lap' || (overlayStyle === 'auto' && cfg.channels.length === 1));
      if (P.shared) {
        let mn = Math.min(...traces.map((t) => t.min));
        let mx = Math.max(...traces.map((t) => t.max));
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
      const first = traces.find((t) => t.present) ?? traces[0];
      if (first) {
        P.vMin = first.min;
        P.vMax = first.max;
        const py = (v: number) => P.top + ((first.max - v) / (first.max - first.min)) * ph;
        drawYAxis(ctx, T, P, py, first.min, first.max, first.unit);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(plotL, P.top, plotR - plotL, ph);
      ctx.clip();
      ctx.lineJoin = 'round';
      // Overlays first, reference on top.
      const order = laps.slice(1).concat(laps.slice(0, 1));
      for (const t of traces) {
        const py = (v: number) => P.top + ((t.max - v) / (t.max - t.min)) * ph;
        for (const l of order) {
          const ch = l.session.channels.get(t.name);
          if (!ch) continue;
          const ser = lapSeries(l.lap, ch, xMode);
          const isRef = l === laps[0];
          if (laps.length === 1) {
            ctx.strokeStyle = t.color;
            ctx.lineWidth = 1.4;
            ctx.setLineDash([]);
          } else if (P.colorByLap) {
            ctx.strokeStyle = l.color;
            ctx.lineWidth = isRef ? 1.6 : 1.25;
            ctx.setLineDash(laps.length > 3 ? LAP_DASHES[l.slot % 8] : []);
          } else {
            ctx.strokeStyle = isRef ? t.color : withAlpha(t.color, 0.85);
            ctx.lineWidth = isRef ? 1.6 : 1.2;
            ctx.setLineDash(isRef ? [] : LAP_DASHES[Math.max(1, l.slot) % 8]);
          }
          drawTrace(ctx, { xs: ser.xs, data: ch.data, off: ser.i0, k: t.k, b: t.b, x0: v0, x1: v1, px, py, step: ch.discrete });
        }
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // outer frame line under x-axis
    ctx.strokeStyle = T.border;
    ctx.beginPath();
    ctx.moveTo(plotL + 0.5, TOP);
    ctx.lineTo(plotL + 0.5, h - BOTTOM);
    ctx.stroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, sessions, lapSel, refKey, xMode, zoom, dataVersion, theme, overlayStyle, distUnit, channelPropsAll]);

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

    // measure band
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
      const label = mode === 'time' ? `Δ ${span.toFixed(3)} s` : `Δ ${span.toFixed(1)} m`;
      ctx.fillStyle = T.text;
      ctx.textAlign = 'center';
      ctx.fillText(label, (a + b) / 2, TOP + 9);
    }
    // drag selection
    const d = dragRef.current;
    if (d && d.moved && (d.mode === 'select' || d.mode === 'measure')) {
      const a = Math.min(d.startPx, d.curPx);
      const b = Math.max(d.startPx, d.curPx);
      ctx.fillStyle = d.mode === 'select' ? withAlpha(T.text, 0.08) : withAlpha(T.accent, 0.12);
      ctx.fillRect(a, TOP, b - a, h - TOP - BOTTOM);
      ctx.strokeStyle = withAlpha(T.text, 0.35);
      ctx.strokeRect(a + 0.5, TOP + 0.5, b - a, h - TOP - BOTTOM);
    }
    // drop target
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

    // cursor line + dots
    const inView = cursor != null && cursor >= L.v0 && cursor <= L.v1;
    if (inView) {
      const X = Math.round(px(cursor!)) + 0.5;
      ctx.strokeStyle = T.cursor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X, TOP);
      ctx.lineTo(X, h - BOTTOM);
      ctx.stroke();
      ctx.fillStyle = T.cursor;
      ctx.textAlign = 'center';
      const label = mode === 'time' ? formatAxisTime(cursor!, 0.01) : `${cursor!.toFixed(0)} m`;
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = T.cursor;
      ctx.fillRect(X - tw / 2, h - BOTTOM + 2, tw, BOTTOM - 4);
      ctx.fillStyle = T.surface;
      ctx.fillText(label, X, h - BOTTOM / 2);
    }

    // legends
    for (const P of L.panes) {
      const rows: { swatch: string; dash: number[]; label: string; values: { color: string; dash: number[]; text: string }[] }[] = [];
      if (P.kind === 'variance') {
        rows.push({
          swatch: T.text3,
          dash: [],
          label: 'Time variance vs ref (s)',
          values: laps.slice(1).map((l) => {
            const v = computeVariance(laps[0].lap, l.lap);
            const dv = cursor != null ? varianceAt(v, cursor, mode) : NaN;
            return { color: l.color, dash: laps.length > 4 ? LAP_DASHES[l.slot % 8] : [], text: formatDelta(dv, 3) };
          }),
        });
      } else {
        for (const t of P.traces) {
          const values: { color: string; dash: number[]; text: string }[] = [];
          for (const l of laps) {
            const ch = l.session.channels.get(t.name);
            let text = '—';
            if (ch && measure && l === laps[0]) {
              const ta = xToTime(l.lap, Math.min(measure[0], measure[1]), mode);
              const tb = xToTime(l.lap, Math.max(measure[0], measure[1]), mode);
              const i0 = Math.max(0, Math.ceil((ta - ch.t0) * ch.rate));
              const i1 = Math.min(ch.n - 1, Math.floor((tb - ch.t0) * ch.rate));
              const s = rangeStats(ch.data, i0, i1);
              const f = (v: number) => formatValue(v * t.k + t.b, t.dps);
              text = `min ${f(s.min)}  avg ${f(s.mean)}  max ${f(s.max)}  Δ ${formatValue((s.last - s.first) * t.k, t.dps)}`;
            } else if (ch && cursor != null) {
              const tt = xToTime(l.lap, cursor, mode);
              if (l.lap.index === -1 || (tt >= l.lap.start - 0.3 && tt <= l.lap.end + 0.3)) {
                const f = (tt - ch.t0) * ch.rate;
                const i = Math.max(0, Math.min(ch.n - 1, ch.discrete ? Math.floor(f + 1e-6) : Math.round(f)));
                let v = ch.data[i];
                if (!ch.discrete) {
                  const i0 = Math.max(0, Math.min(ch.n - 2, Math.floor(f)));
                  const fr = Math.max(0, Math.min(1, f - i0));
                  v = ch.data[i0] + (ch.data[i0 + 1] - ch.data[i0]) * fr;
                }
                text = formatValue(v * t.k + t.b, t.dps);
              }
            } else if (!ch) text = 'n/a';
            const isRef = l === laps[0];
            values.push({
              color: laps.length === 1 ? t.color : P.colorByLap ? l.color : t.color,
              dash: laps.length === 1 ? [] : P.colorByLap ? (laps.length > 3 ? LAP_DASHES[l.slot % 8] : []) : isRef ? [] : LAP_DASHES[Math.max(1, l.slot) % 8],
              text,
            });
            if (measure && l === laps[0]) break;
          }
          rows.push({
            swatch: P.colorByLap ? T.text3 : t.color,
            dash: [],
            label: t.name + (t.unit ? ` [${t.unit}]` : '') + (t.present ? '' : ' — not in session'),
            values: laps.length === 1 || measure ? values.slice(0, 1).map((v) => ({ ...v, color: '' })) : values,
          });
        }
      }
      drawLegend(ctx, T, P, rows);
    }
  }, [size]);

  useEffect(() => {
    drawBase();
    drawOverlay();
  }, [drawBase, drawOverlay]);
  useStoreListener(drawOverlay, [drawOverlay]);

  // ------------------------------------------------------------------ interaction
  const localX = (e: { clientX: number; clientY: number }) => {
    const r = overRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const paneAtY = (y: number) => layoutRef.current?.panes.find((p) => y >= p.top && y < p.bottom);
  const separatorAt = (y: number) => {
    const L = layoutRef.current;
    if (!L) return -1;
    const ch = L.panes.filter((p) => p.kind === 'channels');
    for (let i = 0; i < ch.length - 1; i++) if (Math.abs(ch[i].bottom - y) < 4) return i;
    return -1;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const L = layoutRef.current;
    if (!L || !L.laps.length) return;
    const { x, y } = localX(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const zoom0 = viewRange();
    const sep = separatorAt(y);
    if (e.button === 0 && sep >= 0) {
      dragRef.current = { mode: 'resize', startPx: x, curPx: x, startY: y, moved: false, zoom0, paneIdx: sep, weights: config.panes.map((p) => p.weight) };
      return;
    }
    const mode = e.button === 1 || e.button === 2 || e.ctrlKey || e.metaKey ? 'pan' : e.shiftKey ? 'measure' : 'select';
    dragRef.current = { mode, startPx: x, curPx: x, startY: y, moved: false, zoom0 };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const L = layoutRef.current;
    if (!L) return;
    const { x, y } = localX(e);
    const d = dragRef.current;
    const el = overRef.current!;
    if (!d) {
      el.style.cursor = separatorAt(y) >= 0 ? 'row-resize' : 'crosshair';
      if (useStore.getState().settings.cursorMode === 'hover' && x >= LEFT && x <= L.w - RIGHT) setCursor(xOfPx(L, x));
      return;
    }
    d.curPx = x;
    if (Math.abs(x - d.startPx) > 3 || Math.abs(y - d.startY) > 3) d.moved = true;
    if (d.mode === 'pan' && d.moved) {
      const span = d.zoom0[1] - d.zoom0[0];
      const dx = ((x - d.startPx) / (L.w - LEFT - RIGHT)) * span;
      setZoom([d.zoom0[0] - dx, d.zoom0[1] - dx]);
    } else if (d.mode === 'resize' && d.weights) {
      const chPanes = L.panes.filter((p) => p.kind === 'channels');
      const i = d.paneIdx!;
      const total = d.weights.reduce((a, b) => a + b, 0);
      const plotH = chPanes[chPanes.length - 1].bottom - chPanes[0].top;
      const dw = ((y - d.startY) / plotH) * total;
      const a = Math.max(0.2, d.weights[i] + dw);
      const b = Math.max(0.2, d.weights[i] + d.weights[i + 1] - a);
      const next = d.weights.slice();
      next[i] = a;
      next[i + 1] = b;
      updateComponent(config.id, { panes: config.panes.map((p, k) => ({ ...p, weight: next[k] })) } as Partial<GraphConfig>);
    } else drawOverlay();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const L = layoutRef.current;
    const d = dragRef.current;
    dragRef.current = null;
    if (!L || !d) return;
    const { x } = localX(e);
    if (d.mode === 'select' || d.mode === 'measure') {
      if (d.moved && Math.abs(x - d.startPx) > 4) {
        const a = xOfPx(L, Math.min(d.startPx, x));
        const b = xOfPx(L, Math.max(d.startPx, x));
        if (d.mode === 'select') setZoom([a, b]);
        else setMeasure([a, b]);
      } else if (e.button === 0) {
        setMeasure(null);
        if (x >= LEFT) setCursor(xOfPx(L, x));
      }
    }
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
    updateComponent(config.id, { panes } as Partial<GraphConfig>);
  };
  const setPanes = (panes: GraphPane[]) => updateComponent(config.id, { panes } as Partial<GraphConfig>);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = localX(e);
    const P = paneAtY(y);
    const legend = P?.legendRows.find((r) => y >= r.y && y < r.y + r.h && x < LEFT + 360);
    const pIdx = P && P.kind === 'channels' ? P.index : -1;
    const T = useStore.getState().settings.theme;
    if (legend && P) {
      const name = legend.name;
      openMenu(e, [
        { header: name },
        {
          label: 'Remove from graph',
          onClick: () => setPanes(config.panes.map((p, i) => (i === pIdx ? { ...p, channels: p.channels.filter((c) => c !== name) } : p)).filter((p) => p.channels.length)),
        },
        {
          label: 'Move to its own pane',
          disabled: config.panes[pIdx]?.channels.length <= 1,
          onClick: () => {
            const panes = config.panes.map((p, i) => (i === pIdx ? { ...p, channels: p.channels.filter((c) => c !== name) } : p));
            panes.splice(pIdx + 1, 0, newPane([name]));
            setPanes(panes);
          },
        },
        { label: 'Channel properties…', onClick: () => openChannelProps(name) },
        { separator: true },
        { header: 'Colour' },
        {
          swatches: CATEGORICAL[T].map((c) => ({ color: c, onClick: () => setChannelProps(name, { color: c }) })),
        },
        { label: 'Automatic colour', onClick: () => setChannelProps(name, { color: undefined }) },
      ]);
      return;
    }
    const scale = pIdx >= 0 ? config.panes[pIdx].scale : 'auto';
    openMenu(e, [
      { label: 'Add channel to this pane…', disabled: pIdx < 0, onClick: () => openChannelPicker(e, (n) => addChannel(n, pIdx)) },
      { label: 'Add channel in new pane…', onClick: () => openChannelPicker(e, (n) => addChannel(n, 'new')) },
      { separator: true },
      { label: 'Time variance pane', checked: config.showVariance, shortcut: 'F3', onClick: () => updateComponent(config.id, { showVariance: !config.showVariance } as Partial<GraphConfig>) },
      { label: 'Sector & section lines', checked: config.showSectors, onClick: () => updateComponent(config.id, { showSectors: !config.showSectors } as Partial<GraphConfig>) },
      { label: 'Corner markers', checked: config.showCorners, onClick: () => updateComponent(config.id, { showCorners: !config.showCorners } as Partial<GraphConfig>) },
      { label: 'Y range: whole lap', checked: config.yRange === 'full', onClick: () => updateComponent(config.id, { yRange: 'full' } as Partial<GraphConfig>) },
      { label: 'Y range: visible area', checked: config.yRange === 'visible', onClick: () => updateComponent(config.id, { yRange: 'visible' } as Partial<GraphConfig>) },
      ...(pIdx >= 0
        ? [
            { separator: true },
            { header: 'This pane' },
            { label: 'Scale: automatic', checked: scale === 'auto', onClick: () => setPanes(config.panes.map((p, i) => (i === pIdx ? { ...p, scale: 'auto' as const } : p))) },
            { label: 'Scale: shared (tiled)', checked: scale === 'shared', onClick: () => setPanes(config.panes.map((p, i) => (i === pIdx ? { ...p, scale: 'shared' as const } : p))) },
            {
              label: 'Scale: independent (overlapped)',
              checked: scale === 'independent',
              onClick: () => setPanes(config.panes.map((p, i) => (i === pIdx ? { ...p, scale: 'independent' as const } : p))),
            },
            { label: 'Remove pane', onClick: () => setPanes(config.panes.filter((_, i) => i !== pIdx)) },
          ]
        : []),
      { separator: true },
      { label: 'Reset zoom', shortcut: 'Esc', onClick: () => setZoom(null) },
      { label: 'Clear range measurement', disabled: !useStore.getState().measure, onClick: () => setMeasure(null) },
    ]);
  };

  const dropTarget = (e: React.DragEvent) => {
    const { y } = localX(e);
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
        onDoubleClick={() => setZoom(null)}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          if (useStore.getState().settings.cursorMode === 'hover' && !dragRef.current) drawOverlay();
        }}
      />
    </div>
  );
}

function drawYAxis(ctx: CanvasRenderingContext2D, T: ReturnType<typeof chartTheme>, P: PaneLayout, py: (v: number) => number, mn: number, mx: number, unit: string) {
  const ph = P.bottom - P.top;
  const { step, ticks } = niceTicks(mn, mx, Math.max(2, Math.floor(ph / 26)));
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
  ctx.fillStyle = T.text3;
  ctx.textAlign = 'right';
  for (const t of ticks) {
    const Y = py(t);
    if (Y < P.top + 6 || Y > P.bottom - 6) continue;
    ctx.fillText(fmtTick(t, step), LEFT - 6, Y);
  }
  void unit;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  T: ReturnType<typeof chartTheme>,
  P: PaneLayout,
  rows: { swatch: string; dash: number[]; label: string; values: { color: string; dash: number[]; text: string }[] }[],
) {
  P.legendRows = [];
  if (!rows.length) return;
  const rowH = 15;
  const maxRows = Math.max(1, Math.floor((P.bottom - P.top - 6) / rowH));
  const shown = rows.slice(0, maxRows);
  ctx.font = T.font;
  let wMax = 0;
  const measured = shown.map((r) => {
    const lw = ctx.measureText(r.label).width;
    const vw = r.values.reduce((a, v) => a + ctx.measureText(v.text).width + (v.color ? 22 : 10), 0);
    wMax = Math.max(wMax, lw + vw + 24);
    return { lw };
  });
  const x0 = LEFT + 6;
  const y0 = P.top + 4;
  ctx.fillStyle = withAlpha(T.surface.startsWith('#') ? T.surface : '#15181d', 0.82);
  ctx.fillRect(x0 - 3, y0 - 1, Math.min(wMax + 6, ctx.canvas.width), shown.length * rowH + 3);
  shown.forEach((r, i) => {
    const y = y0 + i * rowH + rowH / 2;
    P.legendRows.push({ y: y0 + i * rowH, h: rowH, name: r.label.replace(/ \[.*$/, '').replace(/ — not in session$/, '') });
    ctx.fillStyle = r.swatch;
    ctx.fillRect(x0, y - 4, 8, 8);
    ctx.fillStyle = T.text2;
    ctx.textAlign = 'left';
    ctx.fillText(r.label, x0 + 13, y);
    let x = x0 + 13 + measured[i].lw + 10;
    for (const v of r.values) {
      if (v.color) {
        ctx.strokeStyle = v.color;
        ctx.lineWidth = 2;
        ctx.setLineDash(v.dash);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 12, y);
        ctx.stroke();
        ctx.setLineDash([]);
        x += 16;
      }
      ctx.fillStyle = T.text;
      ctx.font = T.mono;
      ctx.fillText(v.text, x, y);
      x += ctx.measureText(v.text).width + 8;
      ctx.font = T.font;
    }
  });
  if (rows.length > shown.length) {
    ctx.fillStyle = T.text3;
    ctx.fillText(`+${rows.length - shown.length} more`, x0 + 13, y0 + shown.length * rowH + 6);
  }
}
