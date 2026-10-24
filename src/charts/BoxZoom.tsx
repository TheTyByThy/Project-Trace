// Interaction layer for XY-style charts (scatter, lap trend, histogram, FFT):
// drag a rectangle to zoom into it, scroll to zoom around the mouse, right/middle-drag to pan,
// double-click to reset, plain click → onClick (e.g. pick a lap in the trend chart).

import { useEffect, useRef } from 'react';
import { withAlpha } from '../core/colors';
import type { Axes } from './axes';
import { chartTheme, prepCanvas } from './canvas';

export interface View {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function currentView(A: Axes): View {
  return { x0: A.ix(A.rect.x), x1: A.ix(A.rect.x + A.rect.w), y0: A.iy(A.rect.y + A.rect.h), y1: A.iy(A.rect.y) };
}

export function BoxZoomLayer({
  axesRef,
  onView,
  onClick,
  onContextMenu,
  lockY = false,
}: {
  axesRef: React.RefObject<Axes | null>;
  onView: (v: View | null) => void;
  onClick?: (x: number, y: number, e: React.PointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Only zoom/pan horizontally (y stays automatic). */
  lockY?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ mode: 'box' | 'pan'; x: number; y: number; cx: number; cy: number; moved: boolean; v0: View } | null>(null);
  // A right-button pan ends with a contextmenu event on Windows; swallow that one.
  const panEndedAt = useRef(0);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  const drawBox = (x0: number, y0: number, x1: number, y1: number, w: number, h: number) => {
    const ctx = prepCanvas(ref.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    const A = axesRef.current;
    const top = lockY && A ? A.rect.y : Math.min(y0, y1);
    const bh = lockY && A ? A.rect.h : Math.abs(y1 - y0);
    ctx.fillStyle = withAlpha(T.accent, 0.12);
    ctx.fillRect(Math.min(x0, x1), top, Math.abs(x1 - x0), bh);
    ctx.strokeStyle = withAlpha(T.accent, 0.8);
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.min(x0, x1) + 0.5, top + 0.5, Math.abs(x1 - x0), bh);
  };
  const clear = () => {
    const c = ref.current;
    if (c) prepCanvas(c, c.clientWidth, c.clientHeight);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const A = axesRef.current;
      if (!A) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = A.ix(e.clientX - r.left);
      const my = A.iy(e.clientY - r.top);
      const v = currentView(A);
      const f = Math.pow(1.0015, e.deltaY);
      onView({
        x0: mx - (mx - v.x0) * f,
        x1: mx + (v.x1 - mx) * f,
        y0: lockY ? v.y0 : my - (my - v.y0) * f,
        y1: lockY ? v.y1 : my + (v.y1 - my) * f,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={(e) => {
        const A = axesRef.current;
        if (!A) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const p = local(e);
        drag.current = { mode: e.button === 0 && !e.ctrlKey && !e.metaKey ? 'box' : 'pan', x: p.x, y: p.y, cx: p.x, cy: p.y, moved: false, v0: currentView(A) };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const A = axesRef.current;
        if (!d || !A) return;
        const p = local(e);
        if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 5) d.moved = true;
        if (!d.moved) return;
        if (d.mode === 'box') drawBox(d.x, d.y, p.x, p.y, p.w, p.h);
        else {
          const dx = A.ix(p.x) - A.ix(d.x);
          const dy = A.iy(p.y) - A.iy(d.y);
          onView({ x0: d.v0.x0 - dx, x1: d.v0.x1 - dx, y0: lockY ? d.v0.y0 : d.v0.y0 - dy, y1: lockY ? d.v0.y1 : d.v0.y1 - dy });
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        const A = axesRef.current;
        drag.current = null;
        clear();
        if (!d || !A) return;
        if (d.mode === 'pan' && d.moved) panEndedAt.current = performance.now();
        const p = local(e);
        if (!d.moved) {
          if (e.button === 0) onClick?.(p.x, p.y, e);
          return;
        }
        if (d.mode === 'box' && Math.abs(p.x - d.x) > 6 && (lockY || Math.abs(p.y - d.y) > 6)) {
          const xa = A.ix(Math.min(d.x, p.x)),
            xb = A.ix(Math.max(d.x, p.x));
          const ya = A.iy(Math.max(d.y, p.y)),
            yb = A.iy(Math.min(d.y, p.y));
          onView(lockY ? { x0: xa, x1: xb, y0: d.v0.y0, y1: d.v0.y1 } : { x0: xa, x1: xb, y0: ya, y1: yb });
        }
      }}
      onDoubleClick={() => onView(null)}
      onContextMenu={(e) => {
        if (drag.current?.moved || performance.now() - panEndedAt.current < 300) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onContextMenu?.(e);
      }}
    />
  );
}
