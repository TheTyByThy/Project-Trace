// High-performance CSV telemetry parser. Runs in a Web Worker.
//
// Telemetrick writes a multi-rate file: every row is one 150 Hz tick, and slower channels
// (30/10/1 Hz) leave their cells empty on ticks where they were not sampled. We therefore
// parse each column into its own (row index, value) list and then store every channel at
// its *native* rate on a uniform grid. That keeps memory ~4x smaller than resampling
// everything to the fastest rate, and preserves the original data exactly.

import { headLines, parseHeader } from './header';
import type { ParsedChannel, ParsedFile, Samples } from './types';

const POW10: number[] = [];
for (let i = 0; i <= 330; i++) POW10.push(Number('1e' + i));

/** Parse a decimal number from bytes [s, e). Returns NaN for non-numeric text. */
function parseNum(b: Uint8Array, s: number, e: number): number {
  while (s < e && (b[s] === 32 || b[s] === 34 || b[s] === 9)) s++;
  while (e > s && (b[e - 1] === 32 || b[e - 1] === 34 || b[e - 1] === 9)) e--;
  if (s >= e) return NaN;
  let i = s;
  let neg = false;
  if (b[i] === 45) {
    neg = true;
    i++;
  } else if (b[i] === 43) i++;
  let mant = 0;
  let exp10 = 0;
  let digits = 0;
  let any = false;
  let c = 0;
  while (i < e) {
    c = b[i];
    if (c < 48 || c > 57) break;
    any = true;
    if (mant === 0 && c === 48) {
      /* leading zero */
    } else if (digits < 17) {
      mant = mant * 10 + (c - 48);
      digits++;
    } else exp10++;
    i++;
  }
  if (i < e && b[i] === 46) {
    i++;
    while (i < e) {
      c = b[i];
      if (c < 48 || c > 57) break;
      any = true;
      if (mant === 0 && c === 48) exp10--;
      else if (digits < 17) {
        mant = mant * 10 + (c - 48);
        digits++;
        exp10--;
      }
      i++;
    }
  }
  if (!any) return NaN;
  if (i < e && (b[i] === 101 || b[i] === 69)) {
    i++;
    let eneg = false;
    if (b[i] === 45) {
      eneg = true;
      i++;
    } else if (b[i] === 43) i++;
    let ev = 0;
    let anyE = false;
    while (i < e) {
      c = b[i];
      if (c < 48 || c > 57) break;
      ev = ev * 10 + (c - 48);
      anyE = true;
      i++;
    }
    if (!anyE) return NaN;
    exp10 += eneg ? -ev : ev;
  }
  if (i !== e) return NaN;
  let v: number;
  if (mant === 0) v = 0;
  else if (exp10 === 0) v = mant;
  else if (exp10 > 0) v = exp10 > 330 ? Infinity : mant * POW10[exp10];
  else if (exp10 >= -330) v = mant / POW10[-exp10];
  else v = mant / POW10[330] / POW10[Math.min(330, -exp10 - 330)];
  return neg ? -v : v;
}

class ColumnBuffer {
  rows: Uint32Array = new Uint32Array(1024);
  vals: Float64Array = new Float64Array(1024);
  n = 0;
  text = 0;
  /** A few distinct text values (for columns that turn out to be all text). */
  textValues: string[] = [];
  push(row: number, v: number) {
    if (this.n === this.rows.length) {
      const nr = new Uint32Array(this.rows.length * 2);
      nr.set(this.rows);
      this.rows = nr;
      const nv = new Float64Array(this.vals.length * 2);
      nv.set(this.vals);
      this.vals = nv;
    }
    this.rows[this.n] = row;
    this.vals[this.n] = v;
    this.n++;
  }
}

/** Snap an estimated rate to a clean divisor of the base rate (150 → 150/75/50/30/25/15/10/5/3/2/1). */
function snapRate(est: number, base: number): number {
  if (!(est > 0)) return base;
  let best = base;
  let bestErr = Infinity;
  for (let k = 1; k <= 1000; k++) {
    const r = base / k;
    const err = Math.abs(Math.log(r / est));
    if (err < bestErr) {
      bestErr = err;
      best = r;
    }
    if (r < est / 2) break;
  }
  return best;
}

export function parseTelemetryCsv(buffer: ArrayBuffer, fileName = '', onProgress?: (p: number) => void): ParsedFile {
  const bytes = new Uint8Array(buffer);
  const warnings: string[] = [];

  // ---- locate header using the first chunk ----
  const headBytes = Math.min(bytes.length, 1 << 20);
  const headText = new TextDecoder('utf-8').decode(bytes.subarray(0, headBytes));
  const lines = headLines(headText, headBytes < bytes.length);
  const hdr = parseHeader(lines, fileName);
  if (!hdr) throw new Error('Could not find a channel header row. Is this a telemetry CSV?');

  // Byte offset of the first data line: walk newlines in the raw bytes.
  let pos = 0;
  for (let ln = 0; ln < hdr.dataLine && pos < bytes.length; ln++) {
    while (pos < bytes.length && bytes[pos] !== 10) pos++;
    pos++;
  }

  const ncol = hdr.names.length;
  const timeCol = hdr.timeCol;
  const cols: ColumnBuffer[] = [];
  for (let c = 0; c < ncol; c++) cols.push(new ColumnBuffer());
  const textDecoder = new TextDecoder('utf-8');
  let times = new Float64Array(1 << 16);
  let nrows = 0;
  const total = bytes.length;
  let nextProgress = pos + (1 << 22);

  // Per-row scratch: field boundaries so we can parse the time column first.
  const fs = new Int32Array(ncol + 1);
  const fe = new Int32Array(ncol + 1);

  while (pos < total) {
    // Tokenise one line.
    let col = 0;
    let start = pos;
    let i = pos;
    let inQuote = false;
    for (; i < total; i++) {
      const c = bytes[i];
      if (c === 34) inQuote = !inQuote;
      else if (!inQuote && c === 44) {
        if (col <= ncol) {
          fs[col] = start;
          fe[col] = i;
        }
        col++;
        start = i + 1;
      } else if (!inQuote && (c === 10 || c === 13)) break;
    }
    if (col <= ncol) {
      fs[col] = start;
      fe[col] = i;
    }
    const nf = Math.min(col + 1, ncol);
    // Advance past line terminator(s).
    pos = i;
    while (pos < total && (bytes[pos] === 13 || bytes[pos] === 10)) pos++;

    // Time value.
    let t: number;
    if (timeCol >= 0) {
      if (timeCol >= nf) continue;
      t = parseNum(bytes, fs[timeCol], fe[timeCol]);
      if (!Number.isFinite(t)) continue; // blank or junk line
    } else {
      // No time column: we'll build one from the row index later. Skip fully-empty rows.
      if (fe[0] - fs[0] <= 0 && nf <= 1) continue;
      t = nrows;
    }
    if (nrows === times.length) {
      const nt = new Float64Array(times.length * 2);
      nt.set(times);
      times = nt;
    }
    times[nrows] = t;
    for (let c = 0; c < nf; c++) {
      if (c === timeCol) continue;
      const s = fs[c];
      const e = fe[c];
      if (e <= s) continue;
      const v = parseNum(bytes, s, e);
      if (Number.isNaN(v)) {
        // Non-numeric cell (text/bool). Track it so all-text columns can be skipped.
        const cb = cols[c];
        cb.text++;
        if (cb.textValues.length < 6) {
          const str = textDecoder.decode(bytes.subarray(s, e)).replace(/^"|"$/g, '').trim();
          if (str && !cb.textValues.includes(str)) cb.textValues.push(str);
        }
        continue;
      }
      cols[c].push(nrows, v);
    }
    nrows++;
    if (onProgress && pos > nextProgress) {
      onProgress(pos / total);
      nextProgress = pos + (1 << 22);
    }
  }
  if (nrows < 2) throw new Error('The file contains no data rows.');
  times = times.subarray(0, nrows);

  // ---- timebase ----
  const meta = hdr.meta;
  if (timeCol < 0) {
    const rate = meta.sampleRate || 1;
    for (let r = 0; r < nrows; r++) times[r] = r / rate;
    warnings.push(`No time column found; assumed ${rate} Hz from the header.`);
  }
  // Base rate from the median row spacing.
  const sampleN = Math.min(nrows - 1, 4000);
  const dts: number[] = [];
  for (let r = 1; r <= sampleN; r++) dts.push(times[r] - times[r - 1]);
  dts.sort((a, b) => a - b);
  const medDt = dts[Math.floor(dts.length / 2)] || 1;
  let baseRate = 1 / medDt;
  if (meta.sampleRate && Math.abs(meta.sampleRate - baseRate) / meta.sampleRate < 0.02) baseRate = meta.sampleRate;
  else if (Math.abs(baseRate - Math.round(baseRate)) < 0.01 * baseRate) baseRate = Math.round(baseRate);
  const tStart = times[0];
  const duration = times[nrows - 1] - tStart;
  // Is the row clock uniform? (Telemetrick: yes, exactly.)
  let maxDev = 0;
  for (let r = 0; r < nrows; r += Math.max(1, Math.floor(nrows / 5000))) {
    maxDev = Math.max(maxDev, Math.abs(times[r] - (tStart + r / baseRate)));
  }
  const uniformRows = maxDev < 0.3 / baseRate;
  if (!uniformRows) warnings.push('Irregular time stamps detected; channels were resampled onto a uniform grid.');

  // ---- build channels ----
  const channels: ParsedChannel[] = [];
  for (let c = 0; c < ncol; c++) {
    if (c === timeCol) continue;
    const name = hdr.names[c];
    if (!name) continue;
    const cb = cols[c];
    if (cb.n < 2) {
      // Not plottable (text, or fewer than two numbers): keep it in the session details instead of
      // dropping it, so every field in the file is visible somewhere.
      const vals = cb.textValues.length ? cb.textValues : cb.n === 1 ? [String(cb.vals[0])] : [];
      const unit = hdr.units[c] ? ` ${hdr.units[c]}` : '';
      hdr.meta.extra[name] = vals.length ? vals.join(' · ') + (cb.textValues.length >= 6 ? ' …' : '') + unit : '(no data)';
      continue;
    }
    const unit = hdr.units[c] ?? '';
    // Precision: epoch-style values need Float64.
    let absMax = 0;
    for (let k = 0; k < cb.n; k++) {
      const a = Math.abs(cb.vals[k]);
      if (a > absMax) absMax = a;
    }
    const wide = absMax > 1e6;

    let step = 0;
    if (uniformRows) {
      step = cb.rows[1] - cb.rows[0];
      for (let k = 2; k < cb.n; k++) {
        if (cb.rows[k] - cb.rows[k - 1] !== step) {
          step = 0;
          break;
        }
      }
    }
    if (step > 0) {
      const data: Samples = wide ? new Float64Array(cb.n) : new Float32Array(cb.n);
      for (let k = 0; k < cb.n; k++) data[k] = cb.vals[k];
      channels.push({ name, unit, rate: baseRate / step, t0: times[cb.rows[0]] - tStart, data });
    } else {
      // Irregular sampling: resample onto a uniform grid at a snapped rate using linear interpolation.
      const tFirst = times[cb.rows[0]] - tStart;
      const tLast = times[cb.rows[cb.n - 1]] - tStart;
      const est = (cb.n - 1) / Math.max(1e-9, tLast - tFirst);
      const rate = snapRate(est, baseRate);
      const n = Math.max(2, Math.floor((tLast - tFirst) * rate) + 1);
      const data: Samples = wide ? new Float64Array(n) : new Float32Array(n);
      let k = 0;
      for (let j = 0; j < n; j++) {
        const t = tFirst + j / rate;
        while (k < cb.n - 2 && times[cb.rows[k + 1]] - tStart < t) k++;
        const ta = times[cb.rows[k]] - tStart;
        const tb = times[cb.rows[k + 1]] - tStart;
        const a = cb.vals[k];
        const bv = cb.vals[k + 1];
        const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
        data[j] = a + (bv - a) * f;
      }
      channels.push({ name, unit, rate, t0: tFirst, data });
    }
  }
  onProgress?.(1);

  if (!meta.duration) meta.duration = duration;
  if (!meta.sampleRate) meta.sampleRate = baseRate;
  return { meta, channels, duration, baseRate, warnings };
}
