// Track map built from car coordinates (Car Coord X/Y) or GPS latitude/longitude.
// Colour by lap, by any channel, or by time gained/lost against the reference lap.

import { useCallback, useEffect, useRef } from 'react';
import { computeVariance, lapSeries, timeToX, xToTime } from '../core/axis';
import { sampleAt, interp } from '../core/channel';
import { rampColor, rampLUT, withAlpha, type RampName } from '../core/colors';
import { detectCorners } from '../core/corners';
import { formatValue } from '../core/format';
import { crossingTime, lapDistAt, lapLabel } from '../core/session';
import type { Lap, Session } from '../core/types';
import {
  activeWorkspace,
  selectedLaps,
  setCursor,
  setTrackProfile,
  trackProfile,
  updateComponent,
  useStore,
  type SelectedLap,
} from '../state/store';
import type { TrackMapConfig } from '../state/workspace';
import { openChannelPicker, openMenu, promptText } from '../ui/overlays';
import { chartTheme, prepCanvas, useElementSize, useStoreListener } from './canvas';
import { channelDps, conv, lapRange } from './data';

interface LapPath {
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
}

const pathCache = new WeakMap<Lap, LapPath | null>();

function lapPath(s: Session, lap: Lap): LapPath | null {
  if (pathCache.has(lap)) return pathCache.get(lap)!;
  const kx = s.key.posX ? s.channels.get(s.key.posX) : undefined;
  const ky = s.key.posY ? s.channels.get(s.key.posY) : undefined;
  let out: LapPath | null = null;
  if (kx && ky) {
    const ser = lapSeries(lap, kx, 'time');
    const n = ser.i1 - ser.i0 + 1;
    const t = new Float64Array(n);
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const sameGrid = kx.rate === ky.rate && kx.t0 === ky.t0;
    for (let i = 0; i < n; i++) {
      const idx = ser.i0 + i;
      const tt = kx.t0 + idx / kx.rate;
      t[i] = tt;
      x[i] = kx.data[idx];
      y[i] = sameGrid ? ky.data[idx] : sampleAt(ky, tt);
    }
    out = { t, x, y };
  }
  pathCache.set(lap, out);
  return out;
}

function positionAt(p: LapPath, t: number): [number, number] {
  return [interp(p.t, p.x, t), interp(p.t, p.y, t)];
}

export function TrackMapView({ config }: { config: TrackMapConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 });
  const xfRef = useRef<{ toScreen: (x: number, y: number) => [number, number]; ref: SelectedLap; path: LapPath } | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const xMode = useStore((s) => s.xMode);
  const zoom = useStore((s) => s.zoom);
  const dataVersion = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);
  const profiles = useStore((s) => s.settings.trackProfiles);
  useStore((s) => activeWorkspace(s)?.channelProps);

  const drawBase = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(baseRef.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    const st = useStore.getState();
    const laps = selectedLaps(st);
    const ref = laps[0];
    xfRef.current = null;
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    const msg = (m: string) => {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText(m, w / 2, h / 2);
    };
    if (!ref) return msg('Select a lap to draw the track');
    const path = lapPath(ref.session, ref.lap);
    if (!path || path.t.length < 10) return msg('No position channels (Car Coord X/Y or GPS Lat/Long) in this session');

    const prof = trackProfile(ref.session.meta.venue);
    const rot = ((prof.rotation + config.rotation) * Math.PI) / 180;
    const cs = Math.cos(rot),
      sn = Math.sin(rot);
    const mir = prof.mirror ? -1 : 1;
    const proj = (x: number, y: number): [number, number] => {
      const X = x * mir;
      return [X * cs - y * sn, -(X * sn + y * cs)];
    };
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < path.t.length; i++) {
      const [a, b] = proj(path.x[i], path.y[i]);
      if (a < minX) minX = a;
      if (a > maxX) maxX = a;
      if (b < minY) minY = b;
      if (b > maxY) maxY = b;
    }
    const pad = 26;
    const legendH = 34;
    const fit = Math.min((w - 2 * pad) / Math.max(1, maxX - minX), (h - 2 * pad - legendH) / Math.max(1, maxY - minY));
    const v = viewRef.current;
    const sc = fit * v.scale;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const toScreen = (x: number, y: number): [number, number] => {
      const [a, b] = proj(x, y);
      return [w / 2 + (a - cx) * sc + v.ox, (h - legendH) / 2 + (b - cy) * sc + v.oy];
    };
    xfRef.current = { toScreen, ref, path };

    const n = path.t.length;
    const scr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const [a, b] = toScreen(path.x[i], path.y[i]);
      scr[2 * i] = a;
      scr[2 * i + 1] = b;
    }
    const strokeRange = (i0: number, i1: number) => {
      ctx.beginPath();
      ctx.moveTo(scr[2 * i0], scr[2 * i0 + 1]);
      for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(scr[2 * i], scr[2 * i + 1]);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const lw = config.lineWidth;
    // Road
    ctx.strokeStyle = T.road;
    ctx.lineWidth = lw + 7;
    strokeRange(0, n - 1);

    // Colour layer
    let legend: { kind: 'ramp'; label: string; min: string; max: string; ramp: RampName } | { kind: 'laps' } | { kind: 'delta'; label: string } | null = null;
    const colorSegments = (values: Float64Array, lo: number, hi: number, ramp: RampName, i0 = 0, i1 = n - 1) => {
      const lut = rampLUT(ramp, theme);
      const span = hi - lo || 1;
      ctx.lineWidth = lw;
      let bucket = -1;
      let startI = i0;
      const bucketOf = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(47, Math.floor(((v - lo) / span) * 48))) : -1);
      for (let i = i0; i <= i1; i++) {
        const bk = bucketOf(values[i]);
        if (bk !== bucket || i === i1) {
          if (bucket >= 0 && i > startI) {
            ctx.strokeStyle = lut[Math.round((bucket / 47) * 255)];
            strokeRange(startI, i);
          }
          bucket = bk;
          startI = i;
        }
      }
    };

    let colorValues: Float64Array | null = null;
    let lo = 0,
      hi = 1;
    let rampName: RampName = config.ramp;
    if (config.colorBy === 'delta' && laps.length > 1) {
      const cmp = laps[1];
      const vr = computeVariance(ref.lap, cmp.lap, 2);
      const m = vr.dist.length;
      const rate = new Float64Array(m);
      const wdw = 8;
      for (let k = 0; k < m; k++) {
        const a = Math.max(0, k - wdw);
        const b = Math.min(m - 1, k + wdw);
        rate[k] = (vr.delta[b] - vr.delta[a]) / Math.max(1e-6, vr.dist[b] - vr.dist[a]);
      }
      const abs = Array.from(rate, Math.abs).sort((a, b) => a - b);
      const lim = Math.max(1e-5, abs[Math.floor(abs.length * 0.95)] || 1e-4);
      colorValues = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const d = lapDistAt(ref.lap, path.t[i]);
        colorValues[i] = m ? interp(vr.dist, rate, d) : 0;
      }
      lo = -lim;
      hi = lim;
      rampName = 'diverging';
      legend = { kind: 'delta', label: `${lapLabel(cmp.lap)} vs ref ${lapLabel(ref.lap)}` };
    } else if (config.colorBy !== 'lap' && config.colorBy !== 'delta') {
      const ch = ref.session.channels.get(config.colorBy);
      if (ch) {
        const c = conv(ch);
        colorValues = new Float64Array(n);
        for (let i = 0; i < n; i++) colorValues[i] = sampleAt(ch, path.t[i]) * c.k + c.b;
        const r = lapRange(ref.lap, ch);
        lo = r[0] * c.k + c.b;
        hi = r[1] * c.k + c.b;
        const props = activeWorkspace()?.channelProps[ch.name];
        if (props?.min != null) lo = props.min;
        if (props?.max != null) hi = props.max;
        const dps = channelDps(ch);
        legend = { kind: 'ramp', label: `${ch.name}${c.unit ? ` [${c.unit}]` : ''}`, min: formatValue(lo, dps), max: formatValue(hi, dps), ramp: rampName };
      }
    }

    if (colorValues) colorSegments(colorValues, lo, hi, rampName);
    else {
      // Colour by lap: every selected lap from a session on this venue.
      const order = laps.slice(1).concat(laps.slice(0, 1));
      for (const l of order) {
        if (l.session.meta.venue !== ref.session.meta.venue && l.session !== ref.session) continue;
        const p = l === ref ? path : lapPath(l.session, l.lap);
        if (!p) continue;
        ctx.strokeStyle = l.color;
        ctx.lineWidth = l === ref ? lw : Math.max(1.5, lw - 1.5);
        ctx.beginPath();
        for (let i = 0; i < p.t.length; i++) {
          const [a, b] = toScreen(p.x[i], p.y[i]);
          if (i === 0) ctx.moveTo(a, b);
          else ctx.lineTo(a, b);
        }
        ctx.stroke();
      }
      legend = { kind: 'laps' };
    }

    // Zoom highlight: dim outside the zoomed range.
    if (config.showZoom && st.zoom && ref.lap.index !== -1) {
      const ta = xToTime(ref.lap, st.zoom[0], st.xMode);
      const tb = xToTime(ref.lap, st.zoom[1], st.xMode);
      let i0 = path.t.findIndex((t) => t >= ta);
      let i1 = n - 1;
      for (let i = n - 1; i >= 0; i--)
        if (path.t[i] <= tb) {
          i1 = i;
          break;
        }
      if (i0 >= 0 && i1 > i0) {
        ctx.strokeStyle = withAlpha(T.surface, 0.62);
        ctx.lineWidth = lw + 8;
        strokeRange(0, n - 1);
        ctx.strokeStyle = T.cursor;
        ctx.lineWidth = lw + 4;
        strokeRange(i0, i1);
        if (colorValues) colorSegments(colorValues, lo, hi, rampName, i0, i1);
        else {
          ctx.strokeStyle = ref.color;
          ctx.lineWidth = lw;
          strokeRange(i0, i1);
        }
      }
    }

    // Markers: start/finish, sectors, sections, corners.
    const centroid = [w / 2 + v.ox, (h - legendH) / 2 + v.oy];
    const tickAt = (d: number, label: string, strong: boolean) => {
      const t = d <= 0.5 ? (ref.lap.index === -1 ? NaN : ref.lap.start) : crossingTime(ref.lap, d);
      if (!Number.isFinite(t)) return;
      const [px, py] = positionAt(path, t);
      const [ax, ay] = positionAt(path, t + 0.15);
      const p0 = toScreen(px, py);
      const p1 = toScreen(ax, ay);
      let nx = -(p1[1] - p0[1]);
      let ny = p1[0] - p0[0];
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      const L = lw + 6;
      ctx.strokeStyle = strong ? T.text : T.text2;
      ctx.lineWidth = strong ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(p0[0] - nx * L, p0[1] - ny * L);
      ctx.lineTo(p0[0] + nx * L, p0[1] + ny * L);
      ctx.stroke();
      // label on the outside of the track
      const out = (p0[0] - centroid[0]) * nx + (p0[1] - centroid[1]) * ny > 0 ? 1 : -1;
      ctx.fillStyle = strong ? T.text : T.text2;
      ctx.font = strong ? `600 ${T.font}` : T.font;
      ctx.textAlign = 'center';
      ctx.fillText(label, p0[0] + nx * (L + 10) * out, p0[1] + ny * (L + 10) * out);
      ctx.font = T.font;
    };
    if (ref.lap.index !== -1) {
      tickAt(0, 'S/F', true);
      if (config.showSectors) {
        ref.session.sectorSplits.forEach((d, i) => tickAt(d, `S${i + 2}`, true));
        prof.sections.forEach((s) => tickAt(s.dist, s.name, false));
      }
      if (config.showCorners) {
        for (const c of detectCorners(ref.session, ref.lap)) {
          const t = crossingTime(ref.lap, c.apex);
          if (!Number.isFinite(t)) continue;
          const [px, py] = positionAt(path, t);
          const p0 = toScreen(px, py);
          const dx = p0[0] - centroid[0];
          const dy = p0[1] - centroid[1];
          const dl = Math.hypot(dx, dy) || 1;
          const label = prof.cornerNames[c.name] || c.name;
          const lx = p0[0] + (dx / dl) * (lw + 12);
          const ly = p0[1] + (dy / dl) * (lw + 12);
          ctx.fillStyle = withAlpha(T.surface2, 0.9);
          const tw = ctx.measureText(label).width + 8;
          ctx.fillRect(lx - tw / 2, ly - 7, tw, 14);
          ctx.fillStyle = T.text2;
          ctx.textAlign = 'center';
          ctx.fillText(label, lx, ly);
        }
      }
    }

    // Legend
    const ly = h - legendH / 2 - 2;
    ctx.textAlign = 'left';
    if (legend?.kind === 'ramp') {
      const bw = Math.min(160, w * 0.35);
      const g = ctx.createLinearGradient(10, 0, 10 + bw, 0);
      for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, rampColor(legend.ramp, theme, i / 10));
      ctx.fillStyle = g;
      ctx.fillRect(10, ly - 4, bw, 8);
      ctx.fillStyle = T.text3;
      ctx.fillText(legend.min, 10, ly + 13);
      ctx.textAlign = 'right';
      ctx.fillText(legend.max, 10 + bw, ly + 13);
      ctx.textAlign = 'left';
      ctx.fillStyle = T.text2;
      ctx.fillText(legend.label, 18 + bw, ly);
    } else if (legend?.kind === 'delta') {
      const bw = Math.min(140, w * 0.3);
      const g = ctx.createLinearGradient(10, 0, 10 + bw, 0);
      for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, rampColor('diverging', theme, i / 10));
      ctx.fillStyle = g;
      ctx.fillRect(10, ly - 4, bw, 8);
      ctx.fillStyle = T.text3;
      ctx.fillText('◀ gaining', 10, ly + 13);
      ctx.textAlign = 'right';
      ctx.fillText('losing ▶', 10 + bw, ly + 13);
      ctx.textAlign = 'left';
      ctx.fillStyle = T.text2;
      ctx.fillText(legend.label, 18 + bw, ly);
    } else if (legend?.kind === 'laps') {
      let x = 10;
      for (const l of laps.slice(0, 6)) {
        ctx.fillStyle = l.color;
        ctx.fillRect(x, ly - 2, 14, 4);
        ctx.fillStyle = T.text2;
        const label = lapLabel(l.lap) + (l.isRef ? ' (ref)' : '');
        ctx.fillText(label, x + 18, ly);
        x += ctx.measureText(label).width + 32;
      }
      if (config.colorBy === 'delta')
        ctx.fillText('Select a second lap to see where time is gained or lost', 10, ly - 16);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, sessions, lapSel, refKey, xMode, zoom, dataVersion, theme, profiles]);

  const drawOverlay = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(overRef.current, w, h);
    const xf = xfRef.current;
    if (!ctx || !xf) return;
    const T = chartTheme();
    const st = useStore.getState();
    if (st.cursor == null) return;
    const laps = selectedLaps(st);
    const order = laps.slice(1).concat(laps.slice(0, 1));
    for (const l of order) {
      const p = l === xf.ref ? xf.path : lapPath(l.session, l.lap);
      if (!p) continue;
      const t = xToTime(l.lap, st.cursor, st.xMode);
      if (l.lap.index !== -1 && (t < l.lap.start || t > l.lap.end)) continue;
      const [x, y] = positionAt(p, t);
      const [sx, sy] = xf.toScreen(x, y);
      const isRef = l === xf.ref;
      ctx.beginPath();
      ctx.arc(sx, sy, isRef ? 6.5 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isRef && laps.length === 1 ? T.cursor : l.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = T.surface;
      ctx.stroke();
      if (isRef) {
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(T.cursor, 0.6);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }, [size]);

  useEffect(() => {
    drawBase();
    drawOverlay();
  }, [drawBase, drawOverlay]);
  useStoreListener(drawOverlay, [drawOverlay]);

  const redraw = () => {
    drawBase();
    drawOverlay();
  };

  useEffect(() => {
    const el = overRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left - size.w / 2;
      const my = e.clientY - r.top - (size.h - 34) / 2;
      const v = viewRef.current;
      const f = Math.pow(1.0015, -e.deltaY);
      const ns = Math.max(0.5, Math.min(40, v.scale * f));
      const k = ns / v.scale;
      v.ox = mx - (mx - v.ox) * k;
      v.oy = my - (my - v.oy) * k;
      v.scale = ns;
      redraw();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const seekTo = (sx: number, sy: number) => {
    const xf = xfRef.current;
    if (!xf) return;
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < xf.path.t.length; i++) {
      const [a, b] = xf.toScreen(xf.path.x[i], xf.path.y[i]);
      const d = (a - sx) ** 2 + (b - sy) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (best < 40 * 40) setCursor(timeToX(xf.ref.lap, xf.path.t[bi], useStore.getState().xMode));
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const ref = selectedLaps()[0];
    const venue = ref?.session.meta.venue ?? '';
    const prof = trackProfile(venue);
    const st = useStore.getState();
    openMenu(e, [
      { header: 'Colour by' },
      { label: 'Lap colours', checked: config.colorBy === 'lap', onClick: () => updateComponent(config.id, { colorBy: 'lap' }) },
      { label: 'Time gained / lost (needs 2 laps)', checked: config.colorBy === 'delta', onClick: () => updateComponent(config.id, { colorBy: 'delta' }) },
      { label: 'Channel…', checked: !['lap', 'delta'].includes(config.colorBy), onClick: () => openChannelPicker(e, (n) => updateComponent(config.id, { colorBy: n })) },
      { separator: true },
      { label: 'Rotate 90° (this track)', disabled: !venue, onClick: () => setTrackProfile(venue, { rotation: (prof.rotation + 90) % 360 }) },
      { label: 'Mirror (this track)', checked: prof.mirror, disabled: !venue, onClick: () => setTrackProfile(venue, { mirror: !prof.mirror }) },
      { label: 'Reset view', onClick: () => ((viewRef.current = { scale: 1, ox: 0, oy: 0 }), redraw()) },
      { separator: true },
      { label: 'Sector & section markers', checked: config.showSectors, onClick: () => updateComponent(config.id, { showSectors: !config.showSectors }) },
      { label: 'Corner labels', checked: config.showCorners, onClick: () => updateComponent(config.id, { showCorners: !config.showCorners }) },
      { label: 'Highlight zoomed range', checked: config.showZoom, onClick: () => updateComponent(config.id, { showZoom: !config.showZoom }) },
      { separator: true },
      {
        label: 'Add section split at cursor…',
        disabled: !ref || st.cursor == null || ref.lap.index === -1,
        onClick: async () => {
          if (!ref || st.cursor == null) return;
          const d = lapDistAt(ref.lap, xToTime(ref.lap, st.cursor, st.xMode));
          const name = await promptText('Name this section split', `Split ${prof.sections.length + 1}`);
          if (name) setTrackProfile(venue, { sections: [...prof.sections, { name, dist: d }].sort((a, b) => a.dist - b.dist) });
        },
      },
      {
        label: 'Clear custom sections',
        disabled: !prof.sections.length,
        onClick: () => setTrackProfile(venue, { sections: [] }),
      },
    ]);
  };

  return (
    <div ref={wrapRef} className="chart"
      onDragOver={(e) => e.dataTransfer.types.includes('application/x-pt-channel') && (e.preventDefault(), e.stopPropagation())}
      onDrop={(e) => {
        const n = e.dataTransfer.getData('application/x-pt-channel');
        if (n) {
          e.preventDefault();
          e.stopPropagation();
          updateComponent(config.id, { colorBy: n });
        }
      }}
    >
      <canvas ref={baseRef} />
      <canvas
        ref={overRef}
        style={{ cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          dragRef.current = { x: e.clientX, y: e.clientY, ox: viewRef.current.ox, oy: viewRef.current.oy, moved: false };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
          if (d.moved) {
            viewRef.current.ox = d.ox + e.clientX - d.x;
            viewRef.current.oy = d.oy + e.clientY - d.y;
            redraw();
          }
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          dragRef.current = null;
          if (d && !d.moved && e.button === 0) {
            const r = overRef.current!.getBoundingClientRect();
            seekTo(e.clientX - r.left, e.clientY - r.top);
          }
        }}
        onDoubleClick={() => ((viewRef.current = { scale: 1, ox: 0, oy: 0 }), redraw())}
        onContextMenu={onContextMenu}
      />
    </div>
  );
}
