// Sims Live mode can look for, and the Live mode settings. Process names are matched case-insensitively
// against the running executables (Windows: tasklist; macOS / Linux: ps).

export interface SimDef {
  id: string;
  name: string;
  processes: string[];
}

export const SIMS: SimDef[] = [
  { id: 'ac', name: 'Assetto Corsa', processes: ['acs.exe', 'acs_x86.exe'] },
  { id: 'acc', name: 'Assetto Corsa Competizione', processes: ['ac2-win64-shipping.exe'] },
];

export interface LiveSettings {
  /** Open new exports from the telemetry folders as soon as they're written. */
  enabled: boolean;
  /** Add the new session to the ones open (its fastest lap as an overlay), or replace them. */
  action: 'add' | 'replace';
  /** Only open exports while one of the chosen sims is running (or was, within the last 15 minutes). */
  requireSim: boolean;
  /** Ids from SIMS. */
  sims: string[];
  /** Extra executable names, comma-separated (e.g. a sim not listed). */
  extraProcesses: string;
}

export const DEFAULT_LIVE: LiveSettings = { enabled: false, action: 'add', requireSim: false, sims: ['ac'], extraProcesses: '' };

/** Lower-cased executable names to look for. */
export function simProcessNames(l: LiveSettings): string[] {
  const listed = SIMS.filter((s) => l.sims.includes(s.id)).flatMap((s) => s.processes);
  const extra = l.extraProcesses
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return [...listed, ...extra].map((x) => x.toLowerCase());
}
