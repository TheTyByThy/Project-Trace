// Tyre compounds: named from the .ldx enumeration, with a letter and colour for the badge.
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseLd, parseLdx } from '../src/core/ldParser';
import { buildSession } from '../src/core/session';
import { compoundFor, lapCompound, sessionCompounds } from '../src/core/compound';

const LDX = `<LDXFile><Maths Id="Local"><MathEnumerations>
  <MathEnumeration Name="Tyres Available">
    <Enum Name="Piorani US (C5)" Value="0"/><Enum Name="Piorani SS (C4)" Value="1"/><Enum Name="Piorani S (C3)" Value="2"/>
    <Enum Name="Piorani M (C2)" Value="3"/><Enum Name="Piorani H (C1)" Value="4"/><Enum Name="Piorani Inter (INT)" Value="5"/><Enum Name="Piorani Wet (WET)" Value="6"/>
  </MathEnumeration></MathEnumerations><MathItems>
  <MathExpression Id="Tyres" Interpolate="0" Unit="" DisplayUnit="" Script="'Tyres Compound' []" EnumerationName="Tyres Available" DisplayDPS="0"/>
</MathItems></Maths></LDXFile>`;

describe('tyre compounds', () => {
  it('reads the compound names from the .ldx and links them to the channel', () => {
    const x = parseLdx(LDX);
    expect(x.enums['Tyres Compound'][3]).toBe('Piorani M (C2)');
    const s = { meta: { enums: x.enums } } as any;
    expect(compoundFor(s, 3)).toMatchObject({ letter: '2', short: 'C2', color: '#f2c230' });
    expect(compoundFor(s, 1)).toMatchObject({ letter: '4', short: 'C4' });
    expect(compoundFor(s, 5)).toMatchObject({ letter: 'I', short: 'INT' });
    expect(compoundFor(s, 6)).toMatchObject({ letter: 'W', short: 'WET' });
  });

  it('falls back to the number without names (CSV exports)', () => {
    expect(compoundFor({ meta: {} } as any, 2)).toMatchObject({ name: 'Compound 2', letter: '2' });
  });

  // A real log: lowerlaptime's COTA run on the SS (C4).
  const p = path.join(__dirname, '..', 'myTelemData', 'Martin', '26102026-194918-lowerlaptime-vrc_formula_alpha_2026_csp-cota_2022-layout_f1_2024.ld');
  it.skipIf(!fs.existsSync(p))('names the compound of a real stint', () => {
    const b = fs.readFileSync(p);
    const s = buildSession(parseLd(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, path.basename(p), fs.readFileSync(p.replace(/\.ld$/, '.ldx'), 'utf8')), {
      path: p,
      fileName: path.basename(p),
      size: 0,
      mtime: 0,
    });
    expect(sessionCompounds(s).map((c) => c.name)).toEqual(['Piorani SS (C4)']);
    expect(lapCompound(s, s.laps[2])?.short).toBe('C4');
  });
});
