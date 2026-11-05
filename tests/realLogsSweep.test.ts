// Every feature over every log in PT_TEST_LOGS (see realLogs.ts), through the shipped default masters and
// built-in workspaces, as a fresh install would read them. Skips when no logs are given.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseLd } from '../src/core/ldParser';
import { buildSession, fastestLap, theoreticalBest } from '../src/core/session';
import { applyChannelMasters, DEFAULT_CHANNEL_MASTERS, masterSources } from '../src/core/channelMasters';
import { applyMathChannels } from '../src/core/math/evaluate';
import { lapPhases } from '../src/core/pedalPhases';
import { optimumCorners } from '../src/core/optimum';
import { computeVariance, varianceAt } from '../src/core/axis';
import { bucketTimes, DEFAULT_CORNER_SETTINGS, lapBuckets, type TrackCorner } from '../src/core/corners';
import { lapWear, TYRES } from '../src/core/tyreWear';
import { sessionCompounds } from '../src/core/compound';
import { allRealLogs } from './realLogs';

const root = path.join(__dirname, '..');
const workspaces = fs.readdirSync(path.join(root, 'default-workspaces')).filter((f) => f.endsWith('.json'));
const logs = allRealLogs();

function load(p: string) {
  const b = fs.readFileSync(p);
  const s = buildSession(parseLd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, path.basename(p), fs.readFileSync(p + 'x', 'utf8')), { path: p, fileName: path.basename(p), size: 0, mtime: 0 });
  applyChannelMasters(s, DEFAULT_CHANNEL_MASTERS);
  return s;
}

const tracks = fs.readdirSync(path.join(root, 'default-tracks')).map((f) => JSON.parse(fs.readFileSync(path.join(root, 'default-tracks', f), 'utf8')));
const cornersFor = (venue: string): TrackCorner[] => tracks.find((t) => t.venue === venue)?.corners ?? [];

/** Every channel name a worksheet refers to. */
function channelsUsed(o: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(o)) o.forEach((x) => channelsUsed(x, out));
  else if (o && typeof o === 'object')
    for (const [k, v] of Object.entries(o)) {
      if (k === 'channels' && Array.isArray(v)) v.forEach((x) => typeof x === 'string' && out.add(x));
      else if (k === 'channel' && typeof v === 'string' && v) out.add(v);
      else channelsUsed(v, out);
    }
  return out;
}

describe.skipIf(!logs.length)('every feature on real logs', () => {
  describe.each(logs.map((p) => [path.basename(p).slice(0, 34), p]))('%s', (_name, p) => {
    const s = load(p);
    const complete = s.laps.filter((l) => l.complete);

    it('reads its laps and sectors', () => {
      expect(complete.length).toBeGreaterThan(0);
      for (const l of complete) {
        expect(l.time).toBeGreaterThan(30);
        if (l.sectors.length && l.sectors.every((v) => v > 0)) expect(Math.abs(l.sectors.reduce((a, b) => a + b, 0) - l.time)).toBeLessThan(0.05);
      }
      expect(fastestLap(s, false)).toBeTruthy();
      expect(sessionCompounds(s).length).toBeGreaterThan(0);
    });

    it('has every driver input under its shipped name', () => {
      for (const n of ['Throttle Pos', 'Throttle Pedal', 'Throttle Raw', 'Brake Pos', 'Steering Angle', 'Clutch Pos', 'Ground Speed', 'Gear', 'Engine RPM']) {
        expect(masterSources(s)[n], n).toBeTruthy();
        expect(s.channels.has(n), n).toBe(true);
      }
    });

    it.each(workspaces)('%s: math channels work, and only car-script channels can be missing', (w) => {
      const ws = JSON.parse(fs.readFileSync(path.join(root, 'default-workspaces', w), 'utf8'));
      const res = applyMathChannels(s, ws.math, ws.constants ?? []);
      // Math built on a car-script channel can't run on a log without them; everything else must.
      const carScript = new Set(DEFAULT_CHANNEL_MASTERS.filter((m) => m.sources.length === 2).map((m) => m.name));
      const failed = Object.entries(res.errors).filter(([, e]) => ![...carScript].some((c) => String(e).includes(`'${c}'`)));
      expect(failed).toEqual([]);
      const missing = [...channelsUsed(ws.worksheets)].filter((n) => !s.channels.has(n) && !carScript.has(n) && !res.errors[n]);
      expect(missing).toEqual([]);
    });

    it('wear reads on all four tyres', () => {
      for (const l of complete)
        for (const t of TYRES) {
          const w = lapWear(s, l, t)!;
          expect(w.total.total, `L${l.number} ${t}`).toBeGreaterThan(50);
          expect(w.gameGripLoss, `L${l.number} ${t}`).toBeGreaterThan(0);
          expect(Math.abs(w.total.lock + w.total.spin + w.total.slide - w.total.total)).toBeLessThan(1e-6);
        }
    });

    it('pedal phases add up to each lap', () => {
      for (const l of complete) {
        const r = lapPhases(s, l)!;
        expect(Math.abs(r.time.braking + r.time.full + r.time.part + r.time.rolling - l.time)).toBeLessThan(0.002);
        expect(r.time.full).toBeGreaterThan(0);
        expect(r.time.braking).toBeGreaterThan(0);
      }
    });

    const corners = cornersFor(s.meta.venue);
    it.skipIf(!corners.length)('corner ranges stay in order, and buckets add up to the lap', () => {
      const ref = fastestLap(s, false)!;
      const segs = lapBuckets({ session: s, lap: ref, settings: DEFAULT_CORNER_SETTINGS }, corners);
      for (let i = 1; i < segs.length; i++) expect(segs[i].entry).toBeGreaterThanOrEqual(segs[i - 1].exit - 1e-6);
      const b = bucketTimes(s, ref, segs);
      expect(Math.abs(b.low + b.medium + b.high + b.straight - ref.time)).toBeLessThan(0.02);
    });

    it.skipIf(!corners.length)('optimum corners agree with the time variance', () => {
      const o = optimumCorners(complete.map((l) => ({ key: String(l.index), session: s, lap: l })), corners, DEFAULT_CORNER_SETTINGS)!;
      expect(o.ref.lap).toBe(fastestLap(s, false));
      for (const c of o.corners) {
        expect(c.gain).toBeGreaterThanOrEqual(0);
        const v = computeVariance(o.ref.lap, c.best!.lap);
        expect(Math.abs(c.gain + varianceAt(v, c.seg.exit, 'distance') - varianceAt(v, c.seg.entry, 'distance'))).toBeLessThan(0.002);
      }
    });

    it('has an ideal lap no slower than its best', () => {
      const ideal = theoreticalBest(s);
      if (ideal) expect(ideal.time).toBeLessThanOrEqual(fastestLap(s, false)!.time + 0.05);
    });
  });
});
