// Optimum corners: each corner's best time across the eligible laps against the fastest of them.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseLd } from '../src/core/ldParser';
import { buildSession, crossingTime } from '../src/core/session';
import { applyChannelMasters, DEFAULT_CHANNEL_MASTERS } from '../src/core/channelMasters';
import { DEFAULT_CORNER_SETTINGS } from '../src/core/corners';
import { computeVariance, varianceAt } from '../src/core/axis';
import { optimumCorners } from '../src/core/optimum';
import { realLog } from './realLogs';

describe('optimum corners', () => {
  // A 1000 m track with two corners (T1 in the first half, T2 in the second). Lap A (90 s) is quicker
  // through T1, lap B (95 s) through T2; lap C is incomplete and must be ignored even though it's "fast".
  const lap = (index: number, start: number, half1: number, half2: number, complete = true) => ({
    index,
    number: index + 1,
    start,
    end: start + half1 + half2,
    time: half1 + half2,
    complete,
    kind: 'flying',
    invalid: false,
    sectors: [],
    distT: Float64Array.from([start, start + half1, start + half1 + half2]),
    distD: Float64Array.from([0, 500, 1000]),
  });
  const A = lap(0, 0, 40, 50);
  const B = lap(1, 100, 50, 45);
  const C = lap(2, 200, 30, 30, false);
  const speed = { name: 'Ground Speed', unit: 'kph', rate: 10, t0: 0, n: 3000, data: new Float32Array(3000).fill(100), discrete: false };
  const s = { channels: new Map([['Ground Speed', speed]]), key: { speed: 'Ground Speed' }, trackLength: 1000, laps: [A, B, C] } as any;
  const el = [A, B, C].map((l) => ({ key: String(l.index), session: s, lap: l as any }));
  const corners = [
    { name: 'T1', dist: 250 },
    { name: 'T2', dist: 750 },
  ];

  it('takes the fastest complete lap as the reference and the best lap per corner', () => {
    const o = optimumCorners(el, corners, DEFAULT_CORNER_SETTINGS)!;
    expect(o.ref.lap).toBe(A);
    expect(o.laps.map((l) => l.lap)).toEqual([A, B]); // the incomplete lap isn't eligible
    const [t1, t2] = o.corners;
    expect(t1.best!.lap).toBe(A);
    expect(t1.gain).toBe(0);
    expect(t2.best!.lap).toBe(B);
    // No throttle channel, so each corner is its apex ± 200 m: T2 is 400 of the second half's 500 m,
    // which takes A 40 s and B 36 s.
    expect(t2.gain).toBeCloseTo(4, 6);
    expect(o.total).toBeCloseTo(4, 6);
  });

  it('gives a tie to the reference', () => {
    const D = lap(3, 300, 40, 50);
    const o = optimumCorners([...el, { key: '3', session: s, lap: D as any }], corners, DEFAULT_CORNER_SETTINGS)!;
    expect(o.corners[0].best!.lap).toBe(A);
  });

  it('is null without complete laps or corners', () => {
    expect(optimumCorners([el[2]], corners, DEFAULT_CORNER_SETTINGS)).toBeNull();
    expect(optimumCorners(el, [], DEFAULT_CORNER_SETTINGS)).toBeNull();
  });

  // Tyler's COTA stint of 28/10: each corner's gain matches the time variance between the laps across it.
  const p = realLog('28102026-213602-Lewis Hamilton-vrc_formula_alpha_2026_csp-cota_2022-layout_f1_2024.ld', 'Tyler/COTA');
  it.skipIf(!fs.existsSync(p))('agrees with the time variance on a real stint', () => {
    const b = fs.readFileSync(p);
    const real = buildSession(parseLd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, path.basename(p), fs.readFileSync(p.replace(/\.ld$/, '.ldx'), 'utf8')), {
      path: p,
      fileName: path.basename(p),
      size: 0,
      mtime: 0,
    });
    applyChannelMasters(real, DEFAULT_CHANNEL_MASTERS);
    const cota = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'default-tracks', 'cota_2022-layout_f1_2024.json'), 'utf8')).corners;
    const laps = real.laps.filter((l) => l.complete).map((l) => ({ key: String(l.index), session: real, lap: l }));
    const o = optimumCorners(laps, cota, DEFAULT_CORNER_SETTINGS)!;
    expect(o.ref.lap.time).toBe(Math.min(...laps.map((l) => l.lap.time)));
    let sum = 0;
    for (const c of o.corners) {
      expect(c.gain).toBeGreaterThanOrEqual(0);
      sum += c.gain;
      const v = computeVariance(o.ref.lap, c.best!.lap);
      const dv = varianceAt(v, c.seg.exit, 'distance') - varianceAt(v, c.seg.entry, 'distance');
      expect(Math.abs(c.gain + dv)).toBeLessThan(0.002);
      expect(c.bestM!.time).toBeCloseTo(crossingTime(c.best!.lap, c.seg.exit) - crossingTime(c.best!.lap, c.seg.entry), 6);
    }
    expect(o.total).toBeCloseTo(sum, 9);
    expect(o.total).toBeGreaterThan(0);
  });
});
