// Histogram: % of time spent in each value bin, per selected lap. Zone boundaries give a
// breakdown table — e.g. damper velocity zones (fast/slow rebound, slow/fast bump).

import { useCallback, useEffect, useRef } from 'react';
import { xToTime } from '../core/axis';
import { sampleAt } from '../core/channel';
import { withAlpha } from '../core/colors';
import { formatValue } from '../core/format';
import { lapLabel } from '../core/session';
import { selectedLaps, updateComponent, useStore } from '../state/store';
import type { HistogramConfig } from '../state/workspace';
import { openChannelPicker, openMenu, promptText } from '../ui/overlays';
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
    const sets: { l: (typeof laps)[number]; vals: Float64Array }[] = [];
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
      sets.push({ l, vals });
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
      return { pct, zones: zones.map((c) => (total ? (100 * c) / total : 0)), mean: total ? sum / total : NaN };
    });
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
      sets.forEach((s, si) => {
        ctx.fillStyle = s.l.color;
        ctx.fillRect(130 + si * colW, 11, 8, 6);
        ctx.fillStyle = T.text3;
        ctx.fillText(lapLabel(s.l.lap).replace('Lap ', 'L'), 142 + si * colW, 14);
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

  useEffect(() => {
    drawBase();
    drawOverlay();
  }, [drawBase, drawOverlay]);
  useStoreListener(drawOverlay, [drawOverlay]);

  return (
    <div
      ref={wrapRef}
      className="chart"
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
      <BoxZoomLayer
        axesRef={axesRef}
        onView={(v) => {
          viewRef.current = v;
          drawBase();
          drawOverlay();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e, [
            { label: 'Reset zoom', shortcut: 'double-click', onClick: () => ((viewRef.current = null), drawBase(), drawOverlay()) },
            { label: `Channel: ${config.channel}…`, onClick: () => openChannelPicker(e, (n) => updateComponent(config.id, { channel: n, min: undefined, max: undefined })) },
            {
              label: 'Zone boundaries…',
              onClick: async () => {
                const s = await promptText('Zone boundaries (comma separated)', config.zones.join(', '));
                if (s != null)
                  updateComponent(config.id, {
                    zones: s
                      .split(/[,\s]+/)
                      .map(Number)
                      .filter(Number.isFinite)
                      .sort((a, b) => a - b),
                  });
              },
            },
            { label: 'Cumulative', checked: config.cumulative, onClick: () => updateComponent(config.id, { cumulative: !config.cumulative }) },
            { label: 'Only zoomed range', checked: config.useZoom, onClick: () => updateComponent(config.id, { useZoom: !config.useZoom }) },
          ]);
        }}
      />
    </div>
  );
}
