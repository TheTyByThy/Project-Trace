// Live mode: when a new telemetry export lands in your telemetry folders (Telemetrick writes one when you
// finish a run), open it straight away — added to what's open, or replacing it. The main process watches
// the folders and reports each file once it has finished writing; this decides whether to open it.
// Optionally only while a chosen sim is running (or was, in the last 15 minutes, since an export can
// arrive as you quit). Project-Trace never takes focus from the sim: it flashes its taskbar / Dock icon.

import { create } from 'zustand';
import { baseName, pt } from '../core/bridge';
import { prettyTrack } from '../core/format';
import { simProcessNames } from '../core/sims';
import { openFiles, telemetryFolders, toast, useStore } from './store';

const SIM_GRACE_MS = 15 * 60 * 1000;
const POLL_MS = 15 * 1000;

interface LiveStatus {
  /** Folders being watched (0 = off or none set). */
  watching: number;
  /** Whether a chosen sim is running: null = not checked (gate off) or the process list isn't available. */
  simRunning: boolean | null;
  /** Last time a chosen sim was seen running (epoch ms, 0 = never). */
  simSeenAt: number;
  /** Last export Live mode opened. */
  lastOpened: string | null;
}

export const useLive = create<LiveStatus>(() => ({ watching: 0, simRunning: null, simSeenAt: 0, lastOpened: null }));

const stem = (p: string) => p.replace(/\.(csv|ld)$/i, '').toLowerCase();
const handled = new Set<string>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function checkSim() {
  const l = useStore.getState().settings.live;
  const names = simProcessNames(l);
  const running = await pt().runningProcesses();
  if (!running) return useLive.setState({ simRunning: null });
  const on = names.some((n) => running.includes(n));
  useLive.setState((s) => ({ simRunning: on, simSeenAt: on ? Date.now() : s.simSeenAt }));
}

/** May an export be opened now? (Always, unless the sim gate is on and no chosen sim ran recently.) */
function simAllows(): boolean {
  if (!useStore.getState().settings.live.requireSim) return true;
  const { simRunning, simSeenAt } = useLive.getState();
  if (simRunning === null) return true; // can't tell: don't block
  return simRunning || Date.now() - simSeenAt < SIM_GRACE_MS;
}

async function onLiveFile(file: string) {
  const st = useStore.getState();
  const l = st.settings.live;
  if (!l.enabled) return;
  // Telemetrick can write a .csv and an .ld (+ .ldx) of the same run: open whichever finishes first.
  const key = stem(file);
  if (handled.has(key) || st.sessions.some((s) => stem(s.path) === key)) return;
  handled.add(key);
  if (l.requireSim) await checkSim();
  if (!simAllows()) {
    toast(`New export saved: ${baseName(file)} — not opened, as no chosen sim is running (Settings → Live mode).`, 'info', 7000);
    return;
  }
  await openFiles([file], l.action);
  const s = useStore.getState().sessions.find((x) => x.path === file);
  if (!s) return;
  useLive.setState({ lastOpened: file });
  toast(`Live: opened your new ${prettyTrack(s.meta.venue).track} run${l.action === 'add' ? ' alongside the open sessions' : ''}.`, 'info', 6000);
  pt().flashWindow();
}

/** (Re)apply the Live mode settings: what to watch and whether to poll for the sim. */
async function apply() {
  const st = useStore.getState();
  const l = st.settings.live;
  const dirs = l.enabled ? telemetryFolders(st.settings).map((f) => f.path) : [];
  const watching = await pt().liveWatch(dirs);
  useLive.setState({ watching });
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (l.enabled && l.requireSim) {
    checkSim();
    pollTimer = setInterval(checkSim, POLL_MS);
  } else useLive.setState({ simRunning: null });
}

/** Start Live mode once settings are loaded; follows settings changes. Returns a cleanup function. */
export function startLive(): () => void {
  const off = pt().onLiveFile((f) => void onLiveFile(f));
  let prev = '';
  let seen: unknown = null;
  const sync = () => {
    const { settings: s, ready } = useStore.getState();
    // The store changes constantly (cursor, zoom); only look again when the settings object does.
    if (!ready || s === seen) return;
    seen = s;
    const key = JSON.stringify([s.live, telemetryFolders(s).map((f) => f.path)]);
    if (key !== prev) {
      prev = key;
      void apply();
    }
  };
  sync();
  const unsub = useStore.subscribe(sync);
  return () => {
    off();
    unsub();
    if (pollTimer) clearInterval(pollTimer);
    void pt().liveWatch([]);
  };
}
