// Scatter / XY plot: any channel against any other for each selected lap.
// Options: colour by lap or by a third channel, polynomial fit with R², MoTeC-style
// X-interval averaging, gate channel, equal aspect (G-G diagrams get friction circles).

import { useCallback, useEffect, useRef } from 'react';
import { xToTime } from '../core/axis';
import { sampleAt } from '../core/channel';
import { rampColor, withAlpha } from '../core/colors';
import { formatValue } from '../core/format';
import { lapLabel } from '../core/session';
import { evalPoly, polyFit } from '../core/stats';
import { selectedLaps, updateComponent, useStore } from '../state/store';
import type { ScatterConfig } from '../state/workspace';
import { openChannelPicker, openMenu } from '../ui/overlays';
import { drawAxes, drawMarker, makeAxes, padRange, type Axes } from './axes';
import { chartTheme, prepCanvas, useElementSize, useStoreListener } from './canvas';
import { conv, findChannel, lapWindow, sampleGrid } from './data';

export function ScatterView({ config }: { config: ScatterConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const axesRef = useRef<Axes | null>(null);
  const viewRef = useRef<{ x0: number; x1: number; y0: number; y1: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const zoom = useStore((s) => (config.useZoom ? s.zoom : null));
  const xMode = useStore((s) => s.xMode);
  const dataVersion = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);

  const drawBase = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(baseRef.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    const st = useStore.getState();
    const laps = selectedLaps(st);
    axesRef.current = null;
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    const chX = findChannel(sessions, config.x);
    const chY = findChannel(sessions, config.y);
    if (!laps.length || !chX || !chY) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText(!laps.length ? 'Select a lap' : `Channel not found: ${!chX ? config.x : config.y}`, w / 2, h / 2);
      return;
    }
    const colorCh = config.color !== 'lap' ? config.color : '';
    const names = [config.x, config.y, ...(colorCh ? [colorCh] : []), ...(config.gate ? [config.gate] : [])];
    const sets: { l: (typeof laps)[number]; xs: Float64Array; ys: Float64Array; cs: Float64Array | null; gate: Float64Array | null }[] = [];
    let xmn = Infinity,
      xmx = -Infinity,
      ymn = Infinity,
      ymx = -Infinity,
      cmn = Infinity,
      cmx = -Infinity;
    for (const l of laps) {
      const [ta, tb] = lapWindow(l.lap, config.useZoom, st.zoom, st.xMode);
      const g = sampleGrid(l.session, names, ta, tb, 40000);
      if (!g) continue;
      const xs = g[0],
        ys = g[1];
      const cs = colorCh ? g[2] : null;
      const gate = config.gate ? g[names.length - 1] : null;
      for (let i = 0; i < xs.length; i++) {
        if (gate && !gate[i]) continue;
        const x = xs[i],
          y = ys[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < xmn) xmn = x;
        if (x > xmx) xmx = x;
        if (y < ymn) ymn = y;
        if (y > ymx) ymx = y;
        if (cs) {
          if (cs[i] < cmn) cmn = cs[i];
          if (cs[i] > cmx) cmx = cs[i];
        }
      }
      sets.push({ l, xs, ys, cs, gate });
    }
    let [x0, x1] = padRange(xmn, xmx);
    let [y0, y1] = padRange(ymn, ymx);
    const cx = conv(chX);
    const cy = conv(chY);
    const rect = { x: 54, y: 10, w: Math.max(10, w - 54 - 14), h: Math.max(10, h - 10 - 40) };
    if (config.equalAspect) {
      const sx = rect.w / (x1 - x0);
      const sy = rect.h / (y1 - y0);
      if (sx > sy) {
        const c = (x0 + x1) / 2;
        const half = rect.w / sy / 2;
        x0 = c - half;
        x1 = c + half;
      } else {
        const c = (y0 + y1) / 2;
        const half = rect.h / sx / 2;
        y0 = c - half;
        y1 = c + half;
      }
    }
    if (viewRef.current) ({ x0, x1, y0, y1 } = viewRef.current);
    const A = makeAxes(rect, x0, x1, y0, y1);
    axesRef.current = A;
    drawAxes(ctx, T, A, x0, x1, y0, y1, `${config.x}${cx.unit ? ` [${cx.unit}]` : ''}`, `${config.y}${cy.unit ? ` [${cy.unit}]` : ''}`, { zeroLines: true });

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    // Friction circles for G-G plots.
    if (config.equalAspect && /^g$/i.test(cx.unit) && /^g$/i.test(cy.unit)) {
      ctx.strokeStyle = T.gridStrong;
      ctx.setLineDash([3, 4]);
      for (let gR = 1; gR <= 6; gR++) {
        ctx.beginPath();
        ctx.ellipse(A.px(0), A.py(0), Math.abs(A.px(gR) - A.px(0)), Math.abs(A.py(gR) - A.py(0)), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const ps = config.pointSize;
    const order = sets.slice(1).concat(sets.slice(0, 1));
    for (const s of order) {
      const alpha = sets.length > 1 ? 0.55 : 0.7;
      if (!s.cs) ctx.fillStyle = withAlpha(s.l.color, alpha);
      for (let i = 0; i < s.xs.length; i++) {
        if (s.gate && !s.gate[i]) continue;
        const x = s.xs[i],
          y = s.ys[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (s.cs) ctx.fillStyle = rampColor(config.ramp, theme, (s.cs[i] - cmn) / (cmx - cmn || 1));
        drawMarker(ctx, sets.length > 1 ? s.l.slot : 0, A.px(x), A.py(y), ps);
      }
    }
    // Interval averages / fits
    const fitDeg = config.fit === 'linear' ? 1 : config.fit === 'poly2' ? 2 : config.fit === 'poly3' ? 3 : 0;
    const notes: string[] = [];
    for (const s of sets) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < s.xs.length; i++) {
        if (s.gate && !s.gate[i]) continue;
        if (Number.isFinite(s.xs[i]) && Number.isFinite(s.ys[i])) {
          xs.push(s.xs[i]);
          ys.push(s.ys[i]);
        }
      }
      const lineColor = sets.length > 1 || s.cs ? s.l.color : T.text;
      if (config.intervalAvg && xs.length) {
        const nB = Math.max(2, config.intervalCount);
        const sum = new Float64Array(nB);
        const cnt = new Float64Array(nB);
        for (let i = 0; i < xs.length; i++) {
          const b = Math.min(nB - 1, Math.max(0, Math.floor(((xs[i] - xmn) / (xmx - xmn || 1)) * nB)));
          sum[b] += ys[i];
          cnt[b]++;
        }
        // Ignore sparsely populated intervals — their averages are just noise.
        const minCount = Math.max(3, xs.length * 0.004);
        for (let b = 0; b < nB; b++) if (cnt[b] < minCount) cnt[b] = 0;
        ctx.strokeStyle = lineColor;
        ctx.fillStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (let b = 0; b < nB; b++) {
          if (!cnt[b]) continue;
          const X = A.px(xmn + ((b + 0.5) / nB) * (xmx - xmn));
          const Y = A.py(sum[b] / cnt[b]);
          if (!started) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
          started = true;
        }
        ctx.stroke();
        for (let b = 0; b < nB; b++) {
          if (!cnt[b]) continue;
          ctx.beginPath();
          ctx.arc(A.px(xmn + ((b + 0.5) / nB) * (xmx - xmn)), A.py(sum[b] / cnt[b]), 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (fitDeg) {
        const f = polyFit(xs, ys, fitDeg);
        if (f) {
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 3]);
          ctx.beginPath();
          for (let k = 0; k <= 100; k++) {
            const x = xmn + ((xmx - xmn) * k) / 100;
            const X = A.px(x),
              Y = A.py(evalPoly(f.coef, x));
            if (k === 0) ctx.moveTo(X, Y);
            else ctx.lineTo(X, Y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          const terms = f.coef
            .map((c, i) => (i === 0 ? c.toPrecision(4) : `${c >= 0 ? '+' : '−'} ${Math.abs(c).toPrecision(3)}x${i > 1 ? '^' + i : ''}`))
            .join(' ');
          notes.push(`${lapLabel(s.l.lap)}: y = ${terms}   R² = ${f.r2.toFixed(3)}`);
        }
      }
    }
    ctx.restore();
    ctx.fillStyle = T.text2;
    ctx.textAlign = 'left';
    notes.slice(0, 4).forEach((n, i) => ctx.fillText(n, rect.x + 8, rect.y + 12 + i * 14));
    if (colorCh) {
      const cc = findChannel(sessions, colorCh);
      const cv = cc ? conv(cc) : null;
      // Colour key in the bottom-right corner (fit equations use the top-left).
      const bw = 100;
      const ky = rect.y + rect.h - 30;
      const g = ctx.createLinearGradient(rect.x + rect.w - bw - 8, 0, rect.x + rect.w - 8, 0);
      for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, rampColor(config.ramp, theme, i / 10));
      ctx.fillStyle = withAlpha(T.surface, 0.8);
      ctx.fillRect(rect.x + rect.w - 220, ky - 6, 216, 34);
      ctx.fillStyle = g;
      ctx.fillRect(rect.x + rect.w - bw - 8, ky, bw, 6);
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'right';
      ctx.fillText(`${colorCh} ${formatValue(cmn, 0)}–${formatValue(cmx, 0)}${cv?.unit ? ' ' + cv.unit : ''}`, rect.x + rect.w - 8, ky + 17);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, sessions, lapSel, refKey, zoom, xMode, dataVersion, theme]);

  const drawOverlay = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(overRef.current, w, h);
    const A = axesRef.current;
    if (!ctx || !A) return;
    const T = chartTheme();
    const st = useStore.getState();
    if (st.cursor == null) return;
    for (const l of selectedLaps(st)) {
      const chX = l.session.channels.get(config.x);
      const chY = l.session.channels.get(config.y);
      if (!chX || !chY) continue;
      const t = xToTime(l.lap, st.cursor, st.xMode);
      const cx = conv(chX),
        cy = conv(chY);
      const X = A.px(sampleAt(chX, t) * cx.k + cx.b);
      const Y = A.py(sampleAt(chY, t) * cy.k + cy.b);
      ctx.beginPath();
      ctx.arc(X, Y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = T.surface;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = l.isRef ? T.cursor : l.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [size, config]);

  useEffect(() => {
    drawBase();
    drawOverlay();
  }, [drawBase, drawOverlay]);
  useStoreListener(drawOverlay, [drawOverlay]);
  useEffect(() => {
    viewRef.current = null;
  }, [config.x, config.y, config.equalAspect]);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e, [
      { label: `X: ${config.x}…`, onClick: () => openChannelPicker(e, (n) => updateComponent(config.id, { x: n })) },
      { label: `Y: ${config.y}…`, onClick: () => openChannelPicker(e, (n) => updateComponent(config.id, { y: n })) },
      {
        label: `Colour: ${config.color === 'lap' ? 'by lap' : config.color}…`,
        onClick: () => openChannelPicker(e, (n) => updateComponent(config.id, { color: n }), [{ value: 'lap', label: 'Lap colours' }]),
      },
      { label: 'Swap X and Y', onClick: () => updateComponent(config.id, { x: config.y, y: config.x }) },
      { separator: true },
      { label: 'Fit: none', checked: config.fit === 'none', onClick: () => updateComponent(config.id, { fit: 'none' }) },
      { label: 'Fit: linear', checked: config.fit === 'linear', onClick: () => updateComponent(config.id, { fit: 'linear' }) },
      { label: 'Fit: quadratic', checked: config.fit === 'poly2', onClick: () => updateComponent(config.id, { fit: 'poly2' }) },
      { label: 'Fit: cubic', checked: config.fit === 'poly3', onClick: () => updateComponent(config.id, { fit: 'poly3' }) },
      { label: 'X-interval averages', checked: config.intervalAvg, onClick: () => updateComponent(config.id, { intervalAvg: !config.intervalAvg }) },
      { label: 'Equal aspect', checked: config.equalAspect, onClick: () => updateComponent(config.id, { equalAspect: !config.equalAspect }) },
      { label: 'Only zoomed range', checked: config.useZoom, onClick: () => updateComponent(config.id, { useZoom: !config.useZoom }) },
      { separator: true },
      { label: 'Reset view', onClick: () => ((viewRef.current = null), drawBase(), drawOverlay()) },
    ]);
  };

  useEffect(() => {
    const el = overRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const A = axesRef.current;
      if (!A) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = A.ix(e.clientX - r.left);
      const my = A.iy(e.clientY - r.top);
      const cur = viewRef.current ?? { x0: A.ix(A.rect.x), x1: A.ix(A.rect.x + A.rect.w), y0: A.iy(A.rect.y + A.rect.h), y1: A.iy(A.rect.y) };
      const f = Math.pow(1.0015, e.deltaY);
      viewRef.current = { x0: mx - (mx - cur.x0) * f, x1: mx + (cur.x1 - mx) * f, y0: my - (my - cur.y0) * f, y1: my + (cur.y1 - my) * f };
      drawBase();
      drawOverlay();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return (
    <div ref={wrapRef} className="chart">
      <canvas ref={baseRef} />
      <canvas
        ref={overRef}
        style={{ cursor: 'move', touchAction: 'none' }}
        onContextMenu={onContextMenu}
        onDoubleClick={() => ((viewRef.current = null), drawBase(), drawOverlay())}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          dragRef.current = { x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          const A = axesRef.current;
          if (!d || !A) return;
          const cur = viewRef.current ?? { x0: A.ix(A.rect.x), x1: A.ix(A.rect.x + A.rect.w), y0: A.iy(A.rect.y + A.rect.h), y1: A.iy(A.rect.y) };
          const dx = A.ix(e.clientX) - A.ix(d.cx);
          const dy = A.iy(e.clientY) - A.iy(d.cy);
          d.cx = e.clientX;
          d.cy = e.clientY;
          viewRef.current = { x0: cur.x0 - dx, x1: cur.x1 - dx, y0: cur.y0 - dy, y1: cur.y1 - dy };
          drawBase();
          drawOverlay();
        }}
        onPointerUp={() => (dragRef.current = null)}
      />
    </div>
  );
}
