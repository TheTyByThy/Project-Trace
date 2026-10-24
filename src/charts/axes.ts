// Cartesian axes used by scatter, histogram, mixture, FFT and trend charts.

import { niceTicks } from '../core/stats';
import { fmtTick, type ChartTheme } from './canvas';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Axes {
  rect: Rect;
  px: (x: number) => number;
  py: (y: number) => number;
  ix: (px: number) => number;
  iy: (py: number) => number;
}

export function makeAxes(rect: Rect, x0: number, x1: number, y0: number, y1: number): Axes {
  const sx = rect.w / (x1 - x0 || 1);
  const sy = rect.h / (y1 - y0 || 1);
  return {
    rect,
    px: (x) => rect.x + (x - x0) * sx,
    py: (y) => rect.y + rect.h - (y - y0) * sy,
    ix: (p) => x0 + (p - rect.x) / sx,
    iy: (p) => y0 + (rect.y + rect.h - p) / sy,
  };
}

export function drawAxes(
  ctx: CanvasRenderingContext2D,
  T: ChartTheme,
  A: Axes,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  xLabel: string,
  yLabel: string,
  opts: { xFmt?: (v: number, step: number) => string; yFmt?: (v: number, step: number) => string; zeroLines?: boolean } = {},
) {
  const { rect } = A;
  ctx.font = T.font;
  ctx.textBaseline = 'middle';
  const xt = niceTicks(x0, x1, Math.max(2, Math.floor(rect.w / 80)));
  const yt = niceTicks(y0, y1, Math.max(2, Math.floor(rect.h / 32)));
  ctx.strokeStyle = T.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of xt.ticks) {
    const X = Math.round(A.px(t)) + 0.5;
    ctx.moveTo(X, rect.y);
    ctx.lineTo(X, rect.y + rect.h);
  }
  for (const t of yt.ticks) {
    const Y = Math.round(A.py(t)) + 0.5;
    ctx.moveTo(rect.x, Y);
    ctx.lineTo(rect.x + rect.w, Y);
  }
  ctx.stroke();
  if (opts.zeroLines) {
    ctx.strokeStyle = T.gridStrong;
    ctx.beginPath();
    if (x0 < 0 && x1 > 0) {
      const X = Math.round(A.px(0)) + 0.5;
      ctx.moveTo(X, rect.y);
      ctx.lineTo(X, rect.y + rect.h);
    }
    if (y0 < 0 && y1 > 0) {
      const Y = Math.round(A.py(0)) + 0.5;
      ctx.moveTo(rect.x, Y);
      ctx.lineTo(rect.x + rect.w, Y);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = T.border;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
  ctx.fillStyle = T.text3;
  ctx.textAlign = 'center';
  for (const t of xt.ticks) ctx.fillText(opts.xFmt ? opts.xFmt(t, xt.step) : fmtTick(t, xt.step), A.px(t), rect.y + rect.h + 10);
  ctx.textAlign = 'right';
  for (const t of yt.ticks) ctx.fillText(opts.yFmt ? opts.yFmt(t, yt.step) : fmtTick(t, yt.step), rect.x - 5, A.py(t));
  ctx.fillStyle = T.text2;
  ctx.textAlign = 'right';
  ctx.fillText(xLabel, rect.x + rect.w, rect.y + rect.h + 24);
  ctx.save();
  ctx.translate(rect.x - 40, rect.y + rect.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

export function padRange(a: number, b: number, f = 0.05): [number, number] {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [0, 1];
  if (b - a < 1e-9) return [a - 1, b + 1];
  const p = (b - a) * f;
  return [a - p, b + p];
}

/** Marker shapes by lap slot — secondary encoding so laps aren't distinguished by colour alone. */
export function drawMarker(ctx: CanvasRenderingContext2D, shape: number, x: number, y: number, s: number) {
  switch (shape % 4) {
    case 0:
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      break;
    case 1:
      ctx.beginPath();
      ctx.arc(x, y, s / 1.7, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 2:
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.7);
      ctx.lineTo(x + s * 0.65, y + s * 0.5);
      ctx.lineTo(x - s * 0.65, y + s * 0.5);
      ctx.fill();
      break;
    case 3:
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.7);
      ctx.lineTo(x + s * 0.7, y);
      ctx.lineTo(x, y + s * 0.7);
      ctx.lineTo(x - s * 0.7, y);
      ctx.fill();
      break;
  }
}
