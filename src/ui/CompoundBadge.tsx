// A tyre-compound badge: a ring in the compound's colour with its letter (as on a tyre sidewall), and its name.

import { lapCompound, sessionCompounds, type Compound } from '../core/compound';
import type { Lap, Session } from '../core/types';

export function CompoundBadge({ c, label = 'short' }: { c: Compound; label?: 'short' | 'full' | 'none' }) {
  return (
    <span className="compound-badge" title={`Tyres: ${c.name}`}>
      <span className="compound-ring" style={{ borderColor: c.color, color: c.color }}>
        {c.letter}
      </span>
      {label !== 'none' && <span className="compound-name">{label === 'full' ? c.name : c.short}</span>}
    </span>
  );
}

/** The compound(s) of a session (several after a tyre change), or nothing without the channel. */
export function SessionCompounds({ s, label = 'short' }: { s: Session; label?: 'short' | 'full' | 'none' }) {
  return (
    <>
      {sessionCompounds(s).map((c) => (
        <CompoundBadge key={c.index} c={c} label={label} />
      ))}
    </>
  );
}

/** The compound(s) of some laps — a stint average over a tyre change shows both. */
export function LapsCompounds({ s, laps, label = 'short' }: { s: Session; laps: Lap[]; label?: 'short' | 'full' | 'none' }) {
  const seen = new Map<number, Compound>();
  for (const l of laps) {
    const c = lapCompound(s, l);
    if (c && !seen.has(c.index)) seen.set(c.index, c);
  }
  return (
    <>
      {[...seen.values()].map((c) => (
        <CompoundBadge key={c.index} c={c} label={label} />
      ))}
    </>
  );
}
