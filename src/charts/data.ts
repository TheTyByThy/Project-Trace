// Data helpers shared by charts: lap-relative time windows, per-lap channel ranges, display units.

import { lapSeries, xToTime } from '../core/axis';
import { sampleAt } from '../core/channel';
import { autoDps } from '../core/format';
import type { ChannelInfo, Lap, Samples, Session, XMode } from '../core/types';
import { displayConv, type DisplayConv } from '../core/units';
import { activeWorkspace, useStore, type SelectedLap } from '../state/store';

const smoothCache = new WeakMap<ChannelInfo, Map<number, Float32Array>>();

/**
 * Samples to draw for a channel: the raw data, or a centred moving average when display smoothing
 * is switched on (top bar). Discrete channels (gear, flags…) are never smoothed. Reports and
 * statistics always use the raw data.
 */
export function displayData(ch: ChannelInfo): Samples {
  const sm = useStore.getState().settings.smoothing;
  if (!sm.enabled || ch.discrete) return ch.data;
  const win = Math.round(sm.seconds * ch.rate);
  if (win < 2) return ch.data;
  let m = smoothCache.get(ch);
  if (!m) smoothCache.set(ch, (m = new Map()));
  let out = m.get(win);
  if (!out) {
    const n = ch.n;
    const half = Math.floor(win / 2);
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (Number.isFinite(ch.data[i]) ? ch.data[i] : 0);
    out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - half);
      const b = Math.min(n, i + half + 1);
      out[i] = Number.isFinite(ch.data[i]) ? (pre[b] - pre[a]) / (b - a) : NaN;
    }
    m.set(win, out);
  }
  return out;
}

/** The name to show for a channel: its display name (renamed in Channel properties) or the logged name. */
export function channelLabel(name: string): string {
  return activeWorkspace()?.channelProps[name]?.label || name;
}

export function conv(ch: ChannelInfo): DisplayConv {
  const props = activeWorkspace()?.channelProps[ch.name];
  return displayConv(ch.unit, useStore.getState().settings.units, props?.unit);
}

export function channelDps(ch: ChannelInfo): number {
  const props = activeWorkspace()?.channelProps[ch.name];
  if (props?.dps != null) return props.dps;
  const m = activeWorkspace()?.math.find((d) => d.name === ch.name);
  if (m?.dps != null) return m.dps;
  return autoDps(ch.min, ch.max, ch.discrete);
}

/** Time window [ta, tb] of a lap, optionally restricted to the current zoom. */
export function lapWindow(lap: Lap, useZoom: boolean, zoom: [number, number] | null, mode: XMode): [number, number] {
  if (!useZoom || !zoom) return [lap.start, lap.end];
  const ta = Math.max(lap.start, xToTime(lap, zoom[0], mode));
  const tb = Math.min(lap.end, xToTime(lap, zoom[1], mode));
  return tb > ta ? [ta, tb] : [lap.start, lap.end];
}

const rangeCache = new WeakMap<Lap, Map<ChannelInfo, [number, number]>>();

/** Raw (source-unit) min/max of a channel within a lap. */
export function lapRange(lap: Lap, ch: ChannelInfo): [number, number] {
  let m = rangeCache.get(lap);
  if (!m) rangeCache.set(lap, (m = new Map()));
  let r = m.get(ch);
  if (!r) {
    const ser = lapSeries(lap, ch, 'time');
    let mn = Infinity,
      mx = -Infinity;
    for (let i = ser.i0; i <= ser.i1; i++) {
      const v = ch.data[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    r = Number.isFinite(mn) ? [mn, mx] : [0, 1];
    m.set(ch, r);
  }
  return r;
}

/** Value of a channel at the cursor for a selected lap (display units), or NaN. */
export function valueAtCursor(sel: SelectedLap, name: string, cursor: number | null, mode: XMode): number {
  if (cursor == null) return NaN;
  const ch = sel.session.channels.get(name);
  if (!ch) return NaN;
  const t = xToTime(sel.lap, cursor, mode);
  if (sel.lap.index !== -1 && (t < sel.lap.start - 0.5 || t > sel.lap.end + 0.5)) return NaN;
  const c = conv(ch);
  return sampleAt(ch, t) * c.k + c.b;
}

/** Union of channel names across sessions, in file order, for pickers. */
export function allChannelNames(sessions: Session[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sessions) for (const n of s.channelOrder) if (!seen.has(n)) seen.add(n), out.push(n);
  return out;
}

export function findChannel(sessions: Session[], name: string): ChannelInfo | undefined {
  for (const s of sessions) {
    const c = s.channels.get(name);
    if (c) return c;
  }
  return undefined;
}

/** Samples of several channels on a common grid within [ta, tb] (for scatter/mixture). */
export function sampleGrid(session: Session, names: string[], ta: number, tb: number, maxPoints = 60000): Float64Array[] | null {
  const chans = names.map((n) => session.channels.get(n));
  if (chans.some((c) => !c)) return null;
  const rate = Math.max(...chans.map((c) => c!.rate));
  let n = Math.floor((tb - ta) * rate) + 1;
  let step = 1 / rate;
  if (n > maxPoints) {
    step = (tb - ta) / maxPoints;
    n = maxPoints;
  }
  return chans.map((c) => {
    const out = new Float64Array(n);
    const cv = conv(c!);
    for (let i = 0; i < n; i++) out[i] = sampleAt(c!, ta + i * step) * cv.k + cv.b;
    return out;
  });
}
