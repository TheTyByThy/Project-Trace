// Scatter / XY plot: any channel against any other for each selected lap.
// Options: colour by lap or by a third channel, polynomial fit with R², MoTeC-style
// X-interval averaging, gate channel, fixed axis ranges, equal aspect (G-G diagrams get friction
// circles). Drag a rectangle to zoom; double-click resets.

import { useCallback, useEffect, useRef } from 'react';
import { xToTime } from '../core/axis';
import { sampleAt } from '../core/channel';
import { CATEGORICAL, rampColor, withAlpha } from '../core/colors';
import { formatValue } from '../core/format';
import { lapLabel } from '../core/session';
import { evalPoly, polyFit } from '../core/stats';
import { selectedLaps, useStore } from '../state/store';
import type { ScatterConfig } from '../state/workspace';
import { drawAxes, drawMarker, makeAxes, padRange, type Axes } from './axes';
import { BoxZoomLayer, type View } from './BoxZoom';
import { chartTheme, prepCanvas, useElementSize, useStoreListener } from './canvas';
import { channelLabel, conv, findChannel, lapWindow, sampleGrid } from './data';

const ENV_BINS = 72;

type ScatterSet = { xs: Float64Array; ys: Float64Array; gate: Float64Array | null };

/**
 * The grip envelope: in each 5° direction around the origin, the 99.5th-percentile distance of the
 * points (so a single kerb strike doesn't stretch it), pushed 3 % outward so the line sits just outside
 * the points. Directions with too few points borrow from their neighbours. Null with too little data.
 */
function gripEnvelope(sets: ScatterSet[]): Float64Array | null {
  const bins: number[][] = Array.from({ length: ENV_BINS }, () => []);
  for (const s of sets)
    for (let i = 0; i < s.xs.length; i++) {
      if (s.gate && !s.gate[i]) continue;
      const x = s.xs[i],
        y = s.ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const b = Math.min(ENV_BINS - 1, Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * ENV_BINS));
      bins[b].push(Math.hypot(x, y));
    }
  const env = new Float64Array(ENV_BINS).fill(NaN);
  bins.forEach((v, b) => {
    if (v.length < 5) return;
    v.sort((p, q) => p - q);
    env[b] = v[Math.floor((v.length - 1) * 0.995)] * 1.03;
  });
  if (env.every((v) => !Number.isFinite(v))) return null;
  // Fill gaps from the nearest directions either side.
  for (let b = 0; b < ENV_BINS; b++) {
    if (Number.isFinite(env[b])) continue;
    let k = 1;
    while (k < ENV_BINS && !Number.isFinite(env[(b + k) % ENV_BINS]) && !Number.isFinite(env[(b - k + ENV_BINS) % ENV_BINS])) k++;
    const a = env[(b + k) % ENV_BINS];
    const c = env[(b - k + ENV_BINS) % ENV_BINS];
    env[b] = Number.isFinite(a) && Number.isFinite(c) ? (a + c) / 2 : Number.isFinite(a) ? a : c;
  }
  // Light smoothing around the circle.
  const out = new Float64Array(ENV_BINS);
  for (let b = 0; b < ENV_BINS; b++) out[b] = (env[(b + ENV_BINS - 1) % ENV_BINS] + 2 * env[b] + env[(b + 1) % ENV_BINS]) / 4;
  return out;
}

/** Average share of the envelope a lap used, over the points away from the centre (> 25 % of it). */
function envelopeUse(s: ScatterSet, env: Float64Array): number {
  let sum = 0,
    n = 0;
  for (let i = 0; i < s.xs.length; i++) {
    if (s.gate && !s.gate[i]) continue;
    const x = s.xs[i],
      y = s.ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const b = Math.min(ENV_BINS - 1, Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * ENV_BINS));
    const u = Math.hypot(x, y) / env[b];
    if (!Number.isFinite(u) || u < 0.25) continue;
    sum += Math.min(1.2, u);
    n++;
  }
  return n ? sum / n : NaN;
}

export function ScatterView({ config }: { config: ScatterConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const axesRef = useRef<Axes | null>(null);
  const viewRef = useRef<View | null>(null);
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
    // Fixed axis ranges from the Properties take precedence over automatic ranges.
    if (config.xMin != null) x0 = config.xMin;
    if (config.xMax != null) x1 = config.xMax;
    if (config.yMin != null) y0 = config.yMin;
    if (config.yMax != null) y1 = config.yMax;
    const cx = conv(chX);
    const cy = conv(chY);
    const rect = { x: 54, y: 10, w: Math.max(10, w - 54 - 14), h: Math.max(10, h - 10 - 40) };
    if (config.equalAspect && config.xMin == null && config.xMax == null && config.yMin == null && config.yMax == null) {
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
    drawAxes(ctx, T, A, x0, x1, y0, y1, `${channelLabel(config.x)}${cx.unit ? ` [${cx.unit}]` : ''}`, `${channelLabel(config.y)}${cy.unit ? ` [${cy.unit}]` : ''}`, { zeroLines: true });

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
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
    for (const s of sets.slice(1).concat(sets.slice(0, 1))) {
      if (!s.cs) ctx.fillStyle = withAlpha(s.l.color, sets.length > 1 ? 0.55 : 0.7);
      for (let i = 0; i < s.xs.length; i++) {
        if (s.gate && !s.gate[i]) continue;
        const x = s.xs[i],
          y = s.ys[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (s.cs) ctx.fillStyle = rampColor(config.ramp, theme, (s.cs[i] - cmn) / (cmx - cmn || 1));
        drawMarker(ctx, sets.length > 1 ? s.l.slot : 0, A.px(x), A.py(y), ps);
      }
    }
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
    // Grip envelope (G-G): the outer edge of every selected lap's points, and how much of it each lap
    // used on average while cornering / braking / accelerating.
    const envNotes: { color: string; text: string }[] = [];
    if (config.envelope && sets.length) {
      const env = gripEnvelope(sets);
      if (env) {
        // Amber, so it stands apart from the lap colours (blue reference, white comparison…).
        ctx.strokeStyle = CATEGORICAL[theme][3];
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        for (let b = 0; b <= ENV_BINS; b++) {
          const a = ((b % ENV_BINS) + 0.5) * ((2 * Math.PI) / ENV_BINS) - Math.PI;
          const r = env[b % ENV_BINS];
          const X = A.px(r * Math.cos(a));
          const Y = A.py(r * Math.sin(a));
          if (b === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        for (const s of sets) {
          const u = envelopeUse(s, env);
          if (Number.isFinite(u)) envNotes.push({ color: s.l.color, text: `${lapLabel(s.l.lap)}: ${Math.round(u * 100)}% of the grip envelope used` });
        }
      }
    }
    ctx.restore();
    ctx.fillStyle = T.text2;
    ctx.textAlign = 'left';
    notes.slice(0, 4).forEach((n, i) => ctx.fillText(n, rect.x + 8, rect.y + 12 + i * 14));
    envNotes.slice(0, 4).forEach((n, i) => {
      const y = rect.y + 12 + (notes.length + i) * 16;
      const tw = ctx.measureText(n.text).width + 10;
      ctx.fillStyle = withAlpha(n.color, 0.3);
      ctx.fillRect(rect.x + 6, y - 7, tw, 14);
      ctx.fillStyle = T.text;
      ctx.fillText(n.text, rect.x + 11, y);
    });
    if (viewRef.current) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'right';
      ctx.fillText('zoomed — double-click to reset', rect.x + rect.w - 6, rect.y + 10);
    }
    if (colorCh) {
      const cc = findChannel(sessions, colorCh);
      const cv = cc ? conv(cc) : null;
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
  }, [config.x, config.y, config.equalAspect, config.xMin, config.xMax, config.yMin, config.yMax]);


  return (
    <div ref={wrapRef} className="chart">
      <canvas ref={baseRef} />
      <canvas ref={overRef} />
      <BoxZoomLayer
        axesRef={axesRef}
        onView={(v) => {
          viewRef.current = v;
          drawBase();
          drawOverlay();
        }}
      />
    </div>
  );
}
