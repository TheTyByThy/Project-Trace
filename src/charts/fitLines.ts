// Drawing and right-click toggles for best-fit lines (Lap Trend, Scatter).

import { FIT_KINDS, fitSettings, type Fit, type FitOptions } from '../core/fit';
import { updateComponent } from '../state/store';
import type { ComponentConfig } from '../state/workspace';
import type { MenuItem } from '../ui/overlays';
import type { Axes } from './axes';

/** The fitted curve from x0 to x1, long-dashed, skipping where it's undefined (ln of x ≤ 0…). */
export function drawFitLine(ctx: CanvasRenderingContext2D, A: Axes, f: Fit, x0: number, x1: number, color: string, width = 2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([10, 5]);
  ctx.beginPath();
  let pen = false;
  for (let k = 0; k <= 160; k++) {
    const x = x0 + ((x1 - x0) * k) / 160;
    const y = f.eval(x);
    if (!Number.isFinite(y)) {
      pen = false;
      continue;
    }
    if (pen) ctx.lineTo(A.px(x), A.py(y));
    else ctx.moveTo(A.px(x), A.py(y));
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}

/** Equation lines in a translucent box at (x, y), each with its series colour swatch. */
export function drawFitNotes(ctx: CanvasRenderingContext2D, notes: { color: string; text: string }[], x: number, y: number, surface: string, text: string) {
  if (!notes.length) return;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const w = Math.max(...notes.map((n) => ctx.measureText(n.text).width)) + 28;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = surface;
  ctx.fillRect(x, y, w, notes.length * 16 + 6);
  ctx.globalAlpha = 1;
  notes.forEach((n, i) => {
    const cy = y + 11 + i * 16;
    ctx.fillStyle = n.color;
    ctx.fillRect(x + 6, cy - 1.5, 12, 3);
    ctx.fillStyle = text;
    ctx.fillText(n.text, x + 22, cy);
  });
  ctx.restore();
}

/** "Best fit line (Linear)" and "Show fit equation" for a component's right-click menu. */
export function fitMenuItems(config: ComponentConfig & FitOptions): MenuItem[] {
  const f = fitSettings(config);
  const kindLabel = FIT_KINDS.find(([k]) => k === f.kind)?.[1] ?? f.kind;
  return [
    { label: `Best fit line (${kindLabel})`, checked: f.on, onClick: () => updateComponent(config.id, { showFit: !f.on, fit: f.kind } as Partial<ComponentConfig>, 'Best fit line') },
    { label: 'Show fit equation', checked: f.on && f.equation, disabled: !f.on, onClick: () => updateComponent(config.id, { showEquation: !f.equation } as Partial<ComponentConfig>, 'Fit equation') },
  ];
}
