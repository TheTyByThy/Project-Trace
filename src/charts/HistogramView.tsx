// Histogram: % of time spent in each value bin, per selected lap. Zone boundaries give a
// breakdown table — e.g. damper velocity zones (fast/slow rebound, slow/fast bump).

import { useCallback, useEffect, useRef, useState } from 'react';
import { xToTime } from '../core/axis';
import { sampleAt } from '../core/channel';
import { withAlpha } from '../core/colors';
import { formatValue } from '../core/format';
import { lapLabel } from '../core/session';
import { selectedLaps, updateComponent, useStore } from '../state/store';
import type { HistogramConfig } from '../state/workspace';
import { drawAxes, makeAxes, type Axes } from './axes';
import { BoxZoomLayer, type View } from './BoxZoom';
import { chartTheme, prepCanvas, useElementSize, useStoreListener } from './canvas';
import { channelDps, conv, findChannel, lapWindow } from './data';

function zoneLabel(zones: number[], i: number, dps: number) {
  const f = (v: number) => formatValue(v, dps);
  if (i === 0) return `< ${f(zones[0])}`;
  if (i === zones.length) return `> ${f(zones[zones.length - 1])}`;
  return `${f(zones[i - 1])} … ${f(zones[i])}`;
}

export function HistogramView({ config }: { config: HistogramConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const axesRef = useRef<Axes | null>(null);
  const viewRef = useRef<View | null>(null);
  /** What the hover tooltip needs about the bars that were drawn. */
  const binsRef = useRef<{
    lo: number;
    bw: number;
    nb: number;
    dps: number;
    unit: string;
    rows: { label: string; color: string; pct: number[]; secs: number[] }[];
  } | null>(null);
  const hoverRef = useRef<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; bin: number } | null>(null);
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
    binsRef.current = null;
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    const ch0 = findChannel(sessions, config.channel);
    if (!laps.length || !ch0) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText(!laps.length ? 'Select a lap' : `Channel not found: ${config.channel}`, w / 2, h / 2);
      return;
    }
    const cv = conv(ch0);
    const dps = channelDps(ch0);
    // Gather samples per lap.
    const sets: { l: (typeof laps)[number]; vals: Float64Array; rate: number }[] = [];
    let mn = Infinity,
      mx = -Infinity;
    for (const l of laps) {
      const ch = l.session.channels.get(config.channel);
      if (!ch) continue;
      const [ta, tb] = lapWindow(l.lap, config.useZoom, st.zoom, st.xMode);
      const i0 = Math.max(0, Math.ceil((ta - ch.t0) * ch.rate));
      const i1 = Math.min(ch.n - 1, Math.floor((tb - ch.t0) * ch.rate));
      const vals = new Float64Array(Math.max(0, i1 - i0 + 1));
      for (let i = i0; i <= i1; i++) {
        const v = ch.data[i] * cv.k + cv.b;
        vals[i - i0] = v;
        if (Number.isFinite(v)) {
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      sets.push({ l, vals, rate: ch.rate });
    }
    // Box-zoom re-bins the zoomed x-range for more detail.
    const lo = viewRef.current?.x0 ?? config.min ?? mn;
    const hi = viewRef.current?.x1 ?? config.max ?? mx;
    const nb = Math.max(1, config.bins);
    const bw = (hi - lo) / nb || 1;
    const hists = sets.map((s) => {
      const counts = new Float64Array(nb);
      let total = 0;
      for (const v of s.vals) {
        if (!Number.isFinite(v)) continue;
        total++;
        if (v < lo || v > hi) continue;
        counts[Math.min(nb - 1, Math.floor((v - lo) / bw))]++;
      }
      const pct = Array.from(counts, (c) => (total ? (100 * c) / total : 0));
      const rawPct = pct.slice();
      const secs = Array.from(counts, (c) => c / s.rate);
      if (config.cumulative) for (let i = 1; i < nb; i++) pct[i] += pct[i - 1];
      const zones = new Array(config.zones.length + 1).fill(0);
      let sum = 0;
      for (const v of s.vals) {
        if (!Number.isFinite(v)) continue;
        sum += v;
        let z = 0;
        while (z < config.zones.length && v >= config.zones[z]) z++;
        zones[z]++;
      }
      return { pct, rawPct, secs, zones: zones.map((c) => (total ? (100 * c) / total : 0)), mean: total ? sum / total : NaN };
    });
    binsRef.current = {
      lo,
      bw,
      nb,
      dps,
      unit: cv.unit,
      rows: sets.map((st2, si) => ({ label: lapLabel(st2.l.lap), color: st2.l.color, pct: hists[si].rawPct, secs: hists[si].secs })),
    };
    const yMax = viewRef.current ? viewRef.current.y1 : Math.max(1, ...hists.flatMap((hh) => hh.pct)) * 1.1;
    const yMin = viewRef.current ? Math.max(0, viewRef.current.y0) : 0;
    const tableH = config.zones.length ? 16 + 14 * (config.zones.length + 1) : 0;
    const rect = { x: 50, y: 10 + tableH, w: Math.max(10, w - 50 - 12), h: Math.max(10, h - 10 - 40 - tableH) };
    const A = makeAxes(rect, lo, hi, yMin, yMax);
    axesRef.current = A;
    drawAxes(ctx, T, A, lo, hi, yMin, yMax, `${config.channel}${cv.unit ? ` [${cv.unit}]` : ''}`, config.cumulative ? 'cumulative % time' : '% time');
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    const group = sets.length;
    const slotW = (A.px(lo + bw) - A.px(lo)) / Math.max(1, group);
    hists.forEach((hh, si) => {
      const color = group > 1 ? sets[si].l.color : T.accent;
      for (let b = 0; b < nb; b++) {
        const x = A.px(lo + b * bw) + si * slotW + 1;
        const y = A.py(hh.pct[b]);
        const bwPx = Math.max(1, slotW - 2);
        ctx.fillStyle = withAlpha(color, 0.85);
        ctx.fillRect(x, y, bwPx, A.py(yMin) - y);
      }
      // mean marker
      if (Number.isFinite(hh.mean)) {
        ctx.strokeStyle = color;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(A.px(hh.mean) + 0.5, rect.y);
        ctx.lineTo(A.px(hh.mean) + 0.5, rect.y + rect.h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    ctx.restore();
    // zones
    if (config.zones.length) {
      ctx.strokeStyle = T.text2;
      for (const z of config.zones) {
        if (z < lo || z > hi) continue;
        ctx.beginPath();
        ctx.moveTo(Math.round(A.px(z)) + 0.5, rect.y);
        ctx.lineTo(Math.round(A.px(z)) + 0.5, rect.y + rect.h);
        ctx.stroke();
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = T.text3;
      ctx.fillText('Zone', 10, 14);
      const colW = Math.min(110, (w - 140) / Math.max(1, sets.length));
      // One column per lap on a translucent background in the lap's colour.
      sets.forEach((s, si) => {
        ctx.fillStyle = withAlpha(s.l.color, 0.2);
        ctx.fillRect(126 + si * colW, 6, colW - 8, 16 + (config.zones.length + 1) * 14);
        ctx.fillStyle = T.text;
        ctx.fillText(lapLabel(s.l.lap).replace('Lap ', 'L'), 130 + si * colW, 14);
      });
      for (let z = 0; z <= config.zones.length; z++) {
        const y = 28 + z * 14;
        ctx.fillStyle = T.text2;
        ctx.fillText(zoneLabel(config.zones, z, dps), 10, y);
        hists.forEach((hh, si) => {
          ctx.fillStyle = T.text;
          ctx.font = T.mono;
          ctx.fillText(`${hh.zones[z].toFixed(1)}%`, 130 + si * colW, y);
          ctx.font = T.font;
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, sessions, lapSel, refKey, zoom, xMode, dataVersion, theme]);

  const drawOverlay = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(overRef.current, w, h);
    const A = axesRef.current;
    if (!ctx || !A) return;
    const st = useStore.getState();
    if (st.cursor == null) return;
    const ref = selectedLaps(st)[0];
    const ch = ref?.session.channels.get(config.channel);
    if (!ch) return;
    const c = conv(ch);
    const v = sampleAt(ch, xToTime(ref.lap, st.cursor, st.xMode)) * c.k + c.b;
    const X = Math.round(A.px(v)) + 0.5;
    if (X < A.rect.x || X > A.rect.x + A.rect.w) return;
    const T = chartTheme();
    ctx.strokeStyle = T.cursor;
    ctx.beginPath();
    ctx.moveTo(X, A.rect.y);
    ctx.lineTo(X, A.rect.y + A.rect.h);
    ctx.stroke();
  }, [size, config]);

  /** Outline of the hovered bin (drawn on top of the cursor layer). */
  const drawHover = useCallback(() => {
    drawOverlay();
    const A = axesRef.current;
    const B = binsRef.current;
    const b = hoverRef.current;
    const ctx = overRef.current?.getContext('2d');
    if (!A || !B || b == null || !ctx) return;
    const T = chartTheme();
    const x0 = A.px(B.lo + b * B.bw);
    const x1 = A.px(B.lo + (b + 1) * B.bw);
    ctx.save();
    ctx.fillStyle = withAlpha(T.text, 0.07);
    ctx.fillRect(x0, A.rect.y, x1 - x0, A.rect.h);
    ctx.strokeStyle = withAlpha(T.text, 0.5);
    ctx.strokeRect(Math.round(x0) + 0.5, A.rect.y + 0.5, Math.round(x1 - x0), A.rect.h - 1);
    ctx.restore();
  }, [drawOverlay]);

  const onHover = (e: React.MouseEvent) => {
    const A = axesRef.current;
    const B = binsRef.current;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let bin: number | null = null;
    if (A && B && x >= A.rect.x && x <= A.rect.x + A.rect.w && y >= A.rect.y && y <= A.rect.y + A.rect.h) {
      const b = Math.floor((A.ix(x) - B.lo) / B.bw);
      if (b >= 0 && b < B.nb) bin = b;
    }
    if (bin !== hoverRef.current) {
      hoverRef.current = bin;
      drawHover();
    }
    setTip(bin == null ? null : { x, y, bin });
  };

  useEffect(() => {
    drawBase();
    drawOverlay();
  }, [drawBase, drawOverlay]);
  useStoreListener(drawHover, [drawHover]);

  const B = binsRef.current;
  const binLabel = (b: number) => {
    if (!B) return '';
    const a = B.lo + b * B.bw;
    const c = a + B.bw / 2;
    const f = (v: number) => formatValue(v, B.dps);
    // Bins centred on whole numbers one unit wide (gears, modes…) read as a single value.
    if (Math.abs(B.bw - 1) < 1e-9 && Math.abs(c - Math.round(c)) < 1e-9) {
      const n = Math.round(c);
      const gear = /gear/i.test(config.channel);
      return `${config.channel} ${gear && n === 0 ? 'N' : gear && n < 0 ? 'R' : n}`;
    }
    return `${f(a)} – ${f(a + B.bw)}${B.unit ? ` ${B.unit}` : ''}`;
  };

  return (
    <div
      ref={wrapRef}
      className="chart"
      onMouseMove={onHover}
      onMouseLeave={() => {
        hoverRef.current = null;
        setTip(null);
        drawHover();
      }}
      onDragOver={(e) => e.dataTransfer.types.includes('application/x-pt-channel') && (e.preventDefault(), e.stopPropagation())}
      onDrop={(e) => {
        const n = e.dataTransfer.getData('application/x-pt-channel');
        if (n) {
          e.preventDefault();
          e.stopPropagation();
          updateComponent(config.id, { channel: n, min: undefined, max: undefined });
        }
      }}
    >
      <canvas ref={baseRef} />
      <canvas ref={overRef} />
      {tip && B && (
        <div className="chart-tip" style={{ left: Math.min(tip.x + 14, size.w - 220), top: Math.max(4, tip.y - 10) }}>
          <b>{binLabel(tip.bin)}</b>
          {B.rows.map((r) => (
            <div key={r.label} className="row" style={{ gap: 6, background: B.rows.length > 1 ? withAlpha(r.color, 0.22) : undefined, padding: '1px 4px', borderRadius: 3 }}>
              <span className="grow">{r.label}</span>
              <span className="num">{r.pct[tip.bin].toFixed(1)}%</span>
              <span className="num muted">{r.secs[tip.bin].toFixed(1)} s</span>
            </div>
          ))}
        </div>
      )}
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
