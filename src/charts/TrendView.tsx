// Lap trend: one statistic per lap across the session (lap time by default). Each loaded session
// is a series; invalid laps are drawn hollow. Click a point to select that lap as reference.

import { useEffect, useRef } from 'react';
import { CATEGORICAL } from '../core/colors';
import { formatLapTime, formatValue } from '../core/format';
import { rangeStats } from '../core/stats';
import { lapKey, type Lap, type Session } from '../core/types';
import { selectLap, updateComponent, useStore } from '../state/store';
import type { TrendConfig } from '../state/workspace';
import { openChannelPicker, openMenu } from '../ui/overlays';
import { drawAxes, drawMarker, makeAxes, padRange } from './axes';
import { chartTheme, prepCanvas, useElementSize } from './canvas';
import { channelDps, conv } from './data';
import { prettyTrack } from '../core/format';

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
  const hitsRef = useRef<{ x: number; y: number; key: string }[]>([]);
  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const dataVersion = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);

  useEffect(() => {
    const { w, h } = size;
    const ctx = prepCanvas(ref.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    hitsRef.current = [];
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
    const [y0, y1] = padRange(Math.min(...all.map((p) => p.v)), Math.max(...all.map((p) => p.v)), 0.12);
    const rect = { x: 60, y: 12, w: Math.max(10, w - 60 - 14), h: Math.max(10, h - 12 - 40) };
    const A = makeAxes(rect, 0.5, maxLap + 0.5, y0, y1);
    const ch = config.channel ? sessions[0]?.channels.get(config.channel) : undefined;
    const unit = ch ? conv(ch).unit : 's';
    const dps = ch ? channelDps(ch) : 3;
    const label = config.channel ? `${config.stat} ${config.channel}${unit ? ` [${unit}]` : ''}` : 'lap time';
    drawAxes(ctx, T, A, 0.5, maxLap + 0.5, y0, y1, 'lap', label, {
      xFmt: (v) => (Number.isInteger(v) ? String(v) : ''),
      yFmt: (v, step) => (config.channel ? formatValue(v, step < 1 ? 2 : 0) : formatLapTime(v, step < 0.1 ? 2 : 1)),
    });
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
        if (rect.w / Math.max(1, maxLap) > 46) {
          ctx.fillStyle = T.text2;
          ctx.textAlign = 'center';
          ctx.fillText(config.channel ? formatValue(p.v, dps) : formatLapTime(p.v), X, Y - 14);
        }
      }
    }
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
    ctx.fillText('hollow = invalid lap · click a point to make it the reference', rect.x, h - 8);
  }, [size, config, sessions, lapSel, refKey, dataVersion, theme]);

  return (
    <div ref={wrapRef} className="chart">
      <canvas
        ref={ref}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const x = e.clientX - r.left,
            y = e.clientY - r.top;
          const hit = hitsRef.current.find((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 100);
          if (hit) selectLap(hit.key, e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e, [
            {
              label: `Channel: ${config.channel || 'Lap time'}…`,
              onClick: () => openChannelPicker(e, (n) => updateComponent(config.id, { channel: n === '__lap' ? '' : n }), [{ value: '__lap', label: 'Lap time' }]),
            },
            ...(['mean', 'max', 'min', 'first', 'last', 'delta'] as const).map((s) => ({
              label: `Statistic: ${s}`,
              checked: config.stat === s,
              disabled: !config.channel,
              onClick: () => updateComponent(config.id, { stat: s }),
            })),
            { label: 'Valid laps only', checked: config.validOnly, onClick: () => updateComponent(config.id, { validOnly: !config.validOnly }) },
          ]);
        }}
      />
    </div>
  );
}
