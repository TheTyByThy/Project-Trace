// Master channels: one name filled from whichever source a log has, used by math channels, and re-mappable.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseTelemetryCsv } from '../src/core/csvParser';
import { parseLd } from '../src/core/ldParser';
import { buildSession } from '../src/core/session';
import { applyMathChannels } from '../src/core/math/evaluate';
import { applyChannelMasters, DEFAULT_CHANNEL_MASTERS, extName, masterSources } from '../src/core/channelMasters';

const ab = (p: string) => {
  const b = fs.readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const sampleDir = path.join(__dirname, '..', 'sample-data');
const sampleFile = fs.readdirSync(sampleDir).find((f) => f.endsWith('.csv'))!;
const sample = () => buildSession(parseTelemetryCsv(ab(path.join(sampleDir, sampleFile)), sampleFile), { path: sampleFile, fileName: sampleFile, size: 0, mtime: 0 });
const math = (name: string, expr: string) => ({ id: name, name, expr, unit: '', dps: 0, description: '', enabled: true });

describe('master channels', () => {
  it('fill a master from the first source the log has, and math channels read it', () => {
    const s = sample();
    applyChannelMasters(s, [{ name: 'Pedal', sources: ['Ext_Throttle Pos', 'Throttle Pos'] }]);
    expect(masterSources(s).Pedal).toBe('Throttle Pos');
    expect(s.channels.get('Pedal')!.data).toBe(s.channels.get('Throttle Pos')!.data);
    const res = applyMathChannels(s, [math('Flat out', "choose('Pedal' > 98, 1, 0)")], []);
    expect(res.errors['Flat out']).toBeUndefined();
    expect(s.channels.get('Flat out')!.max).toBe(1);
  });

  it('can stand in for a logged channel, and changing the masters puts everything back', () => {
    const s = sample();
    const brake = s.channels.get('Brake Pos')!;
    applyChannelMasters(s, [{ name: 'Brake Pos', sources: ['Throttle Pos'] }, { name: 'Pedal', sources: ['Throttle Pos'] }]);
    expect(s.channels.get('Brake Pos')!.data).toBe(s.channels.get('Throttle Pos')!.data);
    applyChannelMasters(s, []);
    expect(s.channels.get('Brake Pos')).toBe(brake);
    expect(s.channels.has('Pedal')).toBe(false);
    expect(s.channelOrder.includes('Pedal')).toBe(false);
  });

  it('knows how the Ext_ exports shorten long names', () => {
    expect(extName('Diff Entry')).toBe('Ext_Diff Entry');
    expect(extName('Tyre Min Starting Pressure Front')).toBe('Ext_Tyre Min Starting Pressure F');
    expect(extName('MGU-K Max Power Reset Speed Thre')).toBe('Ext_MGU-K Max Power Reset Speed');
    expect(DEFAULT_CHANNEL_MASTERS.length).toBe(50 + 2); // the 50 car-script channels, plus Throttle Pos and Brake Pos
  });
});

// The team-mate's COTA log (Ext_ names) through the defaults: the plain names FA26 V1.3 uses all resolve.
const martin = path.join(__dirname, '..', 'myTelemData', 'Martin', '26102026-194918-lowerlaptime-vrc_formula_alpha_2026_csp-cota_2022-layout_f1_2024.ld');
const available = fs.existsSync(martin) && fs.existsSync(martin.replace(/\.ld$/, '.ldx'));

describe.skipIf(!available)("master channels on a team-mate's Ext_ log", () => {
  it('gives the plain names to every Ext_ channel', () => {
    const s = buildSession(parseLd(ab(martin), path.basename(martin), fs.readFileSync(martin.replace(/\.ld$/, '.ldx'), 'utf8')), {
      path: martin,
      fileName: path.basename(martin),
      size: 0,
      mtime: 0,
    });
    expect(s.channels.has('Diff Entry')).toBe(false);
    applyChannelMasters(s, DEFAULT_CHANNEL_MASTERS);
    for (const n of ['Throttle Pedal', 'Diff Entry', 'Diff Mid', 'Diff Exit', 'KERS Deploy MJ', 'MGU-K Rear Power', 'Brake Migration Migration', 'EB Setting', 'Tyre Min Starting Pressure Front'])
      expect(masterSources(s)[n], n).toBe(extName(n));
    const res = applyMathChannels(s, [math('Full Throttle', "choose('Throttle Pedal' > 98, 1, 0)")], []);
    expect(res.errors['Full Throttle']).toBeUndefined();
    expect(s.channels.get('Full Throttle')!.max).toBe(1);
  });
});
