// Tyre wear model: matches the game's rubber wear on the bundled session, splits into causes cleanly,
// and the shipped math channels compute the same thing.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseTelemetryCsv } from '../src/core/csvParser';
import { buildSession } from '../src/core/session';
import { applyMathChannels } from '../src/core/math/evaluate';
import { lapWear, TYRES } from '../src/core/tyreWear';
import { DEFAULT_MATH_CHANNELS } from '../src/state/defaultMath';
import { allTyreWearSheets } from '../src/state/tyreWearSheets';
import { tyreDegSheets } from '../src/state/tyreDegWorkspace';
import { gameFactor } from '../src/charts/wearShared';

const dir = path.join(__dirname, '..', 'sample-data');
const file = fs.readdirSync(dir).find((f) => f.endsWith('.csv'))!;
const buf = fs.readFileSync(path.join(dir, file));
const s = buildSession(parseTelemetryCsv(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, file), { path: file, fileName: file, size: 0, mtime: 0 });
const laps = s.laps.filter((l) => l.complete);

function pearson(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return n / Math.sqrt(da * db);
}

describe('tyre wear model', () => {
  it('tracks the grip the game takes off, lap by lap and tyre by tyre', () => {
    const model: number[] = [];
    const game: number[] = [];
    for (const lap of laps)
      for (const t of TYRES) {
        const w = lapWear(s, lap, t)!;
        model.push(w.total.total);
        game.push(w.gameGripLoss);
      }
    expect(model.length).toBeGreaterThan(8);
    expect(pearson(model, game)).toBeGreaterThan(0.9);
  });

  it('splits every metre into lock-up, wheelspin or slide', () => {
    const w = lapWear(s, laps[0], 'RL')!;
    expect(w.total.total).toBeGreaterThan(0);
    expect(w.total.lock + w.total.spin + w.total.slide).toBeCloseTo(w.total.total, 6);
    expect(w.total.spin).toBeGreaterThan(w.total.lock); // a driven rear wheel spins more than it locks
  });

  it('segments add up to the lap', () => {
    const L = laps[0].length;
    const edges = Array.from({ length: Math.ceil(L / 200) + 1 }, (_, i) => Math.min(i * 200, L + 1));
    const w = lapWear(s, laps[0], 'FL', edges)!;
    const sum = w.segments.reduce((a, g) => a + g.total, 0);
    expect(sum / w.total.total).toBeGreaterThan(0.98);
    expect(sum / w.total.total).toBeLessThan(1.0001);
  });

  it('the Tyre Wear math channels agree with the model', () => {
    const res = applyMathChannels(s, DEFAULT_MATH_CHANNELS, []);
    for (const t of TYRES) {
      expect(res.errors[`Tyre Wear Lap ${t}`]).toBeUndefined();
      expect(res.errors[`Tyre Wear Rate ${t}`]).toBeUndefined();
      const ch = s.channels.get(`Tyre Wear Lap ${t}`)!;
      const lap = laps[1];
      const end = ch.data[Math.floor((lap.end - ch.t0) * ch.rate) - 1];
      expect(end / lapWear(s, lap, t)!.total.total).toBeGreaterThan(0.97);
      expect(end / lapWear(s, lap, t)!.total.total).toBeLessThan(1.03);
      const rate = s.channels.get(`Tyre Wear Rate ${t}`)!;
      expect(rate.min).toBeGreaterThanOrEqual(0);
      expect(rate.max).toBeLessThanOrEqual(100);
    }
  });

  it('the cause channels add up to the wear rate and split it like the model', () => {
    applyMathChannels(s, DEFAULT_MATH_CHANNELS, []);
    const mean = (n: string, lap: (typeof laps)[number]) => {
      const ch = s.channels.get(n)!;
      let sum = 0;
      let k = 0;
      for (let i = Math.ceil((lap.start - ch.t0) * ch.rate); i < (lap.end - ch.t0) * ch.rate; i++) (sum += ch.data[i]), k++;
      return sum / k;
    };
    const lap = laps[1];
    for (const t of TYRES) {
      const total = mean(`Tyre Wear Rate ${t}`, lap);
      const parts = ['Lock-up', 'Wheelspin', 'Slide'].map((c) => mean(`Tyre Wear ${c} ${t}`, lap));
      expect(parts.reduce((a, b) => a + b, 0) / total).toBeGreaterThan(0.97);
      expect(parts.reduce((a, b) => a + b, 0) / total).toBeLessThan(1.01);
      const w = lapWear(s, lap, t)!.total;
      expect(Math.abs(parts[2] / total - w.slide / w.total)).toBeLessThan(0.03);
    }
  });

  it('every channel the tyre-wear worksheets use exists (logged or default math)', () => {
    const known = new Set([...s.channels.keys(), ...DEFAULT_MATH_CHANNELS.map((m) => m.name)]);
    const used = new Set<string>();
    for (const sh of [...allTyreWearSheets(), ...tyreDegSheets()])
      for (const c of Object.values(sh.components) as any[]) {
        for (const p of c.panes ?? []) for (const n of p.channels) used.add(n);
        if (c.type === 'trackmap' && c.colorBy !== 'lap' && c.colorBy !== 'delta') used.add(c.colorBy);
        if (c.type === 'trend' && c.channel) used.add(c.channel);
      }
    expect([...used].filter((n) => !known.has(n))).toEqual([]);
  });

  it("measures the game's wear factor for the session", () => {
    const f = gameFactor(s)!;
    expect(f).not.toBeNull();
    expect(f.compound).toBe(2);
    expect(f.multiplier!).toBeGreaterThan(1.7); // the bundled Singapore session ran a 2x wear rate
    expect(f.multiplier!).toBeLessThan(2.3);
  });
});
