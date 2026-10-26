// Cross-checks the MoTeC .ld reader against the CSV export of the same Telemetrick session.
// Skips automatically when the .ld/.ldx pair isn't available on this machine.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseTelemetryCsv } from '../src/core/csvParser';
import { parseLd, parseLdx } from '../src/core/ldParser';
import { buildSession } from '../src/core/session';

const base = '24102026-152530-Lewis Hamilton-vrc_formula_alpha_2026_csp-singapore_2020-layout_f1_2026';
const ldDir = path.join(os.homedir(), 'Documents', 'Assetto Corsa', 'apps', 'telemetrick', 'exported', 'Lewis Hamilton', 'vrc_formula_alpha_2026_csp', 'singapore_2020-layout_f1_2026');
const ldPath = path.join(ldDir, base + '.ld');
const csvPath = path.join(__dirname, '..', 'sample-data', base + '.csv');
const available = fs.existsSync(ldPath) && fs.existsSync(ldPath.replace(/\.ld$/, '.ldx')) && fs.existsSync(csvPath);

const ab = (p: string) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe.skipIf(!available)('MoTeC .ld reader matches the CSV export', () => {
  // The suite body still runs when skipped, so only read the files when they exist.
  const ldx = available ? fs.readFileSync(ldPath.replace(/\.ld$/, '.ldx'), 'utf8') : '';
  const ld = available ? parseLd(ab(ldPath), base + '.ld', ldx) : (null as never);
  const csv = available ? parseTelemetryCsv(ab(csvPath), base + '.csv') : (null as never);

  it('reads header metadata and .ldx laps', () => {
    expect(ld.meta.venue).toBe('singapore_2020-layout_f1_2026');
    expect(ld.meta.driver).toBe('Lewis Hamilton');
    expect(ld.meta.vehicle).toBe('vrc_formula_alpha_2026_csp');
    expect(ld.meta.beacons.map((b) => +b.toFixed(3))).toEqual([117.9, 221.022, 323.73, 425.798, 527.222]);
    expect(ld.meta.setup['Front ARB'].value).toBe('72500');
    expect(ld.meta.details['Vehicle Wheelbase'].unit).toBe('m');
    expect(ld.meta.gameTimeUtc).toBe(csv.meta.gameTimeUtc);
  });

  it('has the same channels, rates and sample values', () => {
    expect(ld.channels.length).toBe(csv.channels.length);
    for (const c of csv.channels) {
      const l = ld.channels.find((x) => x.name === c.name);
      expect(l, c.name).toBeTruthy();
      expect(l!.rate, c.name).toBe(c.rate);
      const n = Math.min(l!.data.length, c.data.length);
      expect(Math.abs(l!.data.length - c.data.length), c.name).toBeLessThanOrEqual(2);
      for (const k of [0, 1, Math.floor(n / 3), Math.floor(n / 2), n - 1]) {
        const a = l!.data[k],
          b = c.data[k];
        expect(Math.abs(a - b), `${c.name}[${k}] ld=${a} csv=${b}`).toBeLessThanOrEqual(Math.max(1e-3, Math.abs(b) * 1e-5));
      }
    }
  });

  it('builds the same laps and sectors', () => {
    const sl = buildSession(ld, { path: ldPath, fileName: base + '.ld', size: 0, mtime: 0 });
    const sc = buildSession(csv, { path: csvPath, fileName: base + '.csv', size: 0, mtime: 0 });
    expect(sl.laps.map((l) => +l.time.toFixed(3))).toEqual(sc.laps.map((l) => +l.time.toFixed(3)));
    expect(sl.laps.map((l) => l.invalid)).toEqual(sc.laps.map((l) => l.invalid));
    expect(sl.sectorSplits.map((d) => Math.round(d))).toEqual(sc.sectorSplits.map((d) => Math.round(d)));
  });
});

describe('.ldx parsing', () => {
  it('extracts markers, details and numeric setup values', () => {
    const x = parseLdx(`<LDXFile><Layers><Layer><MarkerBlock><MarkerGroup Name="Beacons">
      <Marker Version="100" ClassName="BCN" Name="Manual.1" Flags="77" Time="9.000000e+07"/>
      </MarkerGroup></MarkerBlock></Layer><Details>
      <String Id="Fastest Time" Value="1:41.424"/><Numeric Id="Vehicle Track" Value="1.52" Unit="m" DPS="3"/>
      </Details></Layers><Maths><MathItems>
      <MathExpression Id="Setup Rear ARB" Interpolate="0" Unit="N/m" DisplayUnit="N/m" Script="22500"/>
      <MathExpression Id="Tyres" Script="'Tyres Compound' []"/></MathItems></Maths></LDXFile>`);
    expect(x.beacons).toEqual([90]);
    expect(x.fastestTime).toBeCloseTo(101.424, 3);
    expect(x.details['Vehicle Track']).toEqual({ value: '1.52', unit: 'm' });
    expect(x.setup).toEqual({ 'Rear ARB': { value: '22500', unit: 'N/m' } });
  });
});
