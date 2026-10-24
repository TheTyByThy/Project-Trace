import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseTelemetryCsv } from '../src/core/csvParser';
import { buildSession } from '../src/core/session';
import { parseExpression, MathError } from '../src/core/math/parse';
import { applyMathChannels, evaluateExpression } from '../src/core/math/evaluate';
import { DEFAULT_MATH_CHANNELS } from '../src/state/defaultMath';

const dir = path.join(__dirname, '..', 'sample-data');
const file = fs.readdirSync(dir).find((f) => f.endsWith('.csv'))!;
const buf = fs.readFileSync(path.join(dir, file));
const parsed = parseTelemetryCsv(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, file);
const s = buildSession(parsed, { path: file, fileName: file, size: 0, mtime: 0 });

describe('math parser', () => {
  it('respects precedence and associativity', () => {
    const r = evaluateExpression('2 + 3 * 4 ^ 2 ^ 0.5 - -1', s);
    expect(r.data[0]).toBeCloseTo(2 + 3 * Math.pow(4, Math.pow(2, 0.5)) + 1, 9);
  });
  it('supports logic words and ternary', () => {
    expect(evaluateExpression('1 and 0 or 1', s).data[0]).toBe(1);
    expect(evaluateExpression('not 1', s).data[0]).toBe(0);
    expect(evaluateExpression('3 > 2 ? 10 : 20', s).data[0]).toBe(10);
  });
  it('reports helpful errors with positions', () => {
    expect(() => parseExpression("'Ground Speed' * ")).toThrow(MathError);
    expect(() => evaluateExpression("'No Such Channel' * 2", s)).toThrow(/Unknown channel/);
    expect(() => evaluateExpression('Ground Speed', s)).toThrow(/quoted/);
    expect(() => evaluateExpression('sqrt(1, 2)', s)).toThrow(/argument/);
  });
});

describe('math evaluation on session data', () => {
  it('evaluates at the highest referenced rate with unit conversion', () => {
    const r = evaluateExpression("'Ground Speed' [m/s]", s);
    expect(r.rate).toBe(30);
    const kph = s.channels.get('Ground Speed')!;
    expect(r.data[1000]).toBeCloseTo(kph.data[1000] / 3.6, 4);
    const mixed = evaluateExpression("'Ground Speed' + 'Steering Torque' * 0", s);
    expect(mixed.rate).toBe(150);
  });
  it('derivative of a ramp is its slope', () => {
    const r = evaluateExpression('derivative(time() * 3)', s);
    expect(r.data[500]).toBeCloseTo(3, 6);
  });
  it('stat_max is constant per lap', () => {
    const r = evaluateExpression("stat_max('Ground Speed')", s);
    const lap = s.laps[2];
    const i = Math.floor((lap.start + 10) * r.rate);
    const j = Math.floor((lap.end - 10) * r.rate);
    expect(r.data[i]).toBe(r.data[j]);
    expect(r.data[i]).toBeGreaterThan(250);
  });
  it('applies all default math channels without errors', () => {
    const res = applyMathChannels(s, DEFAULT_MATH_CHANNELS, []);
    expect(res.errors).toEqual({});
    expect(res.computed.length).toBe(DEFAULT_MATH_CHANNELS.filter((d) => d.enabled).length);
    const g = s.channels.get('Combined G')!;
    expect(g.max).toBeGreaterThan(3);
  });
  it('detects circular references', () => {
    const res = applyMathChannels(
      s,
      [
        { id: 'a', name: 'A', expr: "'B' + 1", unit: '', enabled: true },
        { id: 'b', name: 'B', expr: "'A' + 1", unit: '', enabled: true },
      ],
      [],
    );
    expect(Object.keys(res.errors).length).toBeGreaterThan(0);
  });
});
