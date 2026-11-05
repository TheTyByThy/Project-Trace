// Master channels: one name filled from whichever source a log has, used by math channels, and re-mappable.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseTelemetryCsv } from '../src/core/csvParser';
import { parseLd } from '../src/core/ldParser';
import { buildSession } from '../src/core/session';
import { applyMathChannels } from '../src/core/math/evaluate';
import { addDefaultFallbacks, applyChannelMasters, DEFAULT_CHANNEL_MASTERS, extName, masterSources } from '../src/core/channelMasters';
import { realLog } from './realLogs';

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
    expect(DEFAULT_CHANNEL_MASTERS.length).toBe(50 + 2 + 5); // the 50 car-script channels, Throttle Pos and Brake Pos, and the other driver inputs
  });

  it('use the sources as a priority list: the first one the log has wins, then the next', () => {
    const s = sample();
    const pos = s.channels.get('Throttle Pos')!;
    // Nothing earlier in the list is logged, so it moves down to Throttle Pos.
    applyChannelMasters(s, DEFAULT_CHANNEL_MASTERS);
    expect(masterSources(s)['Throttle Pedal']).toBe('Throttle Pos');
    // Add a channel earlier in the list: that one takes over, without touching the logged Throttle Pos.
    s.channels.set('Ext_Throttle Raw', { ...pos, name: 'Ext_Throttle Raw', data: new Float32Array(pos.n) });
    applyChannelMasters(s, DEFAULT_CHANNEL_MASTERS);
    expect(masterSources(s)['Throttle Pedal']).toBe('Ext_Throttle Raw');
    expect(s.channels.get('Throttle Pos')).toBe(pos);
    applyChannelMasters(s, []);
    s.channels.set('Throttle Pedal', { ...pos, name: 'Throttle Pedal' });
    applyChannelMasters(s, DEFAULT_CHANNEL_MASTERS);
    expect(masterSources(s)['Throttle Pedal']).toBe('Throttle Pedal');
  });

  it('stands in for a master that has no source without inventing one', () => {
    const s = sample();
    applyChannelMasters(s, DEFAULT_CHANNEL_MASTERS);
    expect(masterSources(s)['Diff Entry']).toBeUndefined();
    expect(s.channels.has('Diff Entry')).toBe(false);
  });

  it('every default keeps its own name first and lists a source once', () => {
    for (const m of DEFAULT_CHANNEL_MASTERS) {
      expect(m.sources[0]).toBe(m.name);
      expect(new Set(m.sources).size).toBe(m.sources.length);
    }
    const inputs = ['Throttle Pos', 'Throttle Pedal', 'Throttle Raw', 'Brake Pos', 'Steering Angle', 'Clutch Pos', 'Ground Speed', 'Gear', 'Engine RPM'];
    for (const n of inputs) expect(DEFAULT_CHANNEL_MASTERS.find((m) => m.name === n)!.sources.length, n).toBeGreaterThanOrEqual(3);
  });

  it('fills a key channel the log did not have, and gives it back when the masters change', () => {
    const s = sample();
    const pos = s.channels.get('Throttle Pos')!;
    s.channels.delete('Throttle Pos');
    s.channels.set('Ext_Throttle Pedal', { ...pos, name: 'Ext_Throttle Pedal' });
    s.key.throttle = undefined;
    applyChannelMasters(s, DEFAULT_CHANNEL_MASTERS);
    expect(s.key.throttle).toBe('Throttle Pos');
    expect(s.channels.get('Throttle Pos')!.data).toBe(pos.data);
    applyChannelMasters(s, []);
    expect(s.key.throttle).toBeUndefined();
  });

  it('adds new fallbacks to saved masters after whatever order was chosen', () => {
    const saved = [
      { name: 'Throttle Pedal', sources: ['Throttle Pos', 'Ext_Throttle Pedal'], group: 'Throttle' },
      { name: 'Diff Entry', sources: ['My Diff'], group: 'Differential' },
      { name: 'Mine', sources: ['Something'] },
    ];
    const out = addDefaultFallbacks(saved);
    const pedal = out.find((m) => m.name === 'Throttle Pedal')!;
    expect(pedal.sources.slice(0, 2)).toEqual(['Throttle Pos', 'Ext_Throttle Pedal']);
    expect(pedal.sources).toContain('Throttle Pedal');
    expect(pedal.sources).toContain('Throttle Raw');
    expect(out.find((m) => m.name === 'Diff Entry')!.sources).toEqual(['My Diff']); // no fallbacks of its own
    expect(out.find((m) => m.name === 'Mine')).toBeTruthy();
    expect(out.find((m) => m.name === 'Ground Speed')).toBeTruthy(); // a new master
    expect(saved[0].sources.length).toBe(2); // the saved list isn't changed in place
  });
});

// The team-mate's COTA log (Ext_ names) through the defaults: the plain names FA26 V1.3 uses all resolve.
const martin = realLog('26102026-194918-lowerlaptime-vrc_formula_alpha_2026_csp-cota_2022-layout_f1_2024.ld', 'Martin');
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
