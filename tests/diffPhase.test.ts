// The FA26 V0.1 Toggles sheet's diff bar: the Diff Phase math channel picks Entry (1), Mid (2) or Exit / High speed (3).
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyMathChannels } from '../src/core/math/evaluate';

const ws = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'default-workspaces', 'FA26 V0.1.json'), 'utf8'));
const def = ws.math.find((m: any) => m.name === 'Diff Phase');
const ch = (name: string, unit: string, values: number[]) => ({ name, unit, rate: 10, t0: 0, data: Float32Array.from(values), n: values.length, discrete: false });

/** Diff Phase at each [speed in the given unit, longitudinal G] pair. */
function phases(cases: [number, number][], speedUnit = 'km/h') {
  const channels = new Map([
    ['Ground Speed', ch('Ground Speed', speedUnit, cases.map((c) => c[0]))],
    ['CG Accel Longitudinal', ch('CG Accel Longitudinal', 'G', cases.map((c) => c[1]))],
  ]);
  const s = { channels, channelOrder: [...channels.keys()], key: {}, laps: [], duration: cases.length / 10 } as any;
  const r = applyMathChannels(s, [def], []);
  expect(r.errors).toEqual({});
  return Array.from(s.channels.get('Diff Phase').data as Float32Array).slice(0, cases.length);
}

describe('Diff Phase', () => {
  it('follows the longitudinal G at or below 150 km/h', () => {
    expect(phases([[100, -2], [100, -0.5], [100, -0.49], [100, 0], [100, 0.5], [100, 0.51], [100, 2], [150, -1], [150, 0]])).toEqual([1, 1, 2, 2, 2, 3, 3, 1, 2]);
  });

  it('is on the exit / high speed setting above 150 km/h, whatever the G', () => {
    expect(phases([[151, -3], [151, -0.5], [151, 0], [151, 1], [300, -3], [300, 0]])).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it('reads 150 km/h whatever unit the speed is logged in', () => {
    expect(phases([[40, 0], [45, 0]], 'm/s')).toEqual([2, 3]); // 144 and 162 km/h
  });

  it('has a bar on the Toggles sheet in the diff colours, one row per phase', () => {
    const bars: any = Object.values(ws.worksheets.find((w: any) => w.name === 'Toggles').components).find((c: any) => c.type === 'bars');
    expect(bars.combined).toBe(true);
    expect(bars.rows.map((r: any) => [r.channel, r.op, r.value, r.color])).toEqual([
      ['Diff Phase', 'eq', 1, ws.channelProps['Diff Entry'].color],
      ['Diff Phase', 'eq', 2, ws.channelProps['Diff Mid'].color],
      ['Diff Phase', 'eq', 3, ws.channelProps['Diff Exit'].color],
    ]);
  });
});
