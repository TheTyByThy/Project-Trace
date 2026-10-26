// Best-fit curves recover known functions, and their equations read sensibly.
import { describe, expect, it } from 'vitest';
import { fitCurve, fitEquation, fitSettings } from '../src/core/fit';

const xs = Array.from({ length: 20 }, (_, i) => i + 1);
const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

describe('best-fit curves', () => {
  it('fits a line exactly', () => {
    const f = fitCurve(xs, xs.map((x) => 100 - 0.05 * x), 'linear')!;
    close(f.coef[1], -0.05);
    close(f.r2, 1);
    expect(fitEquation(f)).toBe('y = −0.05x + 100');
  });
  it('fits polynomials up to 4th order', () => {
    const f = fitCurve(xs, xs.map((x) => 2 + x - 0.5 * x * x + 0.01 * x ** 4), 'poly4')!;
    close(f.eval(7), 2 + 7 - 0.5 * 49 + 0.01 * 7 ** 4, 1e-5);
    expect(fitEquation(f)).toContain('x⁴');
  });
  it('fits exponential, logarithmic and power curves', () => {
    const e = fitCurve(xs, xs.map((x) => 3 * Math.exp(0.1 * x)), 'exponential')!;
    close(e.coef[0], 3);
    close(e.coef[1], 0.1);
    const l = fitCurve(xs, xs.map((x) => 5 + 2 * Math.log(x)), 'logarithmic')!;
    close(l.coef[1], 2);
    const p = fitCurve(xs, xs.map((x) => 4 * x ** 1.5), 'power')!;
    close(p.coef[1], 1.5);
    expect(fitEquation(e)).toBe('y = 3·e^(0.1x)');
  });
  it('refuses curves the data cannot take', () => {
    expect(fitCurve(xs, xs.map((x) => x - 10), 'exponential')).toBeNull();
    expect(fitCurve([-1, 0, 1], [1, 2, 3], 'logarithmic')).toBeNull();
    expect(fitCurve([1], [1], 'linear')).toBeNull();
  });
  it('reads older Scatter configs', () => {
    expect(fitSettings({ fit: 'none' })).toEqual({ on: false, kind: 'linear', equation: true });
    expect(fitSettings({ fit: 'poly2' })).toEqual({ on: true, kind: 'poly2', equation: true });
    expect(fitSettings({ fit: 'poly2', showFit: false }).on).toBe(false);
  });
});
