// Invalid laps are only marked: by default they count for the stint's bests like any other lap; a stint can
// leave them out (Session.invalidCounts = false).
import { describe, expect, it } from 'vitest';
import { fastestLap, lapCounts, theoreticalBest } from '../src/core/session';

const lap = (index: number, time: number, sectors: number[], invalid = false) => ({ index, number: index + 1, time, sectors, invalid, complete: true }) as any;

describe('invalid laps', () => {
  // Lap 2 is invalid but fastest overall and in S1; lap 1 is valid and best in S2.
  const laps = [lap(0, 80, [40, 40]), lap(1, 79, [38, 41], true), lap(2, 81, [40.5, 40.5])];
  const s = { laps, sectorSplits: [2000], invalidCounts: true } as any;

  it('count for bests by default (purple sector, best lap, ideal lap)', () => {
    expect(lapCounts(s, laps[1])).toBe(true);
    expect(fastestLap(s)?.number).toBe(2);
    expect(theoreticalBest(s)?.sectors).toEqual([38, 40]);
  });

  it('are left out when the stint excludes them', () => {
    const x = { ...s, invalidCounts: false };
    expect(lapCounts(x, laps[1])).toBe(false);
    expect(lapCounts(x, laps[0])).toBe(true);
    expect(fastestLap(x)?.number).toBe(1);
    expect(theoreticalBest(x)?.sectors).toEqual([40, 40]);
    // Still the fastest lap driven, when asked for regardless of validity.
    expect(fastestLap(x, false)?.number).toBe(2);
  });
});
