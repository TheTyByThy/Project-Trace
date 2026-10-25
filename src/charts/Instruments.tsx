// Cursor-driven instruments: gauges, driver inputs and the four-corner tyre/brake panel.
// They redraw imperatively on cursor moves (no React re-render).

import { useCallback, useEffect, useRef } from 'react';
import { xToTime } from '../core/axis';
import { sampleAt } from '../core/channel';
import { CATEGORICAL, rampColor, withAlpha } from '../core/colors';
import { formatValue } from '../core/format';
import { rangeStats } from '../core/stats';
import type { ChannelInfo, Session } from '../core/types';
import { selectedLaps, updateComponent, useStore, type SelectedLap } from '../state/store';
import { TYRE_FIELDS, type GaugeDef, type GaugesConfig, type InputsConfig, type TyreField, type TyresConfig } from '../state/workspace';
import { openChannelPicker } from '../ui/overlays';
import { chartTheme, prepCanvas, roundRect, useElementSize, useStoreListener } from './canvas';
import { channelDps, channelLabel, conv } from './data';

function cursorTime(sel: SelectedLap | undefined): number | null {
  const st = useStore.getState();
  if (!sel || st.cursor == null) return null;
  return xToTime(sel.lap, st.cursor, st.xMode);
}

function useInstrumentCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const ref = useRef<HTMLCanvasElement>(null);
  const sessions = useStore((s) => s.sessions);
  const laps = useStore((s) => s.laps);
  const refKey = useStore((s) => s.refKey);
  const dv = useStore((s) => s.dataVersion);
  const theme = useStore((s) => s.settings.theme);
  const redraw = useCallback(() => {
    const ctx = prepCanvas(ref.current, size.w, size.h);
    if (ctx) draw(ctx, size.w, size.h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, sessions, laps, refKey, dv, theme, ...deps]);
  useEffect(redraw, [redraw]);
  useStoreListener(redraw, [redraw]);
  return { wrapRef, ref };
}

// ---------------------------------------------------------------------------------------------
// Gauges
// ---------------------------------------------------------------------------------------------

function GaugeCell({ g }: { g: GaugeDef }) {
  const { wrapRef, ref } = useInstrumentCanvas(
    (ctx, w, h) => {
      const T = chartTheme();
      const laps = selectedLaps();
      const sel = laps[0];
      const ch = sel?.session.channels.get(g.channel);
      const t = cursorTime(sel);
      const c = ch ? conv(ch) : { k: 1, b: 0, unit: '' };
      const v = ch && t != null ? sampleAt(ch, t) * c.k + c.b : NaN;
      const dps = ch ? channelDps(ch) : 1;
      const lo = g.min ?? (ch ? ch.min * c.k + c.b : 0);
      const hi = g.max ?? (ch ? ch.max * c.k + c.b : 1);
      const frac = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
      const color = CATEGORICAL[useStore.getState().settings.theme][0];
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const label = `${channelLabel(g.channel)}${c.unit ? ` [${c.unit}]` : ''}`;
      const others = laps.slice(1, 4).map((l) => {
        const cc = l.session.channels.get(g.channel);
        const tt = cursorTime(l);
        return { color: l.color, v: cc && tt != null ? sampleAt(cc, tt) * c.k + c.b : NaN };
      });
      if (g.style === 'dial') {
        // Fit the 270° arc plus a line for min/max and a line for the title below it.
        const r = Math.max(10, Math.min(w / 2 - 14, (h - 40) / 1.72));
        const cx = w / 2;
        const cy = 8 + r + Math.max(4, r * 0.08);
        const a0 = Math.PI * 0.75,
          a1 = Math.PI * 2.25;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(4, r * 0.12);
        ctx.strokeStyle = T.road;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a1);
        ctx.stroke();
        if (Number.isFinite(v)) {
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac);
          ctx.stroke();
          const an = a0 + (a1 - a0) * frac;
          ctx.strokeStyle = T.cursor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(an) * r * 0.82, cy + Math.sin(an) * r * 0.82);
          ctx.stroke();
        }
        for (const o of others) {
          if (!Number.isFinite(o.v)) continue;
          const an = a0 + (a1 - a0) * Math.max(0, Math.min(1, (o.v - lo) / (hi - lo || 1)));
          ctx.strokeStyle = o.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(an) * r * 0.9, cy + Math.sin(an) * r * 0.9);
          ctx.lineTo(cx + Math.cos(an) * r * 1.12, cy + Math.sin(an) * r * 1.12);
          ctx.stroke();
        }
        ctx.fillStyle = T.text;
        ctx.font = `600 ${Math.max(12, r * 0.38)}px "SF Mono", Consolas, monospace`;
        ctx.fillText(formatValue(v, dps), cx, cy + r * 0.3);
        ctx.font = T.font;
        ctx.fillStyle = T.text3;
        const endY = cy + r * 0.707 + 13;
        ctx.fillText(formatValue(lo, 0), cx - r * 0.707, endY);
        ctx.fillText(formatValue(hi, 0), cx + r * 0.707, endY);
        ctx.fillStyle = T.text2;
        ctx.fillText(label, cx, Math.min(h - 8, endY + 15));
      } else if (g.style === 'bar') {
        const bx = 10,
          bw = w - 20,
          by = h / 2 - 2,
          bh = Math.min(16, h / 4);
        ctx.fillStyle = T.text2;
        ctx.textAlign = 'left';
        ctx.font = T.font;
        ctx.fillText(label, bx, by - 14);
        ctx.textAlign = 'right';
        ctx.fillStyle = T.text;
        ctx.font = `600 13px "SF Mono", Consolas, monospace`;
        ctx.fillText(formatValue(v, dps), bx + bw, by - 14);
        ctx.fillStyle = T.road;
        roundRect(ctx, bx, by, bw, bh, 4);
        ctx.fill();
        if (Number.isFinite(v)) {
          ctx.fillStyle = color;
          roundRect(ctx, bx, by, Math.max(4, bw * frac), bh, 4);
          ctx.fill();
        }
        for (const o of others) {
          if (!Number.isFinite(o.v)) continue;
          const f = Math.max(0, Math.min(1, (o.v - lo) / (hi - lo || 1)));
          ctx.fillStyle = o.color;
          ctx.fillRect(bx + bw * f - 1.5, by - 3, 3, bh + 6);
        }
      } else {
        ctx.fillStyle = T.text;
        ctx.font = `700 ${Math.max(14, Math.min(h * 0.45, w * 0.3))}px "SF Mono", Consolas, monospace`;
        ctx.fillText(formatValue(v, dps), w / 2, h / 2 - 4);
        ctx.font = T.font;
        ctx.fillStyle = T.text3;
        ctx.fillText(label, w / 2, h - 10);
        // Comparison laps' values on a translucent background in their lap colour.
        ctx.font = T.mono;
        others.forEach((o, i) => {
          const x = w / 2 + (i - (others.length - 1) / 2) * 54;
          const txt = formatValue(o.v, dps);
          const tw = ctx.measureText(txt).width + 8;
          ctx.fillStyle = withAlpha(o.color, 0.3);
          ctx.fillRect(x - tw / 2, 4, tw, 16);
          ctx.fillStyle = T.text;
          ctx.fillText(txt, x, 12);
        });
        ctx.font = T.font;
      }
    },
    [g],
  );
  return (
    <div ref={wrapRef} style={{ position: 'relative', minHeight: 0, minWidth: 0 }}>
      <canvas ref={ref} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}

export function GaugesView({ config }: { config: GaugesConfig }) {
  const rows = Math.ceil(config.gauges.length / Math.max(1, config.columns));
  if (!config.gauges.length)
    return (
      <div className="empty-state">
        <button className="btn" onClick={(e) => openChannelPicker(e, (n) => updateComponent(config.id, { gauges: [{ channel: n, style: 'dial' }] }))}>
          + Add gauge
        </button>
      </div>
    );
  return (
    <div
      style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: `repeat(${config.columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, gap: 4, padding: 4 }}
      onDragOver={(e) => e.dataTransfer.types.includes('application/x-pt-channel') && (e.preventDefault(), e.stopPropagation())}
      onDrop={(e) => {
        const n = e.dataTransfer.getData('application/x-pt-channel');
        if (n) {
          e.preventDefault();
          e.stopPropagation();
          updateComponent(config.id, { gauges: [...config.gauges, { channel: n, style: 'digital' }] });
        }
      }}
    >
      {config.gauges.map((g, i) => (
        <GaugeCell key={i + g.channel + g.style} g={g} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Driver inputs
// ---------------------------------------------------------------------------------------------

function val(s: Session, name: string | undefined, t: number | null): number {
  if (!name || t == null) return NaN;
  const ch = s.channels.get(name);
  return ch ? sampleAt(ch, t) : NaN;
}

export function InputsView({ config }: { config: InputsConfig }) {
  const { wrapRef, ref } = useInstrumentCanvas(
    (ctx, w, h) => {
      const T = chartTheme();
      const theme = useStore.getState().settings.theme;
      const pal = CATEGORICAL[theme];
      const laps = selectedLaps();
      const sel = laps[0];
      ctx.textBaseline = 'middle';
      if (!sel) {
        ctx.fillStyle = T.text3;
        ctx.textAlign = 'center';
        ctx.fillText('Select a lap', w / 2, h / 2);
        return;
      }
      const cmp = config.showCompare ? laps[1] : undefined;
      const t = cursorTime(sel);
      const tc = cmp ? cursorTime(cmp) : null;
      const k = sel.session.key;
      const pedalH = h - 44;
      // AC logs clutch as engagement (100 = pedal released); show pedal travel instead.
      const clutchInverted = /^clutch pos$/i.test(k.clutch ?? '');
      const bars = [
        ...(config.showPedals !== false
          ? [
              { label: 'THR', role: 'throttle' as const, color: pal[2], invert: false },
              { label: 'BRK', role: 'brake' as const, color: pal[7], invert: false },
            ]
          : []),
        ...(config.showClutch !== false ? [{ label: 'CLU', role: 'clutch' as const, color: pal[4], invert: clutchInverted }] : []),
      ];
      const pedal = (s: Session, role: 'throttle' | 'brake' | 'clutch', tt: number | null, invert: boolean) => {
        const raw = val(s, s.key[role], tt);
        return Math.max(0, Math.min(100, invert ? 100 - raw : raw));
      };
      const bw = Math.max(14, Math.min(26, w * 0.06));
      bars.forEach((b, i) => {
        const x = 12 + i * (bw + 10);
        const y = 14;
        ctx.fillStyle = T.road;
        roundRect(ctx, x, y, bw, pedalH, 4);
        ctx.fill();
        const v = pedal(sel.session, b.role, t, b.invert);
        if (Number.isFinite(v)) {
          ctx.fillStyle = b.color;
          roundRect(ctx, x, y + pedalH * (1 - v / 100), bw, Math.max(2, (pedalH * v) / 100), 4);
          ctx.fill();
        }
        if (cmp) {
          const vc = pedal(cmp.session, b.role, tc, b.invert);
          if (Number.isFinite(vc)) {
            ctx.fillStyle = cmp.color;
            ctx.fillRect(x - 3, y + pedalH * (1 - vc / 100) - 1.5, bw + 6, 3);
          }
        }
        ctx.fillStyle = T.text3;
        ctx.textAlign = 'center';
        ctx.font = T.font;
        ctx.fillText(b.label, x + bw / 2, h - 22);
        ctx.fillStyle = T.text;
        ctx.font = T.mono;
        ctx.fillText(Number.isFinite(v) ? v.toFixed(0) : '—', x + bw / 2, h - 8);
      });
      // Steering wheel
      const left = 12 + bars.length * (bw + 10) + 10;
      const rem = w - left - 10;
      const showWheel = config.showSteering !== false;
      const r = showWheel ? Math.max(16, Math.min(rem * 0.3, h * 0.36)) : 0;
      const cx = left + r + 6;
      const cy = h / 2 - 6;
      const steer = val(sel.session, k.steering, t);
      const drawWheel = (angleDeg: number, color: string, ghost: boolean) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(((Number.isFinite(angleDeg) ? angleDeg : 0) * Math.PI) / 180);
        ctx.strokeStyle = color;
        ctx.lineWidth = ghost ? 2 : Math.max(5, r * 0.16);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        if (!ghost) {
          ctx.lineWidth = Math.max(3, r * 0.1);
          ctx.beginPath();
          ctx.moveTo(-r, 0);
          ctx.lineTo(r, 0);
          ctx.moveTo(0, 0);
          ctx.lineTo(0, r);
          ctx.stroke();
          ctx.fillStyle = pal[3];
          ctx.fillRect(-3, -r - ctx.lineWidth, 6, ctx.lineWidth * 1.6);
        } else {
          ctx.beginPath();
          ctx.moveTo(0, -r - 6);
          ctx.lineTo(0, -r + 6);
          ctx.stroke();
        }
        ctx.restore();
      };
      if (showWheel) {
        // Rotate with the same sign as the Steering Angle trace, so the wheel turns the way the trace goes.
        drawWheel(steer, T.text2, false);
        if (cmp) drawWheel(val(cmp.session, cmp.session.key.steering, tc), cmp.color, true);
        ctx.fillStyle = T.text;
        ctx.textAlign = 'center';
        ctx.font = T.mono;
        ctx.fillText(Number.isFinite(steer) ? `${Math.round(steer) || 0}°` : '—', cx, cy + r + 18);
      }
      // Gear / speed / rpm
      const gx = showWheel ? cx + r + 24 : left;
      const gw = w - gx - 10;
      if (gw > 40) {
        const gear = val(sel.session, k.gear, t);
        const sp = k.speed ? sel.session.channels.get(k.speed) : undefined;
        const spc = sp ? conv(sp) : { k: 1, b: 0, unit: '' };
        const speed = val(sel.session, k.speed, t) * spc.k + spc.b;
        const rpmCh: ChannelInfo | undefined = k.rpm ? sel.session.channels.get(k.rpm) : undefined;
        const rpm = val(sel.session, k.rpm, t);
        ctx.textAlign = 'center';
        ctx.fillStyle = T.text;
        ctx.font = `700 ${Math.min(h * 0.38, gw * 0.5)}px "SF Mono", Consolas, monospace`;
        if (config.showGear !== false) ctx.fillText(Number.isFinite(gear) ? (gear === 0 ? 'N' : gear < 0 ? 'R' : String(Math.round(gear))) : '—', gx + gw / 2, h * 0.32);
        if (config.showSpeed !== false) {
          ctx.font = `600 ${Math.min(22, gw * 0.18)}px "SF Mono", Consolas, monospace`;
          ctx.fillText(Number.isFinite(speed) ? speed.toFixed(0) : '—', gx + gw / 2, h * 0.62);
          ctx.font = T.font;
          ctx.fillStyle = T.text3;
          ctx.fillText(spc.unit || 'speed', gx + gw / 2, h * 0.62 + 16);
        }
        if (rpmCh && config.showRpm !== false) {
          const f = Math.max(0, Math.min(1, rpm / (rpmCh.max || 1)));
          ctx.fillStyle = T.road;
          roundRect(ctx, gx + 4, h - 22, gw - 8, 8, 4);
          ctx.fill();
          ctx.fillStyle = f > 0.94 ? pal[7] : pal[1];
          roundRect(ctx, gx + 4, h - 22, Math.max(4, (gw - 8) * f), 8, 4);
          ctx.fill();
          ctx.fillStyle = T.text3;
          ctx.fillText(Number.isFinite(rpm) ? `${rpm.toFixed(0)} rpm` : '', gx + gw / 2, h - 30);
        }
      }
    },
    [config.showCompare, config.showPedals, config.showClutch, config.showSteering, config.showGear, config.showSpeed, config.showRpm],
  );
  return (
    <div ref={wrapRef} className="chart">
      <canvas ref={ref} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Tyres & brakes
// ---------------------------------------------------------------------------------------------

const CORNERS = ['FL', 'FR', 'RL', 'RR'] as const;

function findCh(s: Session, base: string, corner: string): ChannelInfo | undefined {
  for (const b of [base, base.replace('Tire', 'Tyre'), base.replace('Tyre', 'Tire')]) {
    const c = s.channels.get(`${b} ${corner}`);
    if (c) return c;
  }
  return undefined;
}

/** Text lines the tyre panel can show: label, candidate channel bases (first match wins), decimals. */
const TYRE_LINES: Partial<Record<TyreField, { label: string; bases: string[]; dps: number }>> = {
  pressure: { label: 'P', bases: ['Tire Pressure'], dps: 1 },
  brakeTemp: { label: 'Brk', bases: ['Brake Temp'], dps: 0 },
  load: { label: 'Load', bases: ['Tire Load'], dps: 0 },
  slipAngle: { label: 'Slip', bases: ['Tire Slip Angle'], dps: 1 },
  slipRatio: { label: 'SR', bases: ['Tire Slip Ratio', 'ndSlip'], dps: 2 },
  wear: { label: 'Wear', bases: ['Tire Wear', 'VirtualKm'], dps: 2 },
  grip: { label: 'Grip', bases: ['Tire Rubber Grip'], dps: 1 },
  dirt: { label: 'Dirt', bases: ['Tire Dirt Level'], dps: 1 },
  grain: { label: 'Grain', bases: ['Tire Grain'], dps: 1 },
  blister: { label: 'Blist', bases: ['Tire Blister'], dps: 1 },
  camber: { label: 'Cam', bases: ['Camber'], dps: 2 },
  travel: { label: 'Trav', bases: ['Suspension Travel', 'Ride Height'], dps: 1 },
  wheelSpeed: { label: 'ω', bases: ['Wheel Angular Speed'], dps: 0 },
  latForce: { label: 'Fy', bases: ['Tire Lat Fy'], dps: 0 },
  longForce: { label: 'Fx', bases: ['Tire Long Fx'], dps: 0 },
  loadedRadius: { label: 'Rad', bases: ['Tire Loaded Radius'], dps: 3 },
};

function findAny(s: Session, bases: string[], corner: string): ChannelInfo | undefined {
  for (const b of bases) {
    const c = findCh(s, b, corner);
    if (c) return c;
  }
  return undefined;
}

export function TyresView({ config }: { config: TyresConfig }) {
  const { wrapRef, ref } = useInstrumentCanvas(
    (ctx, w, h) => {
      const T = chartTheme();
      const theme = useStore.getState().settings.theme;
      const sel = selectedLaps()[0];
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      if (!sel) {
        ctx.fillStyle = T.text3;
        ctx.fillText('Select a lap', w / 2, h / 2);
        return;
      }
      const s = sel.session;
      const t = cursorTime(sel);
      const read = (ch: ChannelInfo | undefined): number => {
        if (!ch) return NaN;
        if (config.mode === 'cursor') return t == null ? NaN : sampleAt(ch, t);
        const st = rangeStats(ch.data, Math.ceil((sel.lap.start - ch.t0) * ch.rate), Math.floor((sel.lap.end - ch.t0) * ch.rate));
        return config.mode === 'mean' ? st.mean : st.max;
      };
      const disp = (ch: ChannelInfo | undefined, v: number, d = 0) => {
        if (!ch || !Number.isFinite(v)) return '—';
        const c = conv(ch);
        return `${formatValue(v * c.k + c.b, d)}${c.unit === '°C' || c.unit === '°F' ? '°' : ' ' + c.unit}`;
      };
      // Tyre temp colour: blue (cold) → grey (≈ optimal) → red (hot), on °C.
      const tempColor = (c: number) => rampColor('diverging', theme, (c - 50) / 80);
      const brakeColor = (c: number) => rampColor('orange', theme, Math.min(1, Math.max(0, (c - 100) / 900)));
      // Geometry: [text][tyre][disc] [body] [disc][tyre][text], text blocks sized to fit.
      ctx.font = T.mono;
      const textW = Math.min(110, Math.max(70, ctx.measureText('Load 0000 N').width + 6));
      const ch2 = (h - 20) / 2;
      const tyW = Math.max(26, Math.min((w - 2 * textW - 80) / 3, ch2 * 0.42, 60));
      const tyH = Math.min(ch2 * 0.78, tyW * 1.9);
      const leftTyreX = Math.max(6 + textW + 8, w / 2 - tyW - 40);
      const rightTyreX = w - leftTyreX - tyW;
      const fields = new Set<TyreField>(config.fields ?? TYRE_FIELDS.filter((f) => f.default).map((f) => f.key));
      // Readable ink on top of a ramp colour.
      const inkOn = (rgb: string) => {
        const m = rgb.match(/\d+/g);
        if (!m) return '#0b0b0b';
        const [r, g, b] = m.map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? '#0b0b0b' : '#f5f5f2';
      };
      CORNERS.forEach((corner, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const isLeft = col === 0;
        const bx = isLeft ? leftTyreX : rightTyreX;
        const by = 10 + row * ch2 + (ch2 - tyH) / 2;
        const zones = ['Inner', 'Middle', 'Outer'].map((z) => findCh(s, `Tire Temp ${z}`, corner));
        // Inner edge faces the car centreline.
        const order = isLeft ? [2, 1, 0] : [0, 1, 2];
        const showStrips = fields.has('surface');
        order.forEach((zi, k) => {
          const v = read(zones[zi]);
          ctx.fillStyle = showStrips && Number.isFinite(v) ? tempColor(v) : T.road;
          const x = bx + (k * tyW) / 3;
          ctx.fillRect(x + (k ? 1 : 0), by, tyW / 3 - (k ? 1 : 0), tyH);
        });
        ctx.strokeStyle = T.text3;
        ctx.lineWidth = 1;
        roundRect(ctx, bx, by, tyW, tyH, 5);
        ctx.stroke();
        // zone temps
        ctx.font = '10px "SF Mono", Consolas, monospace';
        if (fields.has('surfaceValues'))
          order.forEach((zi, k) => {
            const v = read(zones[zi]);
            if (!Number.isFinite(v)) return;
            ctx.fillStyle = showStrips ? inkOn(tempColor(v)) : T.text;
            ctx.fillText(v.toFixed(0), bx + ((k + 0.5) * tyW) / 3, by + tyH * 0.18);
          });
        const core = findCh(s, 'Tire Temp Core', corner);
        const coreV = read(core);
        if (fields.has('core') && Number.isFinite(coreV)) {
          // Core temperature in a small badge so it reads on any strip colour.
          ctx.font = `600 12px "SF Mono", Consolas, monospace`;
          const label = coreV.toFixed(0);
          const bw = ctx.measureText(label).width + 8;
          ctx.fillStyle = withAlpha(T.surface, 0.85);
          roundRect(ctx, bx + tyW / 2 - bw / 2, by + tyH / 2 - 9, bw, 18, 4);
          ctx.fill();
          ctx.fillStyle = T.text;
          ctx.fillText(label, bx + tyW / 2, by + tyH / 2);
        }
        // brake disc on the inside
        const brake = findCh(s, 'Brake Temp', corner);
        const bv = read(brake);
        if (fields.has('brakeDisc')) {
          const dx = isLeft ? bx + tyW + 5 : bx - 11;
          ctx.fillStyle = Number.isFinite(bv) ? brakeColor(bv) : T.road;
          roundRect(ctx, dx, by + tyH * 0.2, 6, tyH * 0.6, 3);
          ctx.fill();
        }
        // text block on the outside
        const tx = isLeft ? bx - 8 : bx + tyW + 8;
        ctx.textAlign = isLeft ? 'right' : 'left';
        ctx.font = `700 12px ${T.font.split(' ').slice(1).join(' ')}`;
        ctx.fillStyle = T.text;
        ctx.fillText(corner, tx, by + 6);
        ctx.font = T.mono;
        const lines: [string, string][] = [];
        for (const f of TYRE_FIELDS) {
          const def = TYRE_LINES[f.key];
          if (!def || !fields.has(f.key)) continue;
          const ch = findAny(s, def.bases, corner);
          lines.push([def.label, disp(ch, read(ch), def.dps)]);
        }
        const rowBottom = 10 + (row + 1) * ch2 - 4;
        const lineH = Math.max(11, Math.min(15, (rowBottom - by - 20) / Math.max(1, lines.length)));
        lines.forEach(([label, v], li) => {
          const y = by + 22 + li * lineH;
          if (y > rowBottom) return;
          // Value hugs the tyre side; the muted label sits beyond it.
          const vw = ctx.measureText(v).width;
          ctx.fillStyle = T.text;
          ctx.fillText(v, isLeft ? tx : tx + ctx.measureText(label + ' ').width, y);
          ctx.fillStyle = T.text3;
          ctx.fillText(label, isLeft ? tx - vw - 6 : tx, y);
        });
        ctx.textAlign = 'center';
      });
      if (config.showCaption !== false) {
        ctx.font = T.font;
        ctx.fillStyle = T.text3;
        ctx.fillText(config.mode === 'cursor' ? 'at cursor · I/M/O surface temps, core in centre' : `lap ${config.mode}`, w / 2, h - 6);
      }
    },
    [config.mode, config.fields, config.showCaption],
  );
  return (
    <div ref={wrapRef} className="chart">
      <canvas ref={ref} />
    </div>
  );
}
