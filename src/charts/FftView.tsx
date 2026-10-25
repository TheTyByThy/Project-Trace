// Frequency analysis (FFT magnitude spectrum) of a channel over the reference lap or zoomed range.

import { useCallback, useEffect, useRef } from 'react';
import { fftMagnitude } from '../core/stats';
import { selectedLaps, useStore } from '../state/store';
import type { FftConfig } from '../state/workspace';
import { drawAxes, makeAxes, type Axes } from './axes';
import { BoxZoomLayer, type View } from './BoxZoom';
import { chartTheme, prepCanvas, useElementSize } from './canvas';
import { channelLabel, conv, lapWindow } from './data';

export function FftView({ config }: { config: FftConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const ref = useRef<HTMLCanvasElement>(null);
  const axesRef = useRef<Axes | null>(null);
  const viewRef = useRef<View | null>(null);
  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const zoom = useStore((s) => (config.useZoom ? s.zoom : null));
  const dataVersion = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);

  const draw = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(ref.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    const st = useStore.getState();
    const laps = selectedLaps(st);
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    const sets = laps
      .map((l) => {
        const ch = l.session.channels.get(config.channel);
        if (!ch) return null;
        const [ta, tb] = lapWindow(l.lap, config.useZoom, st.zoom, st.xMode);
        const i0 = Math.max(0, Math.ceil((ta - ch.t0) * ch.rate));
        const i1 = Math.min(ch.n - 1, Math.floor((tb - ch.t0) * ch.rate));
        if (i1 - i0 < 16) return null;
        const c = conv(ch);
        const seg = new Float64Array(i1 - i0 + 1);
        for (let i = i0; i <= i1; i++) seg[i - i0] = ch.data[i] * c.k + c.b;
        return { l, ...fftMagnitude(seg, ch.rate), unit: c.unit, rate: ch.rate };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (!sets.length) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText(laps.length ? `Channel not found or too short: ${config.channel}` : 'Select a lap', w / 2, h / 2);
      return;
    }
    const maxHz = Math.min(config.maxHz, sets[0].rate / 2);
    // Scale to the ride band (≥ 0.5 Hz); below that is driver input / aero platform movement.
    const minHz = 0.5;
    let ymax = 0;
    for (const s of sets) for (let k = 1; k < s.freqs.length && s.freqs[k] <= maxHz; k++) if (s.freqs[k] >= minHz) ymax = Math.max(ymax, s.mags[k]);
    const tf = (v: number) => (config.logScale ? Math.log10(Math.max(1e-6, v)) : v);
    let y0 = config.logScale ? tf(ymax) - 4 : 0;
    let y1 = tf(ymax) * (config.logScale ? 1 : 1.1) + (config.logScale ? 0.2 : 0);
    let fx0 = 0,
      fx1 = maxHz;
    if (viewRef.current) ({ x0: fx0, x1: fx1, y0, y1 } = viewRef.current);
    const rect = { x: 54, y: 10, w: Math.max(10, w - 54 - 12), h: Math.max(10, h - 10 - 40) };
    const A = makeAxes(rect, fx0, fx1, y0, y1);
    axesRef.current = A;
    drawAxes(ctx, T, A, fx0, fx1, y0, y1, 'frequency [Hz]', `${channelLabel(config.channel)} amplitude${config.logScale ? ' (log₁₀)' : ''}`);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    const notes: string[] = [];
    for (const s of sets) {
      ctx.strokeStyle = sets.length > 1 ? s.l.color : T.accent;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let peak = -1;
      for (let k = 1; k < s.freqs.length && s.freqs[k] <= maxHz; k++) {
        const X = A.px(s.freqs[k]);
        const Y = A.py(tf(s.mags[k]));
        if (k === 1) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
        if (s.freqs[k] >= minHz && (peak < 0 || s.mags[k] > s.mags[peak])) peak = k;
      }
      ctx.stroke();
      if (peak >= 0) {
        notes.push(`${sets.length > 1 ? `L${s.l.lap.number} ` : ''}peak ${s.freqs[peak].toFixed(2)} Hz`);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(A.px(s.freqs[peak]), rect.y);
        ctx.lineTo(A.px(s.freqs[peak]), rect.y + rect.h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
    ctx.fillStyle = T.text2;
    ctx.textAlign = 'right';
    notes.slice(0, 3).forEach((n, i) => ctx.fillText(n, rect.x + rect.w - 8, rect.y + 12 + i * 14));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, sessions, lapSel, refKey, zoom, dataVersion, theme]);
  useEffect(draw, [draw]);

  return (
    <div ref={wrapRef} className="chart">
      <canvas ref={ref} />
      <BoxZoomLayer
        axesRef={axesRef}
        onView={(v) => {
          viewRef.current = v;
          draw();
        }}
      />
    </div>
  );
}
