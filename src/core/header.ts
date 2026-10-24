// Header parsing shared by the session browser (reads only the first ~64 KB of each file)
// and the full parser. Understands three layouts:
//   1. "AC pyTelemetry CSV" (Telemetrick for Assetto Corsa) — MoTeC-like header + data/setup blocks
//   2. "MoTeC CSV File" exports — quoted key/value header, Beacon Markers, channel/unit rows
//   3. Generic CSV — first non-numeric row is the channel header, optional unit row

import type { MetaValue, SessionMeta } from './types';

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const isNumeric = (s: string) => s !== '' && Number.isFinite(Number(s));
const isTimeName = (s: string) => /^(time|session time|elapsed time|timestamp|t)(\s*\(s\)|\s*\[s\])?$/i.test(s.trim());

export interface HeaderInfo {
  meta: SessionMeta;
  /** Line index (0-based) of the channel-name row. */
  headerLine: number;
  /** Line index of the unit row, or -1. */
  unitLine: number;
  /** First line index that may contain data. */
  dataLine: number;
  names: string[];
  units: string[];
  timeCol: number;
  /** First data row values (strings) if present in the provided text. */
  firstRow: string[] | null;
}

export function emptyMeta(): SessionMeta {
  return {
    format: 'Generic CSV',
    venue: '',
    vehicle: '',
    driver: '',
    logDate: '',
    logTime: '',
    savedAt: null,
    sampleRate: 0,
    duration: 0,
    lapCountHeader: null,
    lapTimesHeader: [],
    beacons: [],
    details: {},
    setup: {},
    extra: {},
    gameTimeUtc: null,
  };
}

/** Parse "dd/mm/yyyy" (or yyyy-mm-dd) + "hh:mm:ss" into a local epoch ms. */
export function parseLogDateTime(date: string, time: string): number | null {
  let y = 0,
    m = 0,
    d = 0;
  let mt = date.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (mt) {
    d = +mt[1];
    m = +mt[2];
    y = +mt[3];
    if (y < 100) y += 2000;
    if (m > 12 && d <= 12) [d, m] = [m, d]; // tolerate US ordering
  } else if ((mt = date.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/))) {
    y = +mt[1];
    m = +mt[2];
    d = +mt[3];
  } else return null;
  const tm = time.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?/);
  let hh = 0,
    mm = 0,
    ss = 0;
  if (tm) {
    hh = +tm[1];
    mm = +tm[2];
    ss = tm[3] ? +tm[3] : 0;
    if (tm[4]) {
      const pm = /p/i.test(tm[4]);
      if (pm && hh < 12) hh += 12;
      if (!pm && hh === 12) hh = 0;
    }
  }
  const dt = new Date(y, m - 1, d, hh, mm, ss);
  return Number.isFinite(dt.getTime()) ? dt.getTime() : null;
}

/** Telemetrick files are named "ddmmyyyy-hhmmss-Driver-car-track.csv"; use that as a fallback save time. */
export function savedAtFromFileName(name: string): number | null {
  const m = name.match(/^(\d{2})(\d{2})(\d{4})-(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const dt = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
  return Number.isFinite(dt.getTime()) ? dt.getTime() : null;
}

function alignBlock(names: string[], units: string[], values: string[]): Record<string, MetaValue> {
  const out: Record<string, MetaValue> = {};
  // Trailing commas create an empty last cell; drop empties at the end of the name row.
  while (names.length && names[names.length - 1] === '') names.pop();
  const n = names.length;
  const vals = values.slice(0, n);
  let unitFor: string[] = new Array(n).fill('');
  const u = units.slice();
  while (u.length > n) u.pop();
  if (u.length === n) unitFor = u;
  else {
    // Some exporters omit units for text fields; align the unit list to numeric-valued fields.
    const numericIdx = vals.map((v, i) => (isNumeric(v) ? i : -1)).filter((i) => i >= 0);
    const trimmed = units.slice();
    while (trimmed.length > numericIdx.length && trimmed[trimmed.length - 1] === '') trimmed.pop();
    if (trimmed.length === numericIdx.length) numericIdx.forEach((idx, k) => (unitFor[idx] = trimmed[k]));
  }
  for (let i = 0; i < n; i++) {
    if (!names[i]) continue;
    // Telemetrick replaces commas inside text values with "-" — restore a friendlier form.
    out[names[i]] = { value: (vals[i] ?? '').replace(/- /g, ', '), unit: unitFor[i] ?? '' };
  }
  return out;
}

/**
 * Parse header lines. `lines` should be the beginning of the file split on newlines.
 * Works with partial input (the session browser passes only the first chunk).
 */
export function parseHeader(lines: string[], fileName = ''): HeaderInfo | null {
  const meta = emptyMeta();
  let headerLine = -1;

  // 1) Find the channel header line.
  for (let i = 0; i < Math.min(lines.length, 2000); i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length >= 2 && isTimeName(cells[0]) && cells.slice(1).some((c) => c && !isNumeric(c))) {
      headerLine = i;
      break;
    }
  }
  if (headerLine < 0) {
    // Generic CSV: first row with >= 2 non-numeric cells followed by a mostly-numeric row.
    for (let i = 0; i < Math.min(lines.length - 1, 200); i++) {
      const cells = splitCsvLine(lines[i]);
      const textCells = cells.filter((c) => c && !isNumeric(c)).length;
      if (cells.length >= 2 && textCells >= Math.max(2, cells.length * 0.6)) {
        for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
          const nxt = splitCsvLine(lines[j]);
          if (nxt.filter(isNumeric).length >= Math.max(1, nxt.length * 0.5)) {
            headerLine = i;
            break;
          }
        }
        if (headerLine >= 0) break;
      }
    }
  }
  if (headerLine < 0) return null;

  // 2) Metadata above the header.
  let i = 0;
  while (i < headerLine) {
    const cells = splitCsvLine(lines[i]);
    const key = cells[0];
    if (!key && cells.every((c) => !c)) {
      i++;
      continue;
    }
    const next = i + 1 < headerLine ? splitCsvLine(lines[i + 1]) : null;
    const isBlock = key && cells.length > 3 && next && next[0] === '' && !['lapTimes', 'Beacon Markers'].includes(key);
    if (isBlock) {
      // Block: label row with names, then units row (leading empty cell), then values row.
      const names = cells.slice(1);
      const units = (next as string[]).slice(1);
      const valuesRow = i + 2 < headerLine ? splitCsvLine(lines[i + 2]).slice(1) : [];
      const block = alignBlock(names, units, valuesRow);
      if (/setup/i.test(key)) Object.assign(meta.setup, block);
      else Object.assign(meta.details, block);
      i += 3;
      continue;
    }
    // Key/value pairs; MoTeC exports put a second pair in columns 4/5.
    const pairs: [string, string][] = [];
    if (key) pairs.push([key, cells[1] ?? '']);
    if (cells[4]) pairs.push([cells[4], cells[5] ?? '']);
    for (const [k, v] of pairs) applyMeta(meta, k, v, cells);
    i++;
  }

  const names = splitCsvLine(lines[headerLine]);
  while (names.length > 1 && names[names.length - 1] === '') names.pop();
  let unitLine = -1;
  let units: string[] = new Array(names.length).fill('');
  let dataLine = headerLine + 1;
  if (headerLine + 1 < lines.length) {
    const cand = splitCsvLine(lines[headerLine + 1]);
    const numericCount = cand.filter(isNumeric).length;
    if (numericCount <= cand.length * 0.2) {
      unitLine = headerLine + 1;
      units = names.map((_, k) => cand[k] ?? '');
      dataLine = headerLine + 2;
    }
  }
  let timeCol = names.findIndex(isTimeName);
  if (timeCol < 0) timeCol = -1;

  // First data row (skip blank lines).
  let firstRow: string[] | null = null;
  for (let j = dataLine; j < Math.min(lines.length, dataLine + 20); j++) {
    const cells = splitCsvLine(lines[j]);
    if (cells.some((c) => c !== '')) {
      if (j + 1 < lines.length || lines[j].length > 0) firstRow = cells;
      break;
    }
  }

  // In-game clock from the "UTC Time" channel in the first row.
  const utcIdx = names.findIndex((n) => /^utc time$/i.test(n));
  if (utcIdx >= 0 && firstRow && isNumeric(firstRow[utcIdx])) {
    const v = Number(firstRow[utcIdx]);
    if (v > 1e8) meta.gameTimeUtc = v;
  }

  if (meta.savedAt == null) meta.savedAt = savedAtFromFileName(fileName);
  if (!meta.lapTimesHeader.length && meta.beacons.length) {
    let prev = 0;
    meta.lapTimesHeader = meta.beacons.map((b) => {
      const d = b - prev;
      prev = b;
      return d;
    });
  }
  return { meta, headerLine, unitLine, dataLine, names, units, timeCol, firstRow };
}

function applyMeta(meta: SessionMeta, key: string, value: string, cells: string[]) {
  const k = key.trim();
  switch (k.toLowerCase()) {
    case 'format':
      meta.format = value || meta.format;
      break;
    case 'venue':
      meta.venue = value;
      break;
    case 'vehicle':
      meta.vehicle = value;
      break;
    case 'driver':
      meta.driver = value;
      break;
    case 'log date':
      meta.logDate = value;
      break;
    case 'log time':
      meta.logTime = value;
      break;
    case 'sample rate':
      meta.sampleRate = Number(value) || 0;
      break;
    case 'duration':
      meta.duration = Number(value) || 0;
      break;
    case 'laps':
      meta.lapCountHeader = Number(value) || null;
      break;
    case 'laptimes': {
      meta.lapTimesHeader = value
        .split(/[,\s;]+/)
        .map(Number)
        .filter((x) => Number.isFinite(x) && x > 0);
      let acc = 0;
      meta.beacons = meta.lapTimesHeader.map((t) => (acc += t));
      break;
    }
    case 'beacon markers': {
      const raw = [value, ...cells.slice(2)].join(' ');
      meta.beacons = raw
        .split(/[,\s;]+/)
        .map(Number)
        .filter((x) => Number.isFinite(x) && x > 0)
        .sort((a, b) => a - b);
      break;
    }
    default:
      if (k) meta.extra[k] = value;
  }
  if (meta.logDate && meta.logTime) meta.savedAt = parseLogDateTime(meta.logDate, meta.logTime);
}

/** Split the first chunk of a file into lines (dropping an incomplete last line if truncated). */
export function headLines(text: string, truncated: boolean): string[] {
  const lines = text.split(/\r?\n/);
  if (truncated) lines.pop();
  return lines;
}
