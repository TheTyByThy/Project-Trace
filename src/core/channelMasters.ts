// Master channels: one name that traces, math channels and workspaces use, filled in each session from the
// first of its source channels that the log has. Different exports name the same data differently (a team-mate's
// car-script channels come out as "Ext_Throttle Pedal", "Ext_Diff Entry"…, cut to 32 characters), so with
// "Throttle Pedal" ← [Throttle Pedal, Ext_Throttle Pedal] every workspace works on both drivers' logs unchanged.
//
// The sources are a priority list. The driver inputs go on to the closest channels that really are the same
// thing, so a log without the car-script channels still has a throttle trace (and everything built on it). The
// car-script channels themselves have no such stand-in: no logged channel matches them, so they stay missing
// rather than showing a different quantity under their name.

import type { ChannelInfo, KeyChannels, Session } from './types';

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

const withExt = (names: string[]) => names.flatMap((n) => [n, extName(n)]);

/**
 * Masters with fallbacks past their own two names, nearest first. On the Imola logs of 02/11 Throttle Pedal and
 * Throttle Raw differ by 0.3% on average, and Throttle Pos (after the car's processing) is over 5% from them for
 * 6% of the lap, so Pedal and Raw stand in for each other first. Brake Bias reads the base bias (0.06% from it).
 */
const FALLBACKS: Record<string, string[]> = {
  'Throttle Pos': [...withExt(['Throttle Pos', 'Throttle Pedal', 'Throttle Raw']), 'Throttle'],
  'Throttle Pedal': [...withExt(['Throttle Pedal', 'Throttle Raw', 'Throttle Pos']), 'Throttle'],
  'Throttle Raw': [...withExt(['Throttle Raw', 'Throttle Pedal', 'Throttle Pos']), 'Throttle'],
  'Brake Pos': [...withExt(['Brake Pos', 'Brake Pedal', 'Brake Raw']), 'Brake'],
  'Brake Bias Base': [...withExt(['Brake Bias Base']), 'Brake Bias'],
  'Steering Angle': [...withExt(['Steering Angle']), 'Steering Wheel Angle', 'Steering Pos', 'Steering'],
  'Clutch Pos': [...withExt(['Clutch Pos', 'Clutch Pedal']), 'Clutch'],
  'Ground Speed': [...withExt(['Ground Speed']), 'Speed', 'Vehicle Speed', 'GPS Speed'],
  Gear: [...withExt(['Gear']), 'Gear Position', 'Current Gear'],
  'Engine RPM': [...withExt(['Engine RPM']), 'RPM', 'Engine Speed'],
};

/** The FA26 car script's channels (logged under both names: 50 channels on COTA 26/10), and the driver inputs. */
export const DEFAULT_CHANNEL_MASTERS: ChannelMaster[] = [...GROUPS, ['Driver inputs', ['Ground Speed', 'Steering Angle', 'Clutch Pos', 'Gear', 'Engine RPM']] as [string, string[]]].flatMap(([group, names]) =>
  names.map((name) => ({ name, sources: FALLBACKS[name] ?? [name, extName(name)], group })),
);

/**
 * Bring saved masters up to date with the default fallbacks: new masters are added and new fallbacks go on the end
 * of a saved list, so whatever order you chose still wins.
 */
export function addDefaultFallbacks(saved: ChannelMaster[]): ChannelMaster[] {
  const out = saved.map((m) => ({ ...m, sources: [...m.sources] }));
  for (const d of DEFAULT_CHANNEL_MASTERS) {
    if (!FALLBACKS[d.name]) continue;
    const m = out.find((x) => x.name === d.name);
    if (!m) out.push({ ...d, sources: [...d.sources] });
    else for (const src of d.sources) if (!m.sources.includes(src)) m.sources.push(src);
  }
  return out;
}

/** Key channels a master can fill when the log's own names weren't recognised (so corner ranges still see the pedals). */
const KEY_MASTERS: [keyof KeyChannels, string][] = [
  ['speed', 'Ground Speed'],
  ['throttle', 'Throttle Pos'],
  ['brake', 'Brake Pos'],
  ['clutch', 'Clutch Pos'],
  ['steering', 'Steering Angle'],
  ['gear', 'Gear'],
  ['rpm', 'Engine RPM'],
];

interface Applied {
  /** Master channels added to the session (they weren't logged under that name). */
  added: string[];
  /** Logged channels a master replaced, to put back when the masters change. */
  shadowed: Map<string, ChannelInfo>;
  /** Master → the source used. */
  used: Record<string, string>;
  /** Key channels a master filled, to clear when the masters change. */
  keys: (keyof KeyChannels)[];
}
const applied = new WeakMap<Session, Applied>();

/** Undo a previous applyChannelMasters (the session's own channels again). */
function restore(s: Session) {
  const a = applied.get(s);
  if (!a) return;
  for (const n of a.added) s.channels.delete(n);
  for (const [n, ch] of a.shadowed) s.channels.set(n, ch);
  s.channelOrder = s.channelOrder.filter((n) => s.channels.has(n));
  for (const k of a.keys) delete s.key[k];
  applied.delete(s);
}

/**
 * Fill each master channel from its first source the session logged (always from the logged channels, never
 * from another master). Call before the math channels; calling again replaces the previous mapping.
 */
export function applyChannelMasters(s: Session, masters: ChannelMaster[]) {
  restore(s);
  const a: Applied = { added: [], shadowed: new Map(), used: {}, keys: [] };
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
  for (const [key, name] of KEY_MASTERS)
    if (!s.key[key] && a.used[name]) {
      s.key[key] = name;
      a.keys.push(key);
    }
  applied.set(s, a);
}

/** Which source each master took in this session (masters the session has none of are missing). */
export const masterSources = (s: Session): Record<string, string> => applied.get(s)?.used ?? {};
