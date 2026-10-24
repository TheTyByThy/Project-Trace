// MoTeC i2 log (.ld) reader + .ldx sidecar parser. Telemetrick writes an .ld/.ldx pair next to every
// export, so this opens a driver's whole history (not just sessions exported as CSV).
//
// .ld layout (little-endian, community-documented): a fixed header with metadata and pointers,
// then a linked list of 124-byte channel headers, each pointing at its sample block.
// Sample value = (raw / scale × 10^-dec + shift) × mul.

import { emptyMeta, parseLogDateTime, savedAtFromFileName } from './header';
import type { MetaValue, ParsedChannel, ParsedFile, Samples } from './types';

const cstr = (b: Uint8Array, o: number, n: number) => {
  let e = o;
  while (e < o + n && e < b.length && b[e] !== 0) e++;
  return new TextDecoder('latin1').decode(b.subarray(o, e)).trim();
};

function half(u: number): number {
  const s = u & 0x8000 ? -1 : 1;
  const e = (u >> 10) & 0x1f;
  const f = u & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

export interface LdHeader {
  date: string;
  time: string;
  driver: string;
  vehicle: string;
  venue: string;
  comment: string;
  metaPtr: number;
  numChannels: number;
}

export function readLdHeader(bytes: Uint8Array): LdHeader | null {
  if (bytes.length < 1762) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaPtr = dv.getUint32(8, true);
  if (metaPtr < 1700 || metaPtr > 1e8) return null;
  return {
    metaPtr,
    numChannels: dv.getUint32(86, true),
    date: cstr(bytes, 94, 16),
    time: cstr(bytes, 126, 16),
    driver: cstr(bytes, 158, 64),
    vehicle: cstr(bytes, 222, 64),
    venue: cstr(bytes, 350, 64),
    comment: cstr(bytes, 1572, 64),
  };
}

export interface LdChannelHeader {
  name: string;
  unit: string;
  rate: number;
  n: number;
  dataPtr: number;
  dtypeA: number;
  dtype: number;
  shift: number;
  mul: number;
  scale: number;
  dec: number;
}

/** Walk the channel header list. Stops gracefully if the buffer is truncated (header-only reads). */
export function readLdChannels(bytes: Uint8Array, metaPtr: number): LdChannelHeader[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: LdChannelHeader[] = [];
  let a = metaPtr;
  const seen = new Set<number>();
  while (a && a + 84 <= bytes.length && !seen.has(a) && out.length < 4000) {
    seen.add(a);
    out.push({
      dataPtr: dv.getUint32(a + 8, true),
      n: dv.getUint32(a + 12, true),
      dtypeA: dv.getUint16(a + 18, true),
      dtype: dv.getUint16(a + 20, true),
      rate: dv.getUint16(a + 22, true),
      shift: dv.getInt16(a + 24, true),
      mul: dv.getInt16(a + 26, true),
      scale: dv.getInt16(a + 28, true),
      dec: dv.getInt16(a + 30, true),
      name: cstr(bytes, a + 32, 32),
      unit: cstr(bytes, a + 72, 12),
    });
    a = dv.getUint32(a + 4, true);
  }
  return out;
}

/** Decode one sample of a channel at index k. */
export function ldSample(dv: DataView, h: LdChannelHeader, k: number): number {
  const isFloat = h.dtypeA === 0x07;
  const size = h.dtype === 2 ? 2 : h.dtype === 8 ? 8 : 4;
  const o = h.dataPtr + k * size;
  let raw: number;
  if (isFloat) raw = size === 2 ? half(dv.getUint16(o, true)) : size === 8 ? dv.getFloat64(o, true) : dv.getFloat32(o, true);
  else raw = size === 2 ? dv.getInt16(o, true) : dv.getInt32(o, true);
  const scale = h.scale || 1;
  const mul = h.mul || 1;
  return (raw / scale * Math.pow(10, -h.dec) + h.shift) * mul;
}

export interface LdxInfo {
  beacons: number[];
  details: Record<string, MetaValue>;
  setup: Record<string, MetaValue>;
  totalLaps: number | null;
  fastestTime: number | null;
  fastestLap: number | null;
}

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : undefined;
};

/** Regex-based (works inside a Web Worker, where DOMParser is unavailable). */
export function parseLdx(text: string): LdxInfo {
  const info: LdxInfo = { beacons: [], details: {}, setup: {}, totalLaps: null, fastestTime: null, fastestLap: null };
  for (const m of text.matchAll(/<Marker\b[^>]*>/g)) {
    const t = Number(attr(m[0], 'Time'));
    if (Number.isFinite(t) && t > 0) info.beacons.push(t / 1e6);
  }
  info.beacons.sort((a, b) => a - b);
  for (const m of text.matchAll(/<(String|Numeric)\b[^>]*\/>/g)) {
    const id = attr(m[0], 'Id');
    const value = attr(m[0], 'Value') ?? '';
    if (!id) continue;
    if (id === 'Total Laps') info.totalLaps = Number(value) || null;
    else if (id === 'Fastest Lap') info.fastestLap = Number(value) || null;
    else if (id === 'Fastest Time') {
      const mm = value.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
      if (mm) info.fastestTime = Number(mm[1] ?? 0) * 60 + Number(mm[2]);
    } else info.details[id] = { value, unit: attr(m[0], 'Unit') ?? '' };
  }
  for (const m of text.matchAll(/<MathExpression\b[^>]*\/>/g)) {
    const id = attr(m[0], 'Id');
    const script = attr(m[0], 'Script');
    if (id?.startsWith('Setup ') && script != null && /^-?\d+(\.\d+)?$/.test(script.trim()))
      info.setup[id.slice(6)] = { value: script.trim(), unit: attr(m[0], 'Unit') ?? '' };
  }
  return info;
}

export function parseLd(buffer: ArrayBuffer, fileName: string, ldxText?: string, onProgress?: (p: number) => void): ParsedFile {
  const bytes = new Uint8Array(buffer);
  const hdr = readLdHeader(bytes);
  if (!hdr) throw new Error('Not a MoTeC .ld file (header not recognised).');
  const dv = new DataView(buffer);
  const heads = readLdChannels(bytes, hdr.metaPtr);
  if (!heads.length) throw new Error('The .ld file contains no channels.');
  const channels: ParsedChannel[] = [];
  const warnings: string[] = [];
  let duration = 0;
  let baseRate = 0;
  heads.forEach((h, idx) => {
    const size = h.dtype === 2 ? 2 : h.dtype === 8 ? 8 : 4;
    if (!h.rate || !h.n || h.dataPtr + h.n * size > bytes.length) {
      if (h.name) warnings.push(`Skipped channel "${h.name}" (no data).`);
      return;
    }
    let absMax = 0;
    const vals = new Float64Array(h.n);
    for (let k = 0; k < h.n; k++) {
      const v = ldSample(dv, h, k);
      vals[k] = v;
      const a = Math.abs(v);
      if (a > absMax) absMax = a;
    }
    const data: Samples = absMax > 1e6 ? vals : Float32Array.from(vals);
    channels.push({ name: h.name, unit: h.unit, rate: h.rate, t0: 0, data });
    duration = Math.max(duration, (h.n - 1) / h.rate);
    baseRate = Math.max(baseRate, h.rate);
    if (onProgress && idx % 16 === 0) onProgress(idx / heads.length);
  });

  const meta = emptyMeta();
  meta.format = 'MoTeC i2 log (.ld)';
  meta.venue = hdr.venue;
  meta.vehicle = hdr.vehicle;
  meta.driver = hdr.driver;
  meta.logDate = hdr.date;
  meta.logTime = hdr.time;
  meta.savedAt = parseLogDateTime(hdr.date, hdr.time) ?? savedAtFromFileName(fileName);
  meta.sampleRate = baseRate;
  meta.duration = duration;
  if (hdr.comment) meta.extra['Comment'] = hdr.comment;
  if (ldxText) {
    const x = parseLdx(ldxText);
    meta.beacons = x.beacons.filter((b) => b < duration);
    let prev = 0;
    meta.lapTimesHeader = meta.beacons.map((b) => {
      const d = b - prev;
      prev = b;
      return d;
    });
    meta.lapCountHeader = x.totalLaps;
    meta.details = x.details;
    meta.setup = x.setup;
  } else warnings.push('No .ldx file found next to the .ld — laps are detected from the Lap Number channel.');
  const utc = channels.find((c) => /^utc time$/i.test(c.name));
  if (utc && utc.data[0] > 1e8) meta.gameTimeUtc = utc.data[0];
  onProgress?.(1);
  return { meta, channels, duration, baseRate, warnings };
}
