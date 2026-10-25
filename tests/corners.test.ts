// Corner ranges from the driving, speed buckets, and the lap split into four buckets (sample session).
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseTelemetryCsv } from '../src/core/csvParser';
import { buildSession, fastestLap } from '../src/core/session';
import { bucketTimes, cornerWindows, DEFAULT_CORNER_SETTINGS, lapBuckets, speedBucket, suggestCorners } from '../src/core/corners';

const dir = path.join(__dirname, '..', 'sample-data');
const file = fs.readdirSync(dir).find((f) => f.endsWith('.csv'))!;
const buf = fs.readFileSync(path.join(dir, file));
const s = buildSession(parseTelemetryCsv(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, file), {
  path: file,
  fileName: file,
  size: buf.length,
  mtime: 0,
});
const lap = fastestLap(s)!;
const corners = suggestCorners(s, lap);
const ctx = { session: s, lap, settings: DEFAULT_CORNER_SETTINGS };

describe('corner ranges and speed buckets', () => {
  it('detects a range around every apex, within halfway to the neighbours', () => {
    const ws = cornerWindows(corners, s.trackLength, ctx);
    expect(ws.length).toBe(corners.length);
    for (const w of ws) {
      expect(w.entry).toBeLessThanOrEqual(w.apex);
      expect(w.exit).toBeGreaterThanOrEqual(w.apex);
      expect(w.exit - w.entry).toBeLessThanOrEqual(800);
    }
  });

  it('padding widens the detected ranges', () => {
    const narrow = cornerWindows(corners, s.trackLength, { ...ctx, settings: { ...DEFAULT_CORNER_SETTINGS, before: 0, after: 0 } });
    const wide = cornerWindows(corners, s.trackLength, { ...ctx, settings: { ...DEFAULT_CORNER_SETTINGS, before: 60, after: 60 } });
    const span = (ws: typeof narrow) => ws.reduce((a, w) => a + (w.exit - w.entry), 0);
    expect(span(wide)).toBeGreaterThan(span(narrow));
  });

  it('buckets corners by minimum speed', () => {
    expect(speedBucket(80, DEFAULT_CORNER_SETTINGS)).toBe('low');
    expect(speedBucket(150, DEFAULT_CORNER_SETTINGS)).toBe('medium');
    expect(speedBucket(220, DEFAULT_CORNER_SETTINGS)).toBe('high');
  });

  it('the four buckets add up to the lap time', () => {
    const segs = lapBuckets(ctx, corners);
    const t = bucketTimes(s, lap, segs);
    const sum = t.low + t.medium + t.high + t.straight;
    expect(Math.abs(sum - lap.time)).toBeLessThan(0.1);
    expect(segs.some((g) => g.bucket === 'straight')).toBe(true);
  });
});

describe('corner radius math channel', () => {
  it('evaluates on the sample session to sensible radii', async () => {
    const { applyMathChannels } = await import('../src/core/math/evaluate');
    const { DEFAULT_MATH_CHANNELS } = await import('../src/state/defaultMath');
    const res = applyMathChannels(s, DEFAULT_MATH_CHANNELS.filter((d) => d.name === 'Corner Radius'), []);
    expect(res.errors['Corner Radius']).toBeUndefined();
    const ch = s.channels.get('Corner Radius')!;
    const vals = Array.from(ch.data).filter(Number.isFinite);
    expect(vals.length).toBeGreaterThan(100);
    const sorted = vals.sort((a, b) => a - b);
    // Tight corners tens of metres, never above the 2 km cap.
    expect(sorted[Math.floor(sorted.length * 0.05)]).toBeLessThan(100);
    expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(2000);
  });
});
