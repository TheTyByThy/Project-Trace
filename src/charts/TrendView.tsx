// Lap trend: one statistic per lap across the session (lap time by default). Each loaded session
// is a series; invalid laps are drawn hollow. Click a point to make that lap the reference; drag a
// rectangle to zoom; the y-axis range can be fixed in the Properties. An optional best-fit line (linear,
// polynomial, exponential…) runs through each series, with its equation.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CATEGORICAL, withAlpha } from '../core/colors';
import { fitCurve, fitEquation, fitRequirement, fitSettings } from '../core/fit';
import { formatDelta, formatLapTime, formatValue, prettyTrack } from '../core/format';
import { rangeStats } from '../core/stats';
import { lapKey, type Lap, type Session } from '../core/types';
import { selectedLaps, selectLap, sessionsWithSelection, updateComponent, useStore } from '../state/store';
import type { TrendConfig } from '../state/workspace';
import { drawAxes, drawMarker, makeAxes, padRange, type Axes } from './axes';
import { BoxZoomLayer, type View } from './BoxZoom';
import { chartTheme, prepCanvas, useElementSize } from './canvas';
import { channelDps, channelLabel, conv } from './data';
import { drawFitLine, drawFitNotes, fitMenuItems } from './fitLines';
import { openMenu } from '../ui/overlays';

function lapStat(s: Session, lap: Lap, cfg: TrendConfig): number {
  if (!cfg.channel) return lap.complete ? lap.time : NaN;
  const ch = s.channels.get(cfg.channel);
  if (!ch) return NaN;
  const i0 = Math.max(0, Math.ceil((lap.start - ch.t0) * ch.rate));
  // Last sample strictly before the lap's end: a sample exactly on the line belongs to the next lap (where
  // per-lap channels such as integrate_lap have already reset).
  const i1 = Math.min(ch.n - 1, Math.ceil((lap.end - ch.t0) * ch.rate - 1e-6) - 1);
  const st = rangeStats(ch.data, i0, i1);
  const c = conv(ch);
  const raw = cfg.stat === 'mean' ? st.mean : cfg.stat === 'max' ? st.max : cfg.stat === 'min' ? st.min : cfg.stat === 'first' ? st.first : cfg.stat === 'last' ? st.last : st.last - st.first;
  return cfg.stat === 'delta' ? raw * c.k : raw * c.k + c.b;
}

export const DEFAULT_FUEL_EFFECT = 0.03;

/**
 * Fuel-corrected lap time: the lap time minus the time the fuel on board cost, i.e. the lap as if run
 * on an empty tank (lap time − seconds-per-litre × mean fuel during the lap). NaN without a fuel channel.
 */
export function fuelCorrected(s: Session, lap: Lap, secPerLitre: number): number {
  if (!lap.complete || !s.key.fuel) return NaN;
  const ch = s.channels.get(s.key.fuel)!;
  const st = rangeStats(ch.data, Math.max(0, Math.ceil((lap.start - ch.t0) * ch.rate)), Math.min(ch.n - 1, Math.floor((lap.end - ch.t0) * ch.rate)));
  return st.count ? lap.time - secPerLitre * st.mean : NaN;
}

/** Ring around a selected lap's point in its lap colour; the reference gets a heavier double ring. */
function drawSelRing(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, isRef: boolean) {
  ctx.strokeStyle = color;
  ctx.lineWidth = isRef ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.stroke();
  if (isRef) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 11.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const seriesName = (s: Session) => `${prettyTrack(s.meta.venue).track} ${new Date(s.meta.savedAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

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
    // Lap times can be shown raw, fuel-corrected, or both (corrected = dashed line, diamond markers).
    const mode = config.channel ? 'raw' : config.lapTimes ?? 'raw';
    const k = config.fuelEffect ?? DEFAULT_FUEL_EFFECT;
    const keep = (p: { l: Lap; v: number }) => Number.isFinite(p.v) && (!config.validOnly || !p.l.invalid) && (config.channel ? true : p.l.complete);
    // Each stint takes the colour of its first selected lap (the reference's stint gets the reference
    // colour), so the trend matches the lap colours used by every other chart; selected points keep
    // their own lap colour.
    const sel = selectedLaps();
    const lapColorOf = new Map(sel.map((l) => [l.key, l.color]));
    const series = sessions.map((s, si) => ({
      s,
      color: sel.find((l) => l.session.id === s.id)?.color ?? CATEGORICAL[theme][si % 8],
      pts: mode === 'corrected' ? [] : s.laps.map((l) => ({ l, v: lapStat(s, l, config) })).filter(keep),
      corr: mode === 'raw' ? [] : s.laps.map((l) => ({ l, v: fuelCorrected(s, l, k) })).filter(keep),
    }));
    const noFuel = mode !== 'raw' && series.every((sr) => !sr.corr.length);
    const all = series.flatMap((sr) => [...sr.pts, ...sr.corr]);
    if (!all.length) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText(!sessions.length ? 'Open a session' : noFuel ? 'No fuel level channel — fuel-corrected times need one' : 'No data for this statistic', w / 2, h / 2);
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
        const selColor = lapColorOf.get(key);
        const color = selColor ?? sr.color;
        ctx.fillStyle = color;
        if (p.l.invalid) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(X, Y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = T.surface;
          ctx.fill();
          ctx.stroke();
        } else drawMarker(ctx, 1, X, Y, 9);
        if (selColor) drawSelRing(ctx, X, Y, selColor, key === refKey);
        if (rect.w / Math.max(1, x1 - x0) > 46) {
          ctx.fillStyle = T.text2;
          ctx.textAlign = 'center';
          ctx.fillText(config.channel ? formatValue(p.v, dps) : formatLapTime(p.v), X, Y - 14);
        }
      }
    }
    // Fuel-corrected series: dashed line, diamond markers.
    for (const sr of series) {
      if (!sr.corr.length) continue;
      ctx.strokeStyle = sr.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      sr.corr.forEach((p, i) => {
        const X = A.px(p.l.number),
          Y = A.py(p.v);
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of sr.corr) {
        const X = A.px(p.l.number),
          Y = A.py(p.v);
        const key = lapKey({ sessionId: sr.s.id, lapIndex: p.l.index });
        hitsRef.current.push({ x: X, y: Y, key });
        ctx.beginPath();
        ctx.moveTo(X, Y - 5);
        ctx.lineTo(X + 5, Y);
        ctx.lineTo(X, Y + 5);
        ctx.lineTo(X - 5, Y);
        ctx.closePath();
        const selColor = lapColorOf.get(key);
        const color = selColor ?? sr.color;
        ctx.fillStyle = p.l.invalid ? T.surface : color;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.stroke();
        if (selColor) drawSelRing(ctx, X, Y, selColor, key === refKey);
        if (rect.w / Math.max(1, x1 - x0) > 46) {
          ctx.fillStyle = T.text3;
          ctx.textAlign = 'center';
          ctx.fillText(formatLapTime(p.v), X, Y + 15);
        }
      }
    }
    // Best-fit line through each series (raw and fuel-corrected fitted separately), x = lap number.
    const fit = fitSettings(config);
    const fitNotes: { color: string; text: string }[] = [];
    if (fit.on) {
      for (const sr of series)
        for (const [pts, what] of [
          [sr.pts, 'raw'],
          [sr.corr, 'fuel-corrected'],
        ] as const) {
          if (!pts.length) continue;
          const xs = pts.map((p) => p.l.number);
          const prefix = [series.length > 1 ? seriesName(sr.s) : '', mode === 'both' ? what : ''].filter(Boolean).join(' · ');
          const f = fitCurve(
            xs,
            pts.map((p) => p.v),
            fit.kind,
          );
          if (!f) {
            fitNotes.push({ color: sr.color, text: `${prefix ? prefix + ': ' : ''}no fit (${fitRequirement(fit.kind)})` });
            continue;
          }
          drawFitLine(ctx, A, f, Math.min(...xs), Math.max(...xs), withAlpha(sr.color, 0.8));
          if (!fit.equation) continue;
          const slope = f.kind === 'linear' ? `   (${formatDelta(f.coef[1], config.channel ? Math.max(2, dps) : 3)} ${unit}/lap)` : '';
          fitNotes.push({ color: sr.color, text: `${prefix ? prefix + ':  ' : ''}${fitEquation(f)}   R² = ${f.r2.toFixed(3)}${slope}` });
        }
    }
    ctx.restore();
    const showKey = series.length > 1 && !!config.showLegend;
    drawFitNotes(ctx, fitNotes, rect.x + 4, rect.y + (showKey ? 18 : 4), T.surface, T.text);
    if (showKey) {
      let x = rect.x + 8;
      for (const sr of series) {
        ctx.fillStyle = sr.color;
        ctx.fillRect(x, rect.y + 6, 10, 4);
        ctx.fillStyle = T.text2;
        ctx.textAlign = 'left';
        const name = seriesName(sr.s);
        ctx.fillText(name, x + 14, rect.y + 8);
        x += ctx.measureText(name).width + 30;
      }
    }
    ctx.fillStyle = T.text3;
    ctx.textAlign = 'left';
    const fuelNote =
      (mode === 'raw' ? '' : `${mode === 'both' ? 'dashed ◆ = ' : ''}fuel-corrected (−${k} s per litre on board) · `) +
      (fit.on && fit.equation ? `fit: x = lap number, y in ${config.channel ? unit || 'channel units' : 'seconds'} · ` : '');
    ctx.fillText(viewRef.current ? 'zoomed — double-click to reset' : `${fuelNote}hollow = invalid lap · click a point to make it the reference · drag to zoom`, rect.x, h - 8);
  }, [size, config, sessions, lapSel, refKey, dataVersion, theme]);

  useEffect(draw, [draw]);

  const mode = config.lapTimes ?? 'raw';
  return (
    <div ref={wrapRef} className="chart">
      <canvas ref={ref} />
      {!config.channel && (
        <div className="seg chart-seg" title="Lap times as logged, corrected for the fuel on board, or both">
          {(
            [
              ['raw', 'Raw'],
              ['corrected', 'Fuel-corrected'],
              ['both', 'Both'],
            ] as const
          ).map(([m, l]) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => updateComponent(config.id, { lapTimes: m }, 'Lap time mode')}>
              {l}
            </button>
          ))}
        </div>
      )}
      <BoxZoomLayer
        axesRef={axesRef}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e, fitMenuItems(config));
        }}
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
