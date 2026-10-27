// Master channels: one name that traces, math channels and workspaces use, filled in each session from the
// first of its source channels that the log has. Different exports name the same data differently (a team-mate's
// car-script channels come out as "Ext_Throttle Pedal", "Ext_Diff Entry"…, cut to 32 characters), so with
// "Throttle Pedal" ← [Throttle Pedal, Ext_Throttle Pedal] every workspace works on both drivers' logs unchanged.

import type { ChannelInfo, Session } from './types';

export interface ChannelMaster {
  /** The name everything else uses. */
  name: string;
  /** Logged channels to fill it from, in order of preference; the first one the session has is used. */
  sources: string[];
  /** Heading in Settings → Master channels. */
  group?: string;
}

/** How a car-script channel is named in the "Ext_" exports: prefixed, then cut to the 32-character limit. */
export const extName = (name: string) => `Ext_${name}`.slice(0, 32).trimEnd();

const GROUPS: [string, string[]][] = [
  ['Throttle', ['Throttle Pos', 'Throttle Pedal', 'Throttle Raw']],
  [
    'Brakes',
    ['Brake Pos', 'Brake Bias Base', 'Brake Bias Live', 'Brake Bias Target Delta', 'Brake Balance Map', 'Brake Migration Migration', 'Brake Shape Map'],
  ],
  ['Differential', ['Diff Entry', 'Diff Mid', 'Diff Exit']],
  [
    'ERS',
    [
      'Deployment Split',
      'Deployment Strat',
      'KERS Boost Active',
      'KERS Charge Active',
      'KERS Charge ESOC',
      'KERS Deploy MJ',
      'KERS Regen MJ',
      'KERS Regen Limit MJ',
      'MGU-K Rear Power',
      'MGU-K Rear Torque',
      'MGU-K Max Power',
      'MGU-K Max Power Limit',
      'MGU-K Max Power Reduction',
      'MGU-K Max Power Reset',
      'MGU-K Max Power Reset Speed Thre',
      'Overtake Active',
      'Overtake Active Pending',
    ],
  ],
  [
    'Engine & PU',
    [
      'EB Setting',
      'PU Mode',
      'PU Temperature',
      'PU Torque',
      'Engine Running',
      'Engine Torque Demand',
      'Engine Torque Driver Demand',
      'Engine Torque Out',
      'Power Limited',
      'Power Limited Pending',
      'Power Limited Exit Torque',
      'Antistall Active',
      'SLM Active',
      'SLM Latch',
    ],
  ],
  [
    'Other',
    [
      'Plank Wear',
      'Front Legality Plank Wear',
      'Mid Legality Plank Wear',
      'Rear Legality Plank Wear',
      'EOS Camber Limit Front',
      'EOS Camber Limit Rear',
      'Tyre Min Starting Pressure Front',
      'Tyre Min Starting Pressure Rear',
    ],
  ],
];

/** Every channel the FA26 car script logs under both names (checked on COTA 26/10: 50 channels, nothing else differs). */
export const DEFAULT_CHANNEL_MASTERS: ChannelMaster[] = GROUPS.flatMap(([group, names]) =>
  names.map((name) => ({ name, sources: [name, extName(name)], group })),
);

interface Applied {
  /** Master channels added to the session (they weren't logged under that name). */
  added: string[];
  /** Logged channels a master replaced, to put back when the masters change. */
  shadowed: Map<string, ChannelInfo>;
  /** Master → the source used. */
  used: Record<string, string>;
}
const applied = new WeakMap<Session, Applied>();

/** Undo a previous applyChannelMasters (the session's own channels again). */
function restore(s: Session) {
  const a = applied.get(s);
  if (!a) return;
  for (const n of a.added) s.channels.delete(n);
  for (const [n, ch] of a.shadowed) s.channels.set(n, ch);
  s.channelOrder = s.channelOrder.filter((n) => s.channels.has(n));
  applied.delete(s);
}

/**
 * Fill each master channel from its first source the session logged (always from the logged channels, never
 * from another master). Call before the math channels; calling again replaces the previous mapping.
 */
export function applyChannelMasters(s: Session, masters: ChannelMaster[]) {
  restore(s);
  const a: Applied = { added: [], shadowed: new Map(), used: {} };
  const logged = (n: string) => {
    const ch = s.channels.get(n);
    return ch && !ch.isMath ? ch : undefined;
  };
  const picks: [string, string, ChannelInfo][] = [];
  for (const m of masters) {
    const name = m.name.trim();
    if (!name) continue;
    const src = m.sources.map((x) => x.trim()).find((x) => x && logged(x));
    if (!src) continue;
    a.used[name] = src;
    if (src !== name) picks.push([name, src, logged(src)!]);
  }
  for (const [name, , ch] of picks) {
    const own = s.channels.get(name);
    if (own && !own.isMath) {
      if (!a.shadowed.has(name)) a.shadowed.set(name, own);
    } else if (!a.added.includes(name)) a.added.push(name);
    s.channels.set(name, { ...ch, name });
    if (!s.channelOrder.includes(name)) s.channelOrder.push(name);
  }
  applied.set(s, a);
}

/** Which source each master took in this session (masters the session has none of are missing). */
export const masterSources = (s: Session): Record<string, string> => applied.get(s)?.used ?? {};
