// GPS Track: compare the racing lines of the selected laps. Thin lines in each lap's colour,
// automatic framing of the graphs' zoomed range, optional follow-cursor, a metric scale bar and the
// lateral offset of each lap's line from the reference at the cursor.

import { useCallback, useEffect, useRef } from 'react';
import { timeToX, xToTime } from '../core/axis';
import { withAlpha } from '../core/colors';
import { crossingTime, lapDistAt, lapLabel, lapTimeAtDist } from '../core/session';
import { selectedLaps, setCursor, trackProfile, trackRotation, useStore, type SelectedLap } from '../state/store';
import type { GpsTrackConfig } from '../state/workspace';
import { openMenu } from '../ui/overlays';
import { chartTheme, prepCanvas, useElementSize, useStoreListener } from './canvas';
import { RotationDial } from './RotationDial';
import { trackMapMenuItems } from './TrackMapView';
import { lapPath, makeProjector, niceLength, positionAt, type LapPath } from './trackGeo';

export function GpsTrackView({ config }: { config: GpsTrackConfig }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 });
  const lastZoomRef = useRef<string>('');
  const xfRef = useRef<{ toScreen: (x: number, y: number) => [number, number]; sc: number; ref: SelectedLap; path: LapPath } | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  const sessions = useStore((s) => s.sessions);
  const lapSel = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const xMode = useStore((s) => s.xMode);
  const zoom = useStore((s) => s.zoom);
  const dataVersion = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);
  const profiles = useStore((s) => s.settings.trackProfiles);
  const working = useStore((s) => s.workingRotation);
  const venue = selectedLaps()[0]?.session.meta.venue ?? '';

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
    if (!ref) return msg('Select laps to compare their racing lines');
    const path = lapPath(ref.session, ref.lap);
    if (!path || path.t.length < 10) return msg('No position channels (Car Coord X/Y or GPS Lat/Long) in this session');
    const prof = trackProfile(ref.session.meta.venue);
    const proj = makeProjector(trackRotation(ref.session.meta.venue, st), prof.mirror);
    const lines = laps
      .filter((l) => l.session.meta.venue === ref.session.meta.venue)
      .map((l) => ({ l, p: l === ref ? path : lapPath(l.session, l.lap) }))
      .filter((x): x is { l: SelectedLap; p: LapPath } => !!x.p);

    // Time window of each lap that falls inside the graphs' zoom (when framing the zoom).
    const zoomed = config.fitToZoom && st.zoom && ref.lap.index !== -1;
    const windowOf = (l: SelectedLap): [number, number] =>
      zoomed ? [xToTime(l.lap, st.zoom![0], st.xMode), xToTime(l.lap, st.zoom![1], st.xMode)] : [-Infinity, Infinity];
    const zkey = zoomed ? `${st.zoom![0].toFixed(2)}|${st.zoom![1].toFixed(2)}|${st.xMode}` : '';
    if (zkey !== lastZoomRef.current) {
      viewRef.current = { scale: 1, ox: 0, oy: 0 };
      lastZoomRef.current = zkey;
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const { l, p } of zoomed ? lines : lines.slice(0, 1)) {
      const [ta, tb] = windowOf(l);
      for (let i = 0; i < p.t.length; i++) {
        if (p.t[i] < ta || p.t[i] > tb) continue;
        const [a, b] = proj(p.x[i], p.y[i]);
        if (a < minX) minX = a;
        if (a > maxX) maxX = a;
        if (b < minY) minY = b;
        if (b > maxY) maxY = b;
      }
    }
    if (!Number.isFinite(minX)) return msg('No position data in the zoomed range');
    const pad = 30;
    const legendH = config.showLegend === false ? 6 : 26;
    const spanX = Math.max(20, maxX - minX);
    const spanY = Math.max(20, maxY - minY);
    const fit = Math.min((w - 2 * pad) / spanX, (h - 2 * pad - legendH) / spanY);
    const v = viewRef.current;
    const sc = fit * v.scale;
    let cx = (minX + maxX) / 2;
    let cy = (minY + maxY) / 2;
    // Follow the reference car when zoomed in on the map.
    if (config.followCursor && st.cursor != null && v.scale > 1.2) {
      const t = xToTime(ref.lap, st.cursor, st.xMode);
      const [a, b] = proj(...positionAt(path, t));
      cx = a - v.ox / sc;
      cy = b - v.oy / sc;
    }
    const toScreen = (x: number, y: number): [number, number] => {
      const [a, b] = proj(x, y);
      return [w / 2 + (a - cx) * sc + v.ox, (h - legendH) / 2 + (b - cy) * sc + v.oy];
    };
    xfRef.current = { toScreen, sc, ref, path };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const strokePath = (p: LapPath, ta = -Infinity, tb = Infinity) => {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < p.t.length; i++) {
        if (p.t[i] < ta || p.t[i] > tb) {
          pen = false;
          continue;
        }
        const [a, b] = toScreen(p.x[i], p.y[i]);
        if (!pen) ctx.moveTo(a, b);
        else ctx.lineTo(a, b);
        pen = true;
      }
      ctx.stroke();
    };

    // Only the raw car positions are drawn (no track edges). Faint full laps for context, then the (zoomed) lines on top, reference last.
    const order = lines.slice(1).concat(lines.slice(0, 1));
    if (zoomed)
      for (const { l, p } of order) {
        ctx.strokeStyle = withAlpha(l.color, 0.22);
        ctx.lineWidth = config.lineWidth;
        strokePath(p);
      }
    for (const { l, p } of order) {
      const [ta, tb] = windowOf(l);
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l === ref ? config.lineWidth + 0.4 : config.lineWidth;
      strokePath(p, ta - 0.5, tb + 0.5);
    }

    // Corner / sector markers (small).
    if (ref.lap.index !== -1) {
      const marks: { d: number; label: string }[] = [];
      if (config.showSectors) {
        marks.push({ d: 0.01, label: 'S/F' });
        ref.session.sectorSplits.forEach((d, i) => marks.push({ d, label: `S${i + 2}` }));
        prof.sections.forEach((s) => marks.push({ d: s.dist, label: s.name }));
      }
      if (config.showCorners) prof.corners.forEach((c) => marks.push({ d: c.dist, label: c.name }));
      ctx.font = T.font;
      for (const m of marks) {
        const t = m.d <= 0.5 ? ref.lap.start : crossingTime(ref.lap, m.d);
        if (!Number.isFinite(t)) continue;
        const [sx, sy] = toScreen(...positionAt(path, t));
        if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
        ctx.fillStyle = T.text3;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
        ctx.fill();
        const tw = ctx.measureText(m.label).width + 8;
        ctx.fillStyle = withAlpha(T.surface2, 0.85);
        ctx.fillRect(sx + 6, sy - 15, tw, 14);
        ctx.fillStyle = T.text2;
        ctx.textAlign = 'left';
        ctx.fillText(m.label, sx + 10, sy - 8);
      }
    }

    // Scale bar
    if (config.showScale !== false) {
      const len = niceLength(90 / sc);
      const bx = w - 16 - len * sc;
      const by = h - legendH - 10;
      ctx.strokeStyle = T.text2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by - 4);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + len * sc, by);
      ctx.lineTo(bx + len * sc, by - 4);
      ctx.stroke();
      ctx.fillStyle = T.text2;
      ctx.textAlign = 'center';
      ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, bx + (len * sc) / 2, by - 10);
    }

    // Legend
    if (config.showLegend === false) return;
    let x = 10;
    const ly = h - legendH / 2;
    ctx.textAlign = 'left';
    for (const { l } of lines.slice(0, 8)) {
      ctx.fillStyle = l.color;
      ctx.fillRect(x, ly - 1.5, 14, 3);
      ctx.fillStyle = T.text2;
      const label = lapLabel(l.lap) + (l.isRef ? ' (ref)' : '');
      ctx.fillText(label, x + 18, ly);
      x += ctx.measureText(label).width + 32;
    }
    if (lines.length < 2) {
      ctx.fillStyle = T.text3;
      ctx.fillText('Ctrl/⌘+click more laps to compare lines', x + 4, ly);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, config, sessions, lapSel, refKey, xMode, zoom, dataVersion, theme, profiles, working]);

  const drawOverlay = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(overRef.current, w, h);
    const xf = xfRef.current;
    if (!ctx || !xf) return;
    const T = chartTheme();
    const st = useStore.getState();
    if (st.cursor == null) return;
    const laps = selectedLaps(st).filter((l) => l.session.meta.venue === xf.ref.session.meta.venue);
    const ref = xf.ref;
    const tRef = xToTime(ref.lap, st.cursor, st.xMode);
    const dRef = ref.lap.index === -1 ? NaN : lapDistAt(ref.lap, tRef);
    const [rx, ry] = positionAt(xf.path, tRef);
    const [hx, hy] = positionAt(xf.path, tRef + 0.1);
    const hl = Math.hypot(hx - rx, hy - ry) || 1;
    const rows: { color: string; text: string }[] = [];
    for (const l of laps.slice(1).concat(laps.slice(0, 1))) {
      // Lap objects are rebuilt on every read — compare by key, not identity.
      const isRef = l.key === ref.key;
      const p = isRef ? xf.path : lapPath(l.session, l.lap);
      if (!p) continue;
      const t = xToTime(l.lap, st.cursor, st.xMode);
      if (l.lap.index !== -1 && (t < l.lap.start || t > l.lap.end)) continue;
      const [sx, sy] = xf.toScreen(...positionAt(p, t));
      ctx.beginPath();
      ctx.arc(sx, sy, isRef ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = l.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isRef ? T.cursor : T.surface;
      ctx.stroke();
      // Lateral offset from the reference line at the same lap distance.
      if (!isRef && Number.isFinite(dRef)) {
        const tl = lapTimeAtDist(l.lap, dRef);
        const [ox, oy] = positionAt(p, tl);
        const cross = ((hx - rx) * (oy - ry) - (hy - ry) * (ox - rx)) / hl;
        const side = cross > 0 ? 'left' : 'right';
        rows.push({ color: l.color, text: `${lapLabel(l.lap)}: ${Math.abs(cross).toFixed(1)} m ${side} of ref` });
      }
    }
    if (rows.length && config.showOffsets !== false) {
      ctx.font = T.font;
      const bw = Math.max(...rows.map((r) => ctx.measureText(r.text).width)) + 18;
      ctx.fillStyle = withAlpha(T.surface, 0.85);
      ctx.fillRect(8, 8, bw, rows.length * 16 + 8);
      rows.forEach((r, i) => {
        ctx.fillStyle = withAlpha(r.color, 0.3);
        ctx.fillRect(12, 9 + i * 16, ctx.measureText(r.text).width + 10, 14);
        ctx.fillStyle = T.text;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(r.text, 17, 16 + i * 16);
      });
    }
  }, [size, config.showOffsets]);

  useEffect(() => {
    drawBase();
    drawOverlay();
  }, [drawBase, drawOverlay]);
  // When following the cursor the map itself moves, so redraw the base layer too.
  useStoreListener(() => {
    if (config.followCursor && viewRef.current.scale > 1.2) drawBase();
    drawOverlay();
  }, [drawOverlay, drawBase, config.followCursor]);
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
      const my = e.clientY - r.top - (size.h - (config.showLegend === false ? 6 : 26)) / 2;
      const v = viewRef.current;
      const ns = Math.max(0.5, Math.min(400, v.scale * Math.pow(1.0018, -e.deltaY)));
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
    if (best < 30 * 30) setCursor(timeToX(xf.ref.lap, xf.path.t[bi], useStore.getState().xMode));
  };

  const resetView = () => {
    viewRef.current = { scale: 1, ox: 0, oy: 0 };
    redraw();
  };

  return (
    <div ref={wrapRef} className="chart">
      <canvas ref={baseRef} />
      <canvas
        ref={overRef}
        style={{ cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
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
          if (d && !d.moved) {
            const r = overRef.current!.getBoundingClientRect();
            seekTo(e.clientX - r.left, e.clientY - r.top);
          }
        }}
        onDoubleClick={resetView}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e, trackMapMenuItems(venue, config.id, { showSectors: config.showSectors, showCorners: config.showCorners }));
        }}
      />
      {venue && <RotationDial venue={venue} />}
    </div>
  );
}
