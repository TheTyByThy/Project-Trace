// Mixture map (2-D histogram): % of time in each X/Y cell, or the mean/min/max of a third channel.

import { useCallback, useEffect, useRef } from 'react';
import { xToTime } from '../core/axis';
import { sampleAt } from '../core/channel';
import { rampColor } from '../core/colors';
import { formatValue } from '../core/format';
import { lapLabel } from '../core/session';
import { selectedLaps, useStore } from '../state/store';
import type { MixtureConfig } from '../state/workspace';
import { drawAxes, makeAxes, type Axes } from './axes';
import { chartTheme, prepCanvas, useElementSize, useStoreListener } from './canvas';
import { conv, findChannel, lapWindow, sampleGrid } from './data';

export function MixtureView({ config }: { config: MixtureConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const axesRef = useRef<Axes | null>(null);
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
    const ref = selectedLaps(st)[0];
    axesRef.current = null;
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    const chX = findChannel(sessions, config.x);
    const chY = findChannel(sessions, config.y);
    const chZ = config.z ? findChannel(sessions, config.z) : undefined;
    if (!ref || !chX || !chY || (config.z && !chZ)) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText(!ref ? 'Select a lap' : 'Channel not found', w / 2, h / 2);
      return;
    }
    const [ta, tb] = lapWindow(ref.lap, config.useZoom, st.zoom, st.xMode);
    const names = [config.x, config.y, ...(config.z ? [config.z] : [])];
    const g = sampleGrid(ref.session, names, ta, tb, 60000);
    if (!g) return;
    const [xs, ys] = g;
    const zs = config.z ? g[2] : null;
    let xmn = Infinity,
      xmx = -Infinity,
      ymn = Infinity,
      ymx = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < xmn) xmn = xs[i];
      if (xs[i] > xmx) xmx = xs[i];
      if (ys[i] < ymn) ymn = ys[i];
      if (ys[i] > ymx) ymx = ys[i];
    }
    if (xmx - xmn < 1e-9) xmx = xmn + 1;
    if (ymx - ymn < 1e-9) ymx = ymn + 1;
    const nx = Math.max(1, config.xBins);
    const ny = Math.max(1, config.yBins);
    const count = new Float64Array(nx * ny);
    const acc = new Float64Array(nx * ny);
    const mnA = new Float64Array(nx * ny).fill(Infinity);
    const mxA = new Float64Array(nx * ny).fill(-Infinity);
    let total = 0;
    for (let i = 0; i < xs.length; i++) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
      const bx = Math.min(nx - 1, Math.floor(((xs[i] - xmn) / (xmx - xmn)) * nx));
      const by = Math.min(ny - 1, Math.floor(((ys[i] - ymn) / (ymx - ymn)) * ny));
      const k = by * nx + bx;
      count[k]++;
      total++;
      if (zs) {
        const z = zs[i];
        acc[k] += z;
        if (z < mnA[k]) mnA[k] = z;
        if (z > mxA[k]) mxA[k] = z;
      }
    }
    const val = new Float64Array(nx * ny).fill(NaN);
    let vmin = Infinity,
      vmax = -Infinity;
    for (let k = 0; k < nx * ny; k++) {
      if (!count[k]) continue;
      const v = !zs || config.mode === 'time' ? (100 * count[k]) / total : config.mode === 'mean' ? acc[k] / count[k] : config.mode === 'min' ? mnA[k] : mxA[k];
      val[k] = v;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    const cx = conv(chX),
      cy = conv(chY);
    const rect = { x: 54, y: 10, w: Math.max(10, w - 54 - 12), h: Math.max(10, h - 10 - 40) };
    const A = makeAxes(rect, xmn, xmx, ymn, ymx);
    axesRef.current = A;
    const cw = rect.w / nx;
    const chh = rect.h / ny;
    for (let by = 0; by < ny; by++)
      for (let bx = 0; bx < nx; bx++) {
        const v = val[by * nx + bx];
        if (!Number.isFinite(v)) continue;
        const t = (v - vmin) / (vmax - vmin || 1);
        ctx.fillStyle = rampColor(config.ramp, theme, 0.08 + 0.92 * t);
        const X = rect.x + bx * cw;
        const Y = rect.y + rect.h - (by + 1) * chh;
        ctx.fillRect(X + 1, Y + 1, cw - 2, chh - 2);
        if (config.showValues && cw > 30 && chh > 14) {
          ctx.fillStyle = (theme === 'dark' ? t > 0.55 : t < 0.55) ? '#0b0b0b' : '#f0efec';
          ctx.textAlign = 'center';
          ctx.font = T.mono;
          ctx.fillText(config.mode === 'time' || !zs ? v.toFixed(1) : formatValue(v, 1), X + cw / 2, Y + chh / 2);
          ctx.font = T.font;
        }
      }
    drawAxes(ctx, T, A, xmn, xmx, ymn, ymx, `${config.x}${cx.unit ? ` [${cx.unit}]` : ''}`, `${config.y}${cy.unit ? ` [${cy.unit}]` : ''}`);
    ctx.fillStyle = T.text3;
    ctx.textAlign = 'left';
    const what = !zs || config.mode === 'time' ? '% of time' : `${config.mode} of ${config.z}`;
    ctx.fillText(`${what} · ${lapLabel(ref.lap)}`, rect.x, h - 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, sessions, lapSel, refKey, zoom, xMode, dataVersion, theme]);

  const drawOverlay = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(overRef.current, w, h);
    const A = axesRef.current;
    if (!ctx || !A) return;
    const st = useStore.getState();
    const ref = selectedLaps(st)[0];
    if (st.cursor == null || !ref) return;
    const chX = ref.session.channels.get(config.x);
    const chY = ref.session.channels.get(config.y);
    if (!chX || !chY) return;
    const t = xToTime(ref.lap, st.cursor, st.xMode);
    const cx = conv(chX),
      cy = conv(chY);
    const T = chartTheme();
    ctx.beginPath();
    ctx.arc(A.px(sampleAt(chX, t) * cx.k + cx.b), A.py(sampleAt(chY, t) * cy.k + cy.b), 6, 0, Math.PI * 2);
    ctx.strokeStyle = T.surface;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = T.cursor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [size, config]);

  useEffect(() => {
    drawBase();
    drawOverlay();
  }, [drawBase, drawOverlay]);
  useStoreListener(drawOverlay, [drawOverlay]);

  return (
    <div ref={wrapRef} className="chart">
      <canvas ref={baseRef} />
      <canvas
        ref={overRef}
      />
    </div>
  );
}
