// Bars: a time/distance strip chart where each row is a condition on a channel (non-zero, =, ≠, >, ≥,
// <, ≤ or between values) drawn as a filled bar wherever it holds. It uses the graph's x-axis, margins,
// zoom and cursor, so placed under a time/distance graph the two read as one continuous chart.
//  • one thin lane per selected lap (reference first) or the reference only;
//  • click = cursor, drag = zoom (classic mode), wheel = zoom, double-click = reset, Shift+drag = measure;
//  • drop a channel to add a row (true where it's non-zero).

import { useCallback, useEffect, useRef } from 'react';
import { lapSeries, xToTime } from '../core/axis';
import { CATEGORICAL, withAlpha } from '../core/colors';
import { formatAxisDistance, formatAxisTime, formatValue } from '../core/format';
import { crossingTime } from '../core/session';
import { niceTicks } from '../core/stats';
import { activeWorkspace, selectedLaps, setCursor, setGraphMarkers, setMeasure, setZoom, trackProfile, updateComponent, useStore, viewRange, type SelectedLap } from '../state/store';
import { keyHint } from '../shortcuts';
import { openMenu } from '../ui/overlays';
import { uid, type BarRow, type BarsConfig } from '../state/workspace';
import { chartTheme, lowerBound, prepCanvas, useElementSize, useStoreListener } from './canvas';
import { channelLabel, conv } from './data';
import { LEFT, RIGHT } from './GraphView';

const TOP = 4;
const DOUBLE_CLICK_MS = 380;

export const BAR_OPS: { op: BarRow['op']; label: string; sym: string }[] = [
  { op: 'nonzero', label: 'is on (non-zero)', sym: '≠ 0' },
  { op: 'eq', label: 'equals', sym: '=' },
  { op: 'ne', label: 'is not', sym: '≠' },
  { op: 'gt', label: 'greater than', sym: '>' },
  { op: 'ge', label: 'at least', sym: '≥' },
  { op: 'lt', label: 'less than', sym: '<' },
  { op: 'le', label: 'at most', sym: '≤' },
  { op: 'between', label: 'between', sym: '…' },
];

/** The condition as a test on a value in display units. */
function testFor(r: BarRow): (v: number) => boolean {
  const a = r.value;
  const b = r.value2 ?? r.value;
  const eps = 1e-9 + Math.abs(a) * 1e-9;
  switch (r.op) {
    case 'nonzero':
      return (v) => Number.isFinite(v) && Math.abs(v) > 1e-9;
    case 'eq':
      return (v) => Math.abs(v - a) <= Math.max(eps, 1e-6);
    case 'ne':
      return (v) => Number.isFinite(v) && Math.abs(v - a) > Math.max(eps, 1e-6);
    case 'gt':
      return (v) => v > a;
    case 'ge':
      return (v) => v >= a;
    case 'lt':
      return (v) => v < a;
    case 'le':
      return (v) => v <= a;
    case 'between':
      return (v) => v >= Math.min(a, b) && v <= Math.max(a, b);
  }
}

/** Short description of a row's condition, e.g. "Brake Pos > 5". */
export function barCondition(r: BarRow): string {
  const name = channelLabel(r.channel);
  if (r.op === 'nonzero') return name;
  const sym = BAR_OPS.find((o) => o.op === r.op)?.sym ?? '';
  if (r.op === 'between') return `${name} ${formatValue(Math.min(r.value, r.value2 ?? r.value), 3)}…${formatValue(Math.max(r.value, r.value2 ?? r.value), 3)}`;
  return `${name} ${sym} ${formatValue(r.value, 3)}`;
}

interface Layout {
  w: number;
  h: number;
  v0: number;
  v1: number;
  bottom: number;
  laps: SelectedLap[];
  /** One lane per row, or (combined) a single lane holding every row. */
  lanes: { rows: BarRow[]; top: number; bottom: number }[];
}

/**
 * Combined mode: index of the highest-priority row (earliest in the list) whose condition holds for a
 * lap at session time t, or -1. Each channel is read at its own sample nearest to t.
 */
function winnerAt(l: SelectedLap, rows: BarRow[], tests: ((v: number) => boolean)[], t: number): number {
  for (let r = 0; r < rows.length; r++) {
    const ch = l.session.channels.get(rows[r].channel);
    if (!ch) continue;
    const i = Math.max(0, Math.min(ch.n - 1, Math.round((t - ch.t0) * ch.rate)));
    const c = conv(ch);
    if (tests[r](ch.data[i] * c.k + c.b)) return r;
  }
  return -1;
}

export function BarsView({ config }: { config: BarsConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<Layout | null>(null);
  const dragRef = useRef<{ mode: 'select' | 'measure' | 'scrub' | 'pan'; startPx: number; curPx: number; moved: boolean; zoom0: [number, number] } | null>(null);
  const lastUpRef = useRef({ t: 0, x: 0 });

  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const xMode = useStore((s) => s.xMode);
  const zoom = useStore((s) => s.zoom);
  const dataVersion = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);
  const distUnit = useStore((s) => s.settings.units.distance);
  const profiles = useStore((s) => s.settings.trackProfiles);
  const channelPropsAll = useStore((s) => activeWorkspace(s)?.channelProps);

  const px = (L: Layout, x: number) => LEFT + ((x - L.v0) / (L.v1 - L.v0)) * (L.w - LEFT - RIGHT);
  const xOf = (L: Layout, p: number) => L.v0 + ((p - LEFT) / (L.w - LEFT - RIGHT)) * (L.v1 - L.v0);

  const drawBase = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(baseRef.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    const st = useStore.getState();
    const allLaps = selectedLaps(st);
    const laps = config.laps === 'ref' ? allLaps.slice(0, 1) : allLaps;
    const [v0, v1] = viewRange(st);
    const bottom = config.showAxis ? 22 : 4;
    const plotL = LEFT;
    const plotR = w - RIGHT;
    const rows = config.rows;
    const groups = config.combined ? (rows.length ? [rows] : []) : rows.map((r) => [r]);
    const laneH = groups.length ? (h - TOP - bottom) / groups.length : 0;
    const L: Layout = { w, h, v0, v1, bottom, laps, lanes: groups.map((g, i) => ({ rows: g, top: TOP + i * laneH, bottom: TOP + (i + 1) * laneH })) };
    layoutRef.current = L;
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    if (!laps.length || !rows.length) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText(!laps.length ? 'Select a lap' : 'Drop a channel here, or add rows in Properties', w / 2, h / 2);
      return;
    }
    const ref = laps[0];
    const X = (x: number) => px(L, x);
    const pal = CATEGORICAL[theme];

    // Lane backgrounds and separators.
    L.lanes.forEach((ln, i) => {
      ctx.fillStyle = withAlpha(T.text, i % 2 ? 0.025 : 0.045);
      ctx.fillRect(plotL, ln.top, plotR - plotL, ln.bottom - ln.top);
    });

    // Sector / split / corner lines, as on the graph above.
    if (ref.lap.index !== -1 && (config.showSectors || config.showCorners)) {
      const prof = trackProfile(ref.session.meta.venue);
      const toX = (d: number) => (xMode === 'distance' ? d : crossingTime(ref.lap, d) - ref.lap.start);
      const marks: { x: number; color: string }[] = [];
      if (config.showSectors) {
        ref.session.sectorSplits.forEach((d) => marks.push({ x: toX(d), color: pal[6] }));
        prof.sections.forEach((s) => marks.push({ x: toX(s.dist), color: pal[2] }));
      }
      if (config.showCorners) prof.corners.forEach((c) => marks.push({ x: toX(c.dist), color: pal[3] }));
      ctx.lineWidth = 1;
      for (const m of marks) {
        if (!Number.isFinite(m.x) || m.x < v0 || m.x > v1) continue;
        const x = Math.round(X(m.x)) + 0.5;
        ctx.strokeStyle = withAlpha(m.color, 0.45);
        ctx.beginPath();
        ctx.moveTo(x, TOP);
        ctx.lineTo(x, h - bottom);
        ctx.stroke();
      }
    }

    // Bars.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotL, TOP, plotR - plotL, h - TOP - bottom);
    ctx.clip();
    const rowColor = (r: BarRow, i: number) => r.color || pal[i % pal.length];
    for (const ln of L.lanes) {
      const pad = Math.min(3, (ln.bottom - ln.top) * 0.12);
      const sub = (ln.bottom - ln.top - 2 * pad) / laps.length;
      if (config.combined) {
        // One row: at each moment the highest-priority true condition decides the colour.
        const tests = ln.rows.map(testFor);
        laps.forEach((l, li) => {
          const chs = ln.rows.map((r) => l.session.channels.get(r.channel)).filter((c): c is NonNullable<typeof c> => !!c);
          if (!chs.length) return;
          // Step along the fastest of the channels, so short events aren't missed.
          const grid = chs.reduce((a, c) => (c.rate > a.rate ? c : a));
          const ser = lapSeries(l.lap, grid, xMode);
          const n = ser.xs.length;
          if (!n) return;
          const a = Math.max(0, lowerBound(ser.xs, v0) - 1);
          const b = Math.min(n - 1, lowerBound(ser.xs, v1) + 1);
          const y = ln.top + pad + li * sub;
          const hh = Math.max(1, sub - (laps.length > 1 ? 1 : 0));
          let cur = -1;
          let runStart = a;
          const flush = (end: number) => {
            if (cur < 0) return;
            const x0 = X(ser.xs[runStart]);
            const x1 = X(end + 1 < n ? ser.xs[end + 1] : ser.xs[end]);
            ctx.fillStyle = rowColor(ln.rows[cur], cur);
            ctx.fillRect(x0, y, Math.max(1, x1 - x0), hh);
          };
          for (let k = a; k <= b; k++) {
            const win = winnerAt(l, ln.rows, tests, grid.t0 + (ser.i0 + k) / grid.rate);
            if (win !== cur) {
              flush(k - 1);
              cur = win;
              runStart = k;
            }
          }
          flush(b);
          // Which lap each lane is: a short tick in the lap's colour at the left edge.
          if (laps.length > 1) {
            ctx.fillStyle = l.color;
            ctx.fillRect(plotL + 1, y, 3, hh);
          }
        });
        continue;
      }
      const r = ln.rows[0];
      const test = testFor(r);
      laps.forEach((l, li) => {
        const ch = l.session.channels.get(r.channel);
        if (!ch) return;
        const c = conv(ch);
        const ser = lapSeries(l.lap, ch, xMode);
        const n = ser.xs.length;
        if (!n) return;
        const a = Math.max(0, lowerBound(ser.xs, v0) - 1);
        const b = Math.min(n - 1, lowerBound(ser.xs, v1) + 1);
        const y = ln.top + pad + li * sub;
        const hh = Math.max(1, sub - (laps.length > 1 ? 1 : 0));
        ctx.fillStyle = li === 0 ? rowColor(r, 0) : l.color;
        let runStart = -1;
        const flush = (end: number) => {
          // A run covers its samples up to the next sample's x (data is held between samples).
          const x0 = X(ser.xs[runStart]);
          const x1 = X(end + 1 < n ? ser.xs[end + 1] : ser.xs[end]);
          ctx.fillRect(x0, y, Math.max(1, x1 - x0), hh);
        };
        for (let k = a; k <= b; k++) {
          const on = test(ch.data[ser.i0 + k] * c.k + c.b);
          if (on && runStart < 0) runStart = k;
          else if (!on && runStart >= 0) {
            flush(k - 1);
            runStart = -1;
          }
        }
        if (runStart >= 0) flush(b);
      });
      ctx.strokeStyle = T.border;
      ctx.beginPath();
      ctx.moveTo(plotL, Math.round(ln.bottom) + 0.5);
      ctx.lineTo(plotR, Math.round(ln.bottom) + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Left edge, like the graph's y-axis line.
    ctx.strokeStyle = T.border;
    ctx.beginPath();
    ctx.moveTo(plotL + 0.5, TOP);
    ctx.lineTo(plotL + 0.5, h - bottom);
    ctx.stroke();

    // Optional x-axis labels.
    if (config.showAxis) {
      const { step, ticks } = niceTicks(v0, v1, Math.max(3, Math.floor((plotR - plotL) / 90)));
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      for (const t of ticks) ctx.fillText(xMode === 'time' ? formatAxisTime(t, step) : formatAxisDistance(t, step, distUnit), X(t), h - bottom / 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, sessions, lapSel, refKey, xMode, zoom, dataVersion, theme, distUnit, profiles, channelPropsAll]);

  // ------------------------------------------------------------------ overlay: labels, cursor, drag
  const drawOverlay = useCallback(() => {
    const L = layoutRef.current;
    const { w, h } = size;
    const ctx = prepCanvas(overRef.current, w, h);
    if (!ctx || !L || !L.laps.length) return;
    const T = chartTheme();
    const st = useStore.getState();
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    const X = (x: number) => px(L, x);

    if (st.measure) {
      const a = X(Math.min(st.measure[0], st.measure[1]));
      const b = X(Math.max(st.measure[0], st.measure[1]));
      ctx.fillStyle = withAlpha(T.accent, 0.1);
      ctx.fillRect(a, TOP, b - a, h - TOP - L.bottom);
    }
    const d = dragRef.current;
    if (d && d.moved && (d.mode === 'select' || d.mode === 'measure')) {
      const a = Math.min(d.startPx, d.curPx);
      const b = Math.max(d.startPx, d.curPx);
      ctx.fillStyle = d.mode === 'select' ? withAlpha(T.text, 0.08) : withAlpha(T.accent, 0.12);
      ctx.fillRect(a, TOP, b - a, h - TOP - L.bottom);
    }

    // Cursor (accent while pinned as a datum, like the graph).
    const cur = st.cursor;
    if (cur != null && cur >= L.v0 && cur <= L.v1) {
      const x = Math.round(X(cur)) + 0.5;
      ctx.strokeStyle = st.datum ? T.accent : T.cursor;
      ctx.lineWidth = st.datum ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, TOP);
      ctx.lineTo(x, h - L.bottom);
      ctx.stroke();
    }

    // Row labels, with ● when the condition holds for the reference lap at the cursor.
    if (config.showLabels) {
      const ref = L.laps[0];
      if (config.combined && L.lanes[0]) {
        // One line of keys in priority order; the condition winning at the cursor is marked ●.
        const ln = L.lanes[0];
        const pal = CATEGORICAL[useStore.getState().settings.theme];
        const win = cur != null ? winnerAt(ref, ln.rows, ln.rows.map(testFor), xToTime(ref.lap, cur, st.xMode)) : -2;
        const y = Math.min(ln.top + 10, (ln.top + ln.bottom) / 2);
        let x = LEFT + 8;
        ctx.textAlign = 'left';
        ctx.lineJoin = 'round';
        ln.rows.forEach((r, i) => {
          const color = r.color || pal[i % pal.length];
          if (win === i) {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x + 4, y, 4, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = color;
            ctx.fillRect(x, y - 4, 8, 8);
          }
          x += 13;
          const text = r.label || barCondition(r);
          ctx.lineWidth = 3;
          ctx.strokeStyle = withAlpha(T.surface.startsWith('#') ? T.surface : '#15181d', 0.9);
          ctx.strokeText(text, x, y);
          ctx.fillStyle = win === i ? T.text : T.text2;
          ctx.fillText(text, x, y);
          x += ctx.measureText(text).width + 14;
        });
      } else {
        for (const ln of L.lanes) {
          const r = ln.rows[0];
          let on: boolean | null = null;
          const ch = ref.session.channels.get(r.channel);
          if (ch && cur != null) {
            const t = xToTime(ref.lap, cur, st.xMode);
            const i = Math.max(0, Math.min(ch.n - 1, Math.round((t - ch.t0) * ch.rate)));
            const c = conv(ch);
            on = testFor(r)(ch.data[i] * c.k + c.b);
          }
          const text = (r.label || barCondition(r)) + (ch ? '' : ' — not in session');
          const y = (ln.top + ln.bottom) / 2;
          let x = LEFT + 8;
          if (on != null) {
            ctx.fillStyle = on ? r.color || CATEGORICAL[useStore.getState().settings.theme][0] : withAlpha(T.text3, 0.6);
            ctx.beginPath();
            ctx.arc(x + 4, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            x += 14;
          }
          // Outlined text instead of a box, so the bars stay visible underneath.
          ctx.textAlign = 'left';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 3;
          ctx.strokeStyle = withAlpha(T.surface.startsWith('#') ? T.surface : '#15181d', 0.9);
          ctx.strokeText(text, x, y);
          ctx.fillStyle = ch ? T.text : T.text3;
          ctx.fillText(text, x, y);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config.showLabels, config.rows, config.combined]);

  useEffect(() => {
    drawBase();
    drawOverlay();
  }, [drawBase, drawOverlay]);
  useStoreListener(drawOverlay, [drawOverlay]);

  // ------------------------------------------------------------------ interaction (as on the graph)
  const local = (e: { clientX: number }) => e.clientX - overRef.current!.getBoundingClientRect().left;
  const clampX = (L: Layout, x: number) => Math.max(LEFT, Math.min(L.w - RIGHT, x));

  const onPointerDown = (e: React.PointerEvent) => {
    const L = layoutRef.current;
    if (!L || !L.laps.length) return;
    const x = local(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const zoom0 = viewRange();
    if (e.button === 1 || e.button === 2 || e.ctrlKey || e.metaKey) {
      dragRef.current = { mode: 'pan', startPx: x, curPx: x, moved: false, zoom0 };
      return;
    }
    if (e.shiftKey) {
      dragRef.current = { mode: 'measure', startPx: x, curPx: x, moved: false, zoom0 };
      return;
    }
    const isDouble = performance.now() - lastUpRef.current.t < DOUBLE_CLICK_MS && Math.abs(x - lastUpRef.current.x) < 8;
    if (useStore.getState().settings.cursorMode !== 'scrub') {
      if (isDouble) {
        lastUpRef.current = { t: 0, x: 0 };
        setZoom(null);
        return;
      }
      dragRef.current = { mode: 'select', startPx: x, curPx: x, moved: false, zoom0 };
      return;
    }
    dragRef.current = { mode: isDouble ? 'select' : 'scrub', startPx: x, curPx: x, moved: false, zoom0 };
    if (!isDouble) setCursor(xOf(L, clampX(L, x)));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const L = layoutRef.current;
    if (!L) return;
    const x = local(e);
    const d = dragRef.current;
    if (!d) {
      if (useStore.getState().settings.cursorMode === 'hover' && x >= LEFT && x <= L.w - RIGHT) setCursor(xOf(L, x));
      return;
    }
    d.curPx = x;
    if (Math.abs(x - d.startPx) > 3) d.moved = true;
    if (d.mode === 'scrub') setCursor(xOf(L, clampX(L, x)));
    else if (d.mode === 'pan' && d.moved) {
      const span = d.zoom0[1] - d.zoom0[0];
      const dx = ((x - d.startPx) / (L.w - LEFT - RIGHT)) * span;
      setZoom([d.zoom0[0] - dx, d.zoom0[1] - dx]);
    } else drawOverlay();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const L = layoutRef.current;
    const d = dragRef.current;
    dragRef.current = null;
    if (!L || !d) return;
    const x = local(e);
    if ((d.mode === 'select' || d.mode === 'measure') && d.moved && Math.abs(x - d.startPx) > 4) {
      const a = xOf(L, clampX(L, Math.min(d.startPx, x)));
      const b = xOf(L, clampX(L, Math.max(d.startPx, x)));
      if (d.mode === 'select') setZoom([a, b]);
      else setMeasure([a, b]);
    }
    const classic = useStore.getState().settings.cursorMode !== 'scrub';
    if (classic && d.mode === 'select' && !d.moved && e.button === 0) {
      setMeasure(null);
      setCursor(xOf(L, clampX(L, x)));
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
      const mx = xOf(L, e.clientX - el.getBoundingClientRect().left);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={wrapRef}
      className="chart"
      onDragOver={(e) => e.dataTransfer.types.includes('application/x-pt-channel') && (e.preventDefault(), e.stopPropagation())}
      onDrop={(e) => {
        const n = e.dataTransfer.getData('application/x-pt-channel');
        if (!n) return;
        e.preventDefault();
        e.stopPropagation();
        updateComponent(config.id, { rows: [...config.rows, { id: uid('r'), channel: n, op: 'nonzero', value: 0 }] } as Partial<BarsConfig>, 'Add bar');
      }}
    >
      <canvas ref={baseRef} />
      <canvas
        ref={overRef}
        style={{ cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => {
          e.preventDefault();
          // Same marker toggles as the graph (they apply to every graph and bars component).
          openMenu(e, [
            { label: 'Combine rows into one (top row wins)', checked: !!config.combined, onClick: () => updateComponent(config.id, { combined: !config.combined } as Partial<BarsConfig>, 'Combine bars') },
            { separator: true },
            { label: 'Sector & section lines', checked: config.showSectors, shortcut: keyHint('toggle-sectors'), onClick: () => setGraphMarkers({ showSectors: !config.showSectors }) },
            { label: 'Corner lines', checked: config.showCorners, shortcut: keyHint('toggle-corners'), onClick: () => setGraphMarkers({ showCorners: !config.showCorners }) },
          ]);
        }}
      />
    </div>
  );
}
