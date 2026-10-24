// Shared canvas plumbing for every chart: HiDPI setup, theme colours, element sizing, ticks
// and a decimating trace renderer (M4: first/min/max/last per pixel column).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

export function prepCanvas(canvas: HTMLCanvasElement | null, w: number, h: number): CanvasRenderingContext2D | null {
  if (!canvas || w <= 0 || h <= 0) return null;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

export interface ChartTheme {
  surface: string;
  surface2: string;
  grid: string;
  gridStrong: string;
  axis: string;
  text: string;
  text2: string;
  text3: string;
  cursor: string;
  road: string;
  accent: string;
  accentSoft: string;
  border: string;
  gain: string;
  loss: string;
  font: string;
  mono: string;
}

let themeCache: { key: string; theme: ChartTheme } | null = null;
export function chartTheme(): ChartTheme {
  const key = document.documentElement.dataset.theme || 'dark';
  if (themeCache && themeCache.key === key) return themeCache.theme;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const theme: ChartTheme = {
    surface: v('--surface'),
    surface2: v('--surface-2'),
    grid: v('--grid'),
    gridStrong: v('--grid-strong'),
    axis: v('--axis'),
    text: v('--text'),
    text2: v('--text-2'),
    text3: v('--text-3'),
    cursor: v('--cursor'),
    road: v('--road'),
    accent: v('--accent'),
    accentSoft: v('--accent-soft'),
    border: v('--border'),
    gain: v('--gain'),
    loss: v('--loss'),
    font: '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '11px "SF Mono", "Cascadia Mono", Consolas, Menlo, monospace',
  };
  themeCache = { key, theme };
  return theme;
}

export function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: Math.floor(r.width), h: Math.floor(r.height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Subscribe to store changes imperatively (no React re-render). */
export function useStoreListener(fn: () => void, deps: unknown[]) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let last = useStore.getState();
    return useStore.subscribe((s) => {
      if (s.cursor !== last.cursor || s.measure !== last.measure || s.zoom !== last.zoom) fnRef.current();
      last = s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Binary search: first index with xs[i] >= x. */
export function lowerBound(xs: ArrayLike<number>, x: number): number {
  let lo = 0,
    hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface TraceOpts {
  xs: ArrayLike<number>; // x per point (offset 0 → data[off])
  data: ArrayLike<number>;
  off: number;
  k: number; // display conversion
  b: number;
  x0: number; // visible range
  x1: number;
  px: (x: number) => number;
  py: (v: number) => number;
  step: boolean;
}

/** Draw a polyline with per-pixel-column decimation. Assumes xs is non-decreasing. */
export function drawTrace(ctx: CanvasRenderingContext2D, o: TraceOpts) {
  const n = o.xs.length;
  if (n === 0) return;
  let i = Math.max(0, lowerBound(o.xs, o.x0) - 1);
  const end = Math.min(n - 1, lowerBound(o.xs, o.x1));
  const pxSpan = Math.abs(o.px(o.x1) - o.px(o.x0));
  const dense = end - i > pxSpan * 2.5;
  ctx.beginPath();
  let pen = false;
  if (!dense) {
    let prevY = 0;
    for (; i <= end; i++) {
      const v = o.data[o.off + i];
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const X = o.px(o.xs[i]);
      const Y = o.py(v * o.k + o.b);
      if (!pen) {
        ctx.moveTo(X, Y);
        pen = true;
      } else {
        if (o.step) ctx.lineTo(X, prevY);
        ctx.lineTo(X, Y);
      }
      prevY = Y;
    }
  } else {
    let col = NaN,
      first = 0,
      last = 0,
      mn = 0,
      mx = 0,
      have = false;
    const flush = () => {
      if (!have) return;
      if (!pen) {
        ctx.moveTo(col, first);
        pen = true;
      } else ctx.lineTo(col, first);
      if (mn !== first) ctx.lineTo(col, mn);
      if (mx !== mn) ctx.lineTo(col, mx);
      if (last !== mx) ctx.lineTo(col, last);
      have = false;
    };
    for (; i <= end; i++) {
      const v = o.data[o.off + i];
      if (!Number.isFinite(v)) {
        flush();
        pen = false;
        continue;
      }
      const X = Math.round(o.px(o.xs[i]));
      const Y = o.py(v * o.k + o.b);
      if (X !== col) {
        flush();
        col = X;
        first = last = mn = mx = Y;
        have = true;
      } else {
        last = Y;
        if (Y < mn) mn = Y;
        if (Y > mx) mx = Y;
      }
    }
    flush();
  }
  ctx.stroke();
}

export function fmtTick(v: number, step: number): string {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(step);
  const d = a >= 1 ? 0 : a >= 0.1 ? 1 : a >= 0.01 ? 2 : 3;
  const s = v.toFixed(d);
  return s === '-0' ? '0' : s;
}

/** Download-free helper: draw a rounded rectangle path. */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
