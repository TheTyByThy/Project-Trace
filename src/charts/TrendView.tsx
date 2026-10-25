// Lap trend: one statistic per lap across the session (lap time by default). Each loaded session
// is a series; invalid laps are drawn hollow. Click a point to make that lap the reference; drag a
// rectangle to zoom; the y-axis range can be fixed in the Properties.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CATEGORICAL } from '../core/colors';
import { formatLapTime, formatValue, prettyTrack } from '../core/format';
import { rangeStats } from '../core/stats';
import { lapKey, type Lap, type Session } from '../core/types';
import { selectLap, sessionsWithSelection, useStore } from '../state/store';
import type { TrendConfig } from '../state/workspace';
import { drawAxes, drawMarker, makeAxes, padRange, type Axes } from './axes';
import { BoxZoomLayer, type View } from './BoxZoom';
import { chartTheme, prepCanvas, useElementSize } from './canvas';
import { channelDps, channelLabel, conv } from './data';

function lapStat(s: Session, lap: Lap, cfg: TrendConfig): number {
  if (!cfg.channel) return lap.complete ? lap.time : NaN;
  const ch = s.channels.get(cfg.channel);
  if (!ch) return NaN;
  const i0 = Math.max(0, Math.ceil((lap.start - ch.t0) * ch.rate));
  const i1 = Math.min(ch.n - 1, Math.floor((lap.end - ch.t0) * ch.rate));
  const st = rangeStats(ch.data, i0, i1);
  const c = conv(ch);
  const raw = cfg.stat === 'mean' ? st.mean : cfg.stat === 'max' ? st.max : cfg.stat === 'min' ? st.min : cfg.stat === 'first' ? st.first : cfg.stat === 'last' ? st.last : st.last - st.first;
  return cfg.stat === 'delta' ? raw * c.k : raw * c.k + c.b;
}

export function TrendView({ config }: { config: TrendConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const ref = useRef<HTMLCanvasElement>(null);
  const axesRef = useRef<Axes | null>(null);
  const viewRef = useRef<View | null>(null);
  const hitsRef = useRef<{ x: number; y: number; key: string }[]>([]);
  const allSessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  // Only stints with a selected lap (reference or comparison).
  const sessions = useMemo(() => sessionsWithSelection(allSessions, lapSel), [allSessions, lapSel]);
  const refKey = useStore((s) => s.refKey);
  const dataVersion = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);

  const draw = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(ref.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    hitsRef.current = [];
    axesRef.current = null;
    const series = sessions.map((s, si) => ({
      s,
      color: CATEGORICAL[theme][si % 8],
      pts: s.laps
        .map((l) => ({ l, v: lapStat(s, l, config) }))
        .filter((p) => Number.isFinite(p.v) && (!config.validOnly || !p.l.invalid) && (config.channel ? true : p.l.complete)),
    }));
    const all = series.flatMap((sr) => sr.pts);
    if (!all.length) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText(sessions.length ? 'No data for this statistic' : 'Open a session', w / 2, h / 2);
      return;
    }
    const maxLap = Math.max(...all.map((p) => p.l.number));
    let [y0, y1] = padRange(Math.min(...all.map((p) => p.v)), Math.max(...all.map((p) => p.v)), 0.12);
    if (config.yMin != null) y0 = config.yMin;
    if (config.yMax != null) y1 = config.yMax;
    let x0 = 0.5,
      x1 = maxLap + 0.5;
    if (viewRef.current) ({ x0, x1, y0, y1 } = viewRef.current);
    const rect = { x: 60, y: 12, w: Math.max(10, w - 60 - 14), h: Math.max(10, h - 12 - 40) };
    const A = makeAxes(rect, x0, x1, y0, y1);
    axesRef.current = A;
    const ch = config.channel ? sessions[0]?.channels.get(config.channel) : undefined;
    const unit = ch ? conv(ch).unit : 's';
    const dps = ch ? channelDps(ch) : 3;
    const label = config.channel ? `${config.stat} ${channelLabel(config.channel)}${unit ? ` [${unit}]` : ''}` : 'lap time';
    drawAxes(ctx, T, A, x0, x1, y0, y1, 'lap', label, {
      xFmt: (v) => (Number.isInteger(Math.round(v * 1000) / 1000) ? String(Math.round(v)) : ''),
      yFmt: (v, step) => (config.channel ? formatValue(v, step < 1 ? 2 : 0) : formatLapTime(v, step < 0.1 ? 2 : 1)),
    });
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    for (const sr of series) {
      ctx.strokeStyle = sr.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      sr.pts.forEach((p, i) => {
        const X = A.px(p.l.number),
          Y = A.py(p.v);
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      for (const p of sr.pts) {
        const X = A.px(p.l.number),
          Y = A.py(p.v);
        const key = lapKey({ sessionId: sr.s.id, lapIndex: p.l.index });
        hitsRef.current.push({ x: X, y: Y, key });
        const selected = lapSel.some((l) => l.key === key);
        ctx.fillStyle = sr.color;
        if (p.l.invalid) {
          ctx.strokeStyle = sr.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(X, Y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = T.surface;
          ctx.fill();
          ctx.stroke();
        } else drawMarker(ctx, 1, X, Y, 9);
        if (selected) {
          ctx.strokeStyle = key === refKey ? T.cursor : T.text3;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(X, Y, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (rect.w / Math.max(1, x1 - x0) > 46) {
          ctx.fillStyle = T.text2;
          ctx.textAlign = 'center';
          ctx.fillText(config.channel ? formatValue(p.v, dps) : formatLapTime(p.v), X, Y - 14);
        }
      }
    }
    ctx.restore();
    if (series.length > 1) {
      let x = rect.x + 8;
      for (const sr of series) {
        ctx.fillStyle = sr.color;
        ctx.fillRect(x, rect.y + 6, 10, 4);
        ctx.fillStyle = T.text2;
        ctx.textAlign = 'left';
        const name = `${prettyTrack(sr.s.meta.venue).track} ${new Date(sr.s.meta.savedAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        ctx.fillText(name, x + 14, rect.y + 8);
        x += ctx.measureText(name).width + 30;
      }
    }
    ctx.fillStyle = T.text3;
    ctx.textAlign = 'left';
    ctx.fillText(viewRef.current ? 'zoomed — double-click to reset' : 'hollow = invalid lap · click a point to make it the reference · drag to zoom', rect.x, h - 8);
  }, [size, config, sessions, lapSel, refKey, dataVersion, theme]);

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
        onClick={(x, y, e) => {
          const hit = hitsRef.current.find((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 100);
          if (hit) selectLap(hit.key, e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
        }}
      />
    </div>
  );
}
