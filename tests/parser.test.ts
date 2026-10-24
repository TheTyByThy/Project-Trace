import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseTelemetryCsv } from '../src/core/csvParser';
import { buildSession, fastestLap, theoreticalBest } from '../src/core/session';
import { parseHeader } from '../src/core/header';

const dir = path.join(__dirname, '..', 'sample-data');
const file = fs.readdirSync(dir).find((f) => f.endsWith('.csv'))!;
const full = path.join(dir, file);

describe('Telemetrick sample file', () => {
  const buf = fs.readFileSync(full);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const t0 = performance.now();
  const parsed = parseTelemetryCsv(ab as ArrayBuffer, file);
  const parseMs = performance.now() - t0;
  const s = buildSession(parsed, { path: full, fileName: file, size: buf.length, mtime: 0 });

  it('parses header metadata', () => {
    expect(parsed.meta.format).toBe('AC pyTelemetry CSV');
    expect(parsed.meta.venue).toBe('singapore_2020-layout_f1_2026');
    expect(parsed.meta.vehicle).toBe('vrc_formula_alpha_2026_csp');
    expect(parsed.meta.driver).toBe('Lewis Hamilton');
    expect(parsed.meta.lapTimesHeader).toEqual([117.9, 103.122, 102.708, 102.068, 101.424]);
    expect(parsed.meta.details['Vehicle Wheelbase'].value).toBe('3.4');
    expect(parsed.meta.details['Vehicle Wheelbase'].unit).toBe('m');
    expect(parsed.meta.setup['Front ARB'].value).toBe('72500');
    expect(parsed.meta.setup['Front ARB'].unit).toBe('N/m');
    expect(parsed.meta.gameTimeUtc).toBe(1792839687);
    console.log(`parse time ${parseMs.toFixed(0)} ms, ${parsed.channels.length} channels`);
  });

  it('stores channels at native rates', () => {
    const rate = (n: string) => parsed.channels.find((c) => c.name === n)!.rate;
    expect(rate('Steering Torque')).toBe(150);
    expect(rate('Ground Speed')).toBe(30);
    expect(rate('Tire Pressure FL')).toBe(10);
    expect(rate('Fuel Level')).toBe(1);
    const utc = parsed.channels.find((c) => c.name === 'UTC Time')!;
    expect(utc.data).toBeInstanceOf(Float64Array);
    expect(parsed.channels.length).toBe(186);
  });

  it('detects laps from beacons with official times', () => {
    expect(s.laps.length).toBe(6);
    expect(s.laps[0].kind).toBe('out');
    expect(s.laps[5].complete).toBe(false);
    expect(s.laps[1].time).toBeCloseTo(103.122, 3);
    expect(fastestLap(s)!.number).toBe(5);
    expect(fastestLap(s)!.time).toBeCloseTo(101.424, 3);
    console.log('laps', s.laps.map((l) => `${l.number}:${l.kind}:${l.time.toFixed(3)}:${l.invalid ? 'INV' : 'ok'}:${l.length.toFixed(0)}m`).join(' '));
  });

  it('reconstructs exact sector times and split distances', () => {
    expect(s.sectorSplits.length).toBe(2);
    expect(s.laps[1].sectors[0]).toBeCloseTo(32.008, 3);
    expect(s.laps[1].sectors[1]).toBeCloseTo(42.759, 3);
    expect(s.laps[1].sectors[2]).toBeCloseTo(28.355, 3);
    console.log('splits', s.sectorSplits.map((x) => x.toFixed(1)), 'track length', s.trackLength.toFixed(1));
    console.log('out-lap sectors', s.laps[0].sectors.map((x) => x.toFixed(3)));
    console.log('theoretical best', theoreticalBest(s));
  });

  it('builds monotonic lap distance', () => {
    for (const lap of s.laps) {
      for (let i = 1; i < lap.distD.length; i++) expect(lap.distD[i]).toBeGreaterThanOrEqual(lap.distD[i - 1]);
    }
    const l = s.laps[1];
    expect(l.distD[0]).toBe(0);
    expect(l.distD[l.distD.length - 1]).toBeGreaterThan(4800);
  });

  it('parses header from a partial head chunk', () => {
    const head = buf.subarray(0, 65536).toString('utf8').split(/\r?\n/);
    head.pop();
    const h = parseHeader(head, file)!;
    expect(h.names[0]).toBe('time');
    expect(h.firstRow).not.toBeNull();
    expect(h.meta.gameTimeUtc).toBe(1792839687);
  });
});

describe('generic and MoTeC CSV', () => {
  it('parses a simple generic CSV with a unit row', () => {
    const csv = 'Time,Speed,RPM\ns,km/h,rpm\n0,10,3000\n0.1,11,3100\n0.2,12,3200\n0.3,13,3300\n';
    const enc = new TextEncoder().encode(csv);
    const p = parseTelemetryCsv(enc.buffer as ArrayBuffer, 'x.csv');
    expect(p.channels.map((c) => c.name)).toEqual(['Speed', 'RPM']);
    expect(p.channels[0].unit).toBe('km/h');
    expect(p.channels[0].rate).toBe(10);
  });

  it('parses a MoTeC-style quoted header with beacons', () => {
    const csv = [
      '"Format","MoTeC CSV File","","","Workbook","Default"',
      '"Venue","Calder","","","Worksheet","Driver"',
      '"Vehicle","Car","","","Vehicle Desc",""',
      '"Driver","Me","","","Engine ID",""',
      '"Log Date","19/02/2014","","","Origin Time","0.000","s"',
      '"Log Time","12:34:56","","","Start Time","0.000","s"',
      '"Sample Rate","10","Hz","","End Time","0.500","s"',
      '"Duration","0.5","s","","Start Distance","0","m"',
      '"Beacon Markers","0.25"',
      '',
      '"Time","Ground Speed","Lap Number"',
      '"s","km/h",""',
      '',
      '"0.0","100","0"',
      '"0.1","101","0"',
      '"0.2","102","0"',
      '"0.3","103","1"',
      '"0.4","104","1"',
      '"0.5","105","1"',
    ].join('\n');
    const enc = new TextEncoder().encode(csv);
    const p = parseTelemetryCsv(enc.buffer as ArrayBuffer, 'm.csv');
    expect(p.meta.format).toBe('MoTeC CSV File');
    expect(p.meta.venue).toBe('Calder');
    expect(p.meta.beacons).toEqual([0.25]);
    expect(p.channels.length).toBe(2);
    expect(p.channels[0].data[5]).toBe(105);
  });
});
