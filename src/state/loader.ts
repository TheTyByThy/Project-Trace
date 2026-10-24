// File loading: read bytes via the bridge, parse in a worker, build the Session.
// Also produces lightweight header summaries for the session browser.

import { baseName, pt, type DirFile } from '../core/bridge';
import { headLines, parseHeader, parseLogDateTime, savedAtFromFileName } from '../core/header';
import { ldSample, parseLdx, readLdChannels, readLdHeader } from '../core/ldParser';
import { buildSession } from '../core/session';
import type { ParsedFile, Session } from '../core/types';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (p: ParsedFile) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/parse.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent) => {
    const { id, progress, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (progress != null) p.onProgress?.(progress);
    else if (error) {
      pending.delete(id);
      p.reject(new Error(error));
    } else if (result) {
      pending.delete(id);
      p.resolve(result as ParsedFile);
    }
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Parser worker crashed'));
    pending.clear();
    worker = null;
  };
  return worker;
}

export const isLd = (p: string) => /\.ld$/i.test(p);
export const ldxPathFor = (p: string) => p.replace(/\.ld$/i, '.ldx');

export function parseInWorker(
  buffer: ArrayBuffer,
  fileName: string,
  onProgress?: (p: number) => void,
  ld?: { ldx?: string },
): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, buffer, fileName, kind: ld ? 'ld' : 'csv', ldx: ld?.ldx }, [buffer]);
  });
}

async function readText(path: string): Promise<string | undefined> {
  if (!(await pt().exists(path))) return undefined;
  return new TextDecoder('utf-8').decode(await pt().readFile(path));
}

export async function loadSessionFile(path: string, onProgress?: (p: number) => void): Promise<Session> {
  const [buffer, stat] = await Promise.all([pt().readFile(path), pt().stat(path)]);
  const fileName = baseName(path);
  const ld = isLd(path) ? { ldx: await readText(ldxPathFor(path)) } : undefined;
  const parsed = await parseInWorker(buffer, fileName, onProgress, ld);
  return buildSession(parsed, { path, fileName, size: stat?.size ?? 0, mtime: stat?.mtime ?? 0 });
}

// ---------------------------------------------------------------------------------------------
// Session browser summaries (header-only, ~64 KB read per file)
// ---------------------------------------------------------------------------------------------

export interface SessionSummary {
  path: string;
  fileName: string;
  size: number;
  mtime: number;
  ok: boolean;
  error?: string;
  format: string;
  venue: string;
  vehicle: string;
  driver: string;
  team: string;
  savedAt: number | null;
  gameTimeUtc: number | null;
  duration: number;
  lapCount: number;
  completeLaps: number;
  bestLap: number | null;
  bestLapNumber: number | null;
  lapTimes: number[];
  airTemp: number | null;
  roadTemp: number | null;
  fuelStart: number | null;
  sky: string;
}

const summaryCache = new Map<string, SessionSummary>();

export async function summarizeFile(f: DirFile): Promise<SessionSummary> {
  const key = `${f.path}|${f.size}|${f.mtime}`;
  const hit = summaryCache.get(key);
  if (hit) return hit;
  const base: SessionSummary = {
    path: f.path,
    fileName: f.name,
    size: f.size,
    mtime: f.mtime,
    ok: false,
    format: '',
    venue: '',
    vehicle: '',
    driver: '',
    team: '',
    savedAt: null,
    gameTimeUtc: null,
    duration: 0,
    lapCount: 0,
    completeLaps: 0,
    bestLap: null,
    bestLapNumber: null,
    lapTimes: [],
    airTemp: null,
    roadTemp: null,
    fuelStart: null,
    sky: '',
  };
  try {
    if (isLd(f.path)) {
      Object.assign(base, await summarizeLd(f));
      summaryCache.set(key, base);
      return base;
    }
    const head = await pt().readHead(f.path, 96 * 1024);
    const text = new TextDecoder('utf-8').decode(head);
    const lines = headLines(text, head.byteLength < f.size);
    const h = parseHeader(lines, f.name);
    if (!h) throw new Error('No channel header found');
    const m = h.meta;
    const col = (re: RegExp) => h.names.findIndex((n) => re.test(n));
    const firstNum = (re: RegExp) => {
      const i = col(re);
      const v = i >= 0 && h.firstRow ? Number(h.firstRow[i]) : NaN;
      return Number.isFinite(v) && h.firstRow?.[i] !== '' ? v : null;
    };
    // Did logging start on the line? If not, the first lapTimes entry is a partial (out) lap.
    const lapTime0 = firstNum(/^lap time$/i);
    const startsOnLine = lapTime0 != null && lapTime0 < 1.5;
    const laps = m.lapTimesHeader;
    let best: number | null = null;
    let bestN: number | null = null;
    laps.forEach((t, i) => {
      if (i === 0 && !startsOnLine) return;
      if (best == null || t < best) {
        best = t;
        bestN = i + 1;
      }
    });
    const complete = Math.max(0, laps.length - (startsOnLine ? 0 : 1));
    Object.assign(base, {
      ok: true,
      format: m.format,
      venue: m.venue,
      vehicle: m.vehicle,
      driver: m.driver,
      team: m.details['Team']?.value ?? '',
      savedAt: m.savedAt ?? f.mtime,
      gameTimeUtc: m.gameTimeUtc,
      duration: m.duration,
      lapCount: m.lapCountHeader ?? laps.length,
      completeLaps: complete,
      bestLap: best,
      bestLapNumber: bestN,
      lapTimes: laps,
      airTemp: firstNum(/^air temp$/i),
      roadTemp: firstNum(/^(road|track) temp$/i),
      fuelStart: firstNum(/^fuel level$/i),
      sky: m.details['Sky']?.value ?? '',
    });
  } catch (e) {
    base.error = (e as Error).message;
    base.savedAt = f.mtime;
    base.venue = '';
  }
  summaryCache.set(key, base);
  return base;
}

/** Header-only summary of a MoTeC .ld (+ .ldx) pair. */
async function summarizeLd(f: DirFile): Promise<Partial<SessionSummary>> {
  const head = new Uint8Array(await pt().readHead(f.path, 96 * 1024));
  const h = readLdHeader(head);
  if (!h) throw new Error('Not a MoTeC .ld file');
  // In-game clock: first sample of the "UTC Time" channel.
  let gameTimeUtc: number | null = null;
  let duration = 0;
  const chans = readLdChannels(head, h.metaPtr);
  for (const c of chans) if (c.rate) duration = Math.max(duration, (c.n - 1) / c.rate);
  const utc = chans.find((c) => /^utc time$/i.test(c.name));
  if (utc) {
    const bytes = await pt().readRange(f.path, utc.dataPtr, 8);
    if (bytes.byteLength >= 4) {
      const v = ldSample(new DataView(bytes), { ...utc, dataPtr: 0 }, 0);
      if (v > 1e8) gameTimeUtc = v;
    }
  }
  let lapTimes: number[] = [];
  let team = '';
  let sky = '';
  let air: number | null = null;
  let road: number | null = null;
  const ldxPath = ldxPathFor(f.path);
  if (await pt().exists(ldxPath)) {
    const x = parseLdx(new TextDecoder('utf-8').decode(await pt().readHead(ldxPath, 256 * 1024)));
    let prev = 0;
    lapTimes = x.beacons
      .filter((b) => !duration || b < duration)
      .map((b) => {
        const d = b - prev;
        prev = b;
        return d;
      });
    team = x.details['Team']?.value ?? '';
    sky = x.details['Sky']?.value ?? '';
    air = Number(x.details['Air Temp']?.value) || null;
    road = Number(x.details['Track Temp']?.value) || null;
  }
  // Telemetrick logs start mid-lap (the out lap), so the first beacon segment is partial.
  let best: number | null = null;
  let bestN: number | null = null;
  lapTimes.forEach((t, i) => {
    if (i === 0) return;
    if (best == null || t < best) {
      best = t;
      bestN = i + 1;
    }
  });
  return {
    ok: true,
    format: 'MoTeC .ld',
    venue: h.venue,
    vehicle: h.vehicle,
    driver: h.driver,
    team,
    savedAt: parseLogDateTime(h.date, h.time) ?? savedAtFromFileName(f.name) ?? f.mtime,
    gameTimeUtc,
    duration,
    lapCount: lapTimes.length ? lapTimes.length + 1 : 0,
    completeLaps: Math.max(0, lapTimes.length - 1),
    bestLap: best,
    bestLapNumber: bestN,
    lapTimes,
    airTemp: air,
    roadTemp: road,
    fuelStart: null,
    sky,
  };
}
