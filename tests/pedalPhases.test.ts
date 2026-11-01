// Pedal phases: every moment of the lap in exactly one of braking / full throttle / part throttle / rolling.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseLd } from '../src/core/ldParser';
import { buildSession } from '../src/core/session';
import { applyChannelMasters, DEFAULT_CHANNEL_MASTERS } from '../src/core/channelMasters';
import { lapPhases } from '../src/core/pedalPhases';

// The synthetic channels are 10 Hz and interpolated, so each pedal change is spread over one sample (0.1 s).
const near = (v: number, want: number) => expect(Math.abs(v - want)).toBeLessThan(0.15);
const ch = (name: string, unit: string, values: number[], rate = 10) => ({ name, unit, rate, t0: 0, data: Float32Array.from(values), n: values.length, discrete: false });

describe('pedal phases', () => {
  // 10 s at 10 Hz: 3 s full throttle, 2 s braking with a downshift blip, 1 s rolling, 4 s part throttle; 36 km/h throughout.
  const thr = [...Array(30).fill(100), 0, 40, 40, 0, ...Array(16).fill(0), ...Array(10).fill(0), ...Array(40).fill(50)];
  const brk = [...Array(30).fill(0), ...Array(20).fill(80), ...Array(10).fill(1), ...Array(40).fill(0)];
  const s = {
    channels: new Map([
      ['Throttle Pos', ch('Throttle Pos', '%', thr)],
      ['Brake Pos', ch('Brake Pos', '%', brk)],
      ['Ground Speed', ch('Ground Speed', 'kph', Array(100).fill(36))],
    ]),
    key: { speed: 'Ground Speed' },
  } as any;
  const lap = { index: 0, start: 0, end: 10 } as any;

  it('splits the lap into four phases that add up to it, braking first', () => {
    const r = lapPhases(s, lap)!;
    near(r.time.full, 3);
    near(r.time.braking, 2); // the blip while braking stays braking
    near(r.time.rolling, 1); // a resting foot (1% brake) is not braking
    near(r.time.part, 4);
    expect(r.time.braking + r.time.full + r.time.part + r.time.rolling).toBeCloseTo(10, 6);
    near(r.dist.full / 10, 3); // 10 m/s for 3 s
  });

  it('reads 0–1 pedal fractions as %', () => {
    const f = {
      ...s,
      channels: new Map([...s.channels, ['Throttle Pos', ch('Throttle Pos', '', thr.map((v) => v / 100))], ['Brake Pos', ch('Brake Pos', '', brk.map((v) => v / 100))]]),
    };
    near(lapPhases(f, lap)!.time.full, 3);
  });

  // A real lap: Tyler's COTA stint of 28/10.
  const p = path.join(__dirname, '..', 'myTelemData', 'Tyler', 'COTA', '28102026-213602-Lewis Hamilton-vrc_formula_alpha_2026_csp-cota_2022-layout_f1_2024.ld');
  it.skipIf(!fs.existsSync(p))('adds up to each real lap time', () => {
    const b = fs.readFileSync(p);
    const real = buildSession(parseLd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, path.basename(p), fs.readFileSync(p.replace(/\.ld$/, '.ldx'), 'utf8')), {
      path: p,
      fileName: path.basename(p),
      size: 0,
      mtime: 0,
    });
    applyChannelMasters(real, DEFAULT_CHANNEL_MASTERS);
    for (const l of real.laps.filter((l) => l.complete)) {
      const r = lapPhases(real, l)!;
      expect(Math.abs(r.time.braking + r.time.full + r.time.part + r.time.rolling - l.time)).toBeLessThan(0.002);
      expect(r.time.full / l.time).toBeGreaterThan(0.4); // about half of a COTA lap is flat out
      expect(r.time.braking / l.time).toBeGreaterThan(0.15);
    }
  });
});
