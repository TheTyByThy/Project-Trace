// The tyre compound a session (or a lap) ran on: 'Tyres Compound' (an index), named from the .ldx enumeration
// when there is one ("Piorani M (C2)") — else "Compound 3". Colours follow the usual tyre markings.

import type { Lap, Session } from './types';

export interface Compound {
  index: number;
  /** Full name, e.g. "Piorani M (C2)" or "Compound 3". */
  name: string;
  /** Text inside the badge ring: the compound number ("2" for C2), "I", "W" ("3" without names). */
  letter: string;
  /** The compound as shown: its number, e.g. "C2" (or "INT", "WET"). */
  short: string;
  color: string;
}

const COLORS: Record<string, string> = {
  US: '#b36bf2',
  SS: '#f06aa6',
  S: '#e5484d',
  M: '#f2c230',
  H: '#e8e8e8',
  INT: '#36b37e',
  I: '#36b37e',
  W: '#3987e5',
  WET: '#3987e5',
};

// Some exporters leave the compound names out of the .ldx; for the Formula Alpha 2026 they're known.
const FA26_COMPOUNDS: Record<number, string> = {
  0: 'Piorani US (C5)',
  1: 'Piorani SS (C4)',
  2: 'Piorani S (C3)',
  3: 'Piorani M (C2)',
  4: 'Piorani H (C1)',
  5: 'Piorani Inter (INT)',
  6: 'Piorani Wet (WET)',
};

function compoundNames(s: Session): Record<number, string> | undefined {
  return s.meta.enums?.['Tyres Compound'] ?? (/formula[\s_-]*alpha[\s_-]*2026/i.test(s.meta.vehicle ?? '') ? FA26_COMPOUNDS : undefined);
}

export function compoundFor(s: Session, index: number): Compound {
  const raw = compoundNames(s)?.[index];
  if (!raw) return { index, name: `Compound ${index}`, letter: String(index), short: `Compound ${index}`, color: '#8b93a1' };
  // "Piorani M (C2)" → shown as C2 (coloured as a medium); "Piorani Inter (INT)" → INT.
  const words = raw.replace(/\([^)]*\)\s*$/, '').trim().split(/\s+/);
  let kind = (words.length > 1 ? words[words.length - 1] : words[0] || '').toUpperCase();
  if (/^(INTER|INTERMEDIATE)$/.test(kind)) kind = 'INT';
  const code = (raw.match(/\(([^)]+)\)\s*$/)?.[1] ?? kind).toUpperCase();
  const color = COLORS[kind] ?? COLORS[code] ?? '#8b93a1';
  const letter = /^C\d+$/.test(code) ? code.slice(1) : code.slice(0, 1);
  return { index, name: raw, letter, short: code, color };
}

/** The compound index at a time, or null without the channel. */
function indexAt(s: Session, t: number): number | null {
  const c = s.channels.get('Tyres Compound');
  if (!c || !c.n) return null;
  const i = Math.max(0, Math.min(c.n - 1, Math.round((t - c.t0) * c.rate)));
  const v = c.data[i];
  return Number.isFinite(v) ? Math.round(v) : null;
}

/** The compound on a lap (read at mid-lap). */
export function lapCompound(s: Session, lap: Lap): Compound | null {
  const i = indexAt(s, (lap.start + lap.end) / 2);
  return i == null ? null : compoundFor(s, i);
}

/** Every compound run in the session, in order of first use (usually one; more after a tyre change). */
export function sessionCompounds(s: Session): Compound[] {
  const seen: number[] = [];
  for (const l of s.laps) {
    const i = indexAt(s, (l.start + l.end) / 2);
    if (i != null && !seen.includes(i)) seen.push(i);
  }
  return seen.map((i) => compoundFor(s, i));
}
