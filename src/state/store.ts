// Central application state (zustand). High-frequency values (cursor, zoom) live here too; canvas
// components subscribe imperatively so moving the cursor never re-renders the React tree.

import { create } from 'zustand';
import { baseName, dirName, pt, type AppInfo } from '../core/bridge';
import { lapXRange, timeToX, xToTime } from '../core/axis';
import { lapColor, type Theme } from '../core/colors';
import { DEFAULT_CORNER_SETTINGS, type CornerSettings, type TrackCorner } from '../core/corners';
import { applyMathChannels, type MathChannelDef, type MathConstant } from '../core/math/evaluate';
import { fastestLap, getLap, theoreticalBest } from '../core/session';
import { lapKey, parseLapKey, type Lap, type Session, type XMode } from '../core/types';
import { DEFAULT_UNITS, type UnitPrefs } from '../core/units';
import { COMPONENT_CATALOG, createComponent } from './components';
import { renameChannelsInWorkspace, type RenameMap } from './renameChannels';
import { buildBlankWorkspace, buildDefaultWorkspace } from './defaultWorkspace';
import { cloneLayout, insertComponent, moveComponent, removeComponent, setSizes, type DropZone } from './layout';
import { loadSessionFile } from './loader';
import { uid, type ChannelProps, type ComponentConfig, type ComponentType, type Workspace, type Worksheet } from './workspace';

export interface TrackSection {
  name: string;
  dist: number;
}

/** Everything Project-Trace remembers about a circuit (keyed by venue name). */
export interface TrackProfile {
  rotation: number;
  mirror: boolean;
  /** Split points (named lines on the track). */
  sections: TrackSection[];
  corners: TrackCorner[];
  /**
   * Names of the parts of the lap the splits create — S/F → first split, …, last split → S/F — used as
   * the lap reports' Custom sections columns. Missing / blank = "Section n".
   */
  sectionNames?: string[];
}

/** The name of each part of the lap between splits (one more than there are splits). */
export function sectionNames(p: TrackProfile): string[] {
  return Array.from({ length: p.sections.length + 1 }, (_, i) => p.sectionNames?.[i]?.trim() || `Section ${i + 1}`);
}

/** A named shortcut to a telemetry folder in the session browser. */
export interface TelemetryFolder {
  name: string;
  path: string;
}

export interface Settings {
  /** The default telemetry folder (always the first of telemetryFolders when there are any). */
  telemetryRoot: string;
  /** Telemetry folder shortcuts in the session browser (rename / change / remove by right-clicking). */
  telemetryFolders: TelemetryFolder[];
  lastBrowsePath: string;
  recent: string[];
  units: UnitPrefs;
  theme: Theme;
  /** click = MoTeC classic (drag zooms); scrub = drag moves the cursor, double-click-drag zooms; hover = follows the mouse. */
  cursorMode: 'click' | 'scrub' | 'hover';
  gameClock: 'track' | 'utc';
  trackZones: Record<string, string>;
  activeWorkspaceId: string;
  trackProfiles: Record<string, TrackProfile>;
  hideConstant: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  /** Reference lap drawn in per-channel colours, or entirely in its lap colour (toggle: J). */
  refColors: 'channel' | 'lap';
  /** Display smoothing for graph traces (centred moving average). */
  smoothing: { enabled: boolean; seconds: number };
  trackSort: 'recent' | 'name' | 'sessions' | 'oldest';
  /** What double-click / drag-and-drop does when sessions are already open. */
  browserOpenMode: 'add' | 'replace';
  showBrowserOnLaunch: boolean;
  /** How corner ranges are detected and the low / medium / high-speed bucket thresholds. */
  corners: CornerSettings;
  /** Keyboard shortcut overrides: action id → key combos (see src/shortcuts.ts). Missing = defaults. */
  shortcuts: Record<string, string[]>;
  /** Bumped when a default changes in a way existing users should pick up (see initApp). */
  settingsVersion: number;
}

export const DEFAULT_SETTINGS: Settings = {
  telemetryRoot: '',
  telemetryFolders: [],
  lastBrowsePath: '',
  recent: [],
  units: DEFAULT_UNITS,
  theme: 'dark',
  cursorMode: 'click',
  gameClock: 'track',
  trackZones: {},
  activeWorkspaceId: '',
  trackProfiles: {},
  hideConstant: false,
  sidebarWidth: 300,
  inspectorWidth: 340,
  refColors: 'channel',
  smoothing: { enabled: true, seconds: 0.05 },
  trackSort: 'recent',
  browserOpenMode: 'add',
  showBrowserOnLaunch: true,
  corners: DEFAULT_CORNER_SETTINGS,
  shortcuts: {},
  settingsVersion: 2,
};

export const emptyTrackProfile = (): TrackProfile => ({ rotation: 0, mirror: false, sections: [], corners: [] });

export const STARTER_ID = 'starter';

export interface LapSel {
  key: string;
  slot: number;
  /** User-chosen colour (otherwise the palette colour of the slot). */
  color?: string;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface UiState {
  sidebar: boolean;
  browser: boolean;
  math: boolean;
  settings: boolean;
  shortcuts: boolean;
  palette: boolean;
  properties: boolean;
  /** Docked Properties panel on the right (Ctrl/⌘+I). */
  inspector: boolean;
  trackProfile: boolean;
  sidebarTab: 'laps' | 'channels';
  /** True while the shortcut editor waits for a key combo (global shortcuts are paused). */
  recordingShortcut?: boolean;
}

export interface SessionCacheEntry {
  mtime: number;
  size: number;
  bestValid: number | null;
  bestValidNumber: number | null;
  ideal: number | null;
  invalidLaps: number;
}

export interface SavedSheet {
  id: string;
  name: string;
  savedAt: number;
  sheet: Worksheet;
}

/** Undo/redo snapshot. Workspaces are updated immutably, so snapshots share structure. */
interface Snapshot {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  trackProfiles: Record<string, TrackProfile>;
  label: string;
}

interface State {
  ready: boolean;
  appInfo: AppInfo | null;
  settings: Settings;
  sessions: Session[];
  loading: { path: string; name: string; progress: number }[];
  dataVersion: number;
  laps: LapSel[];
  refKey: string | null;
  xMode: XMode;
  zoom: [number, number] | null;
  cursor: number | null;
  /** Datum: the cursor is pinned where it was (mouse, clicks and arrow keys don't move it) until released. */
  datum: boolean;
  measure: [number, number] | null;
  /** Lap playback: the cursor runs through the reference lap in real time × speed. */
  playback: { playing: boolean; speed: number };
  /** Lap-distance range to highlight on track maps (hovering a corner or straight in the Corner Report). */
  highlight: { entry: number; exit: number } | null;
  workspaces: Workspace[];
  activeComponentId: string | null;
  ui: UiState;
  toasts: Toast[];
  mathErrors: Record<string, Record<string, string>>;
  notes: Record<string, string>;
  sessionCache: Record<string, SessionCacheEntry>;
  /** Unsaved track-map rotation per venue (saved rotation lives in the track profile). */
  workingRotation: Record<string, number>;
  history: { past: Snapshot[]; future: Snapshot[] };
  library: SavedSheet[];
  errors: string[];
}

export const useStore = create<State>(() => ({
  ready: false,
  appInfo: null,
  settings: DEFAULT_SETTINGS,
  sessions: [],
  loading: [],
  dataVersion: 0,
  laps: [],
  refKey: null,
  xMode: 'distance',
  zoom: null,
  cursor: null,
  datum: false,
  playback: { playing: false, speed: 1 },
  measure: null,
  highlight: null,
  workspaces: [],
  activeComponentId: null,
  ui: { sidebar: true, browser: false, math: false, settings: false, shortcuts: false, palette: false, properties: false, inspector: false, trackProfile: false, sidebarTab: 'laps' },
  toasts: [],
  mathErrors: {},
  notes: {},
  sessionCache: {},
  workingRotation: {},
  history: { past: [], future: [] },
  library: [],
  errors: [],
}));

const set = useStore.setState;
const get = useStore.getState;

// ---------------------------------------------------------------------------------------------
// Persistence (debounced)
// ---------------------------------------------------------------------------------------------

const timers = new Map<string, ReturnType<typeof setTimeout>>();
function debounce(key: string, ms: number, fn: () => void) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(fn, ms));
}
const saveSettings = () => debounce('settings', 400, () => pt().setSettings(get().settings));
const saveWorkspace = (ws: Workspace) => {
  if (!ws.locked) debounce('ws:' + ws.id, 600, () => pt().saveWorkspace(ws));
};
/** Drop a pending debounced save (used when a workspace is deleted). */
const cancelSave = (id: string) => clearTimeout(timers.get('ws:' + id));
const saveCache = () => debounce('cache', 800, () => pt().setCache(get().sessionCache));
const saveNotes = () => debounce('notes', 600, () => pt().setNotes(get().notes));
const saveLibrary = () => debounce('library', 300, () => pt().setLibrary(get().library));

// ---------------------------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------------------------

export function activeWorkspace(s: State = get()): Workspace {
  return s.workspaces.find((w) => w.id === s.settings.activeWorkspaceId) ?? s.workspaces[0];
}
export function activeSheet(s: State = get()): Worksheet | undefined {
  const ws = activeWorkspace(s);
  return ws?.worksheets[Math.min(ws.activeSheet, ws.worksheets.length - 1)];
}
export function sessionById(id: string): Session | undefined {
  return get().sessions.find((s) => s.id === id);
}
export function resolveLap(key: string): { session: Session; lap: Lap } | null {
  const r = parseLapKey(key);
  const session = sessionById(r.sessionId);
  if (!session) return null;
  const lap = getLap(session, r.lapIndex);
  return lap ? { session, lap } : null;
}

export interface SelectedLap {
  key: string;
  session: Session;
  lap: Lap;
  color: string;
  slot: number;
  isRef: boolean;
}

/** Selected laps with the reference first. */
export function selectedLaps(s: State = get()): SelectedLap[] {
  const out: SelectedLap[] = [];
  for (const l of s.laps) {
    const r = parseLapKey(l.key);
    const session = s.sessions.find((x) => x.id === r.sessionId);
    if (!session) continue;
    const lap = getLap(session, r.lapIndex);
    if (!lap) continue;
    out.push({ key: l.key, session, lap, slot: l.slot, color: l.color ?? lapColor(l.slot, s.settings.theme), isRef: l.key === s.refKey });
  }
  out.sort((a, b) => (a.isRef === b.isRef ? 0 : a.isRef ? -1 : 1));
  return out;
}

/** Sessions (stints) that have a selected lap — stint-level components only show these. */
export function sessionsWithSelection(sessions: Session[], laps: LapSel[]): Session[] {
  const ids = new Set(laps.map((l) => parseLapKey(l.key).sessionId));
  return sessions.filter((s) => ids.has(s.id));
}

export function refLap(s: State = get()): SelectedLap | undefined {
  return selectedLaps(s)[0];
}

/** Full x-extent across selected laps in the current mode. */
export function xExtent(s: State = get()): [number, number] {
  const laps = selectedLaps(s);
  if (!laps.length) return [0, 1];
  let a = Infinity,
    b = -Infinity;
  for (const l of laps) {
    const [x0, x1] = lapXRange(l.lap, s.xMode);
    a = Math.min(a, x0);
    b = Math.max(b, x1);
  }
  if (!(b > a)) return [0, 1];
  return [a, b];
}

export function viewRange(s: State = get()): [number, number] {
  return s.zoom ?? xExtent(s);
}

export function channelProps(name: string): ChannelProps {
  return activeWorkspace()?.channelProps[name] ?? {};
}

export function trackProfile(venue: string): TrackProfile {
  return { ...emptyTrackProfile(), ...get().settings.trackProfiles[venue] };
}

/** Rotation currently shown for a track (unsaved working value, else the saved default). */
export function trackRotation(venue: string, s: State = get()): number {
  return s.workingRotation[venue] ?? s.settings.trackProfiles[venue]?.rotation ?? 0;
}
export function rotationDirty(venue: string, s: State = get()): boolean {
  const w = s.workingRotation[venue];
  return w != null && Math.abs(w - (s.settings.trackProfiles[venue]?.rotation ?? 0)) > 0.05;
}

// ---------------------------------------------------------------------------------------------
// Basic actions
// ---------------------------------------------------------------------------------------------

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4000) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  if (kind === 'error') set((s) => ({ errors: [...s.errors, text] }));
}

export function setUi(patch: Partial<UiState>) {
  set((s) => ({ ui: { ...s.ui, ...patch } }));
}

export function updateSettings(patch: Partial<Settings>) {
  set((s) => ({ settings: { ...s.settings, ...patch } }));
  saveSettings();
  if (patch.theme) document.documentElement.dataset.theme = patch.theme;
  if (patch.units || patch.theme || patch.smoothing || patch.refColors || patch.corners) set((s) => ({ dataVersion: s.dataVersion + 1 }));
}

/** Show/hide sector & corner markers on every time/distance graph in the workspace at once. */
type MarkerPatch = { showSectors?: boolean; showSplits?: boolean; showCorners?: boolean };

export function setGraphMarkers(patch: MarkerPatch) {
  setMarkersOn(['graph', 'bars'], patch);
}

/** Same for graphs, track maps and GPS tracks (the marker shortcuts). */
export function setMarkersEverywhere(patch: MarkerPatch) {
  setMarkersOn(['graph', 'trackmap', 'gpstrack', 'bars'], patch);
}

function setMarkersOn(types: ComponentType[], patch: MarkerPatch) {
  updateWorkspace(
    (ws) => ({
      ...ws,
      worksheets: ws.worksheets.map((sh) => {
        let changed = false;
        const components = { ...sh.components };
        for (const [id, c] of Object.entries(components))
          if (types.includes(c.type)) {
            // Sectors and splits are separate everywhere. Older components follow the sector setting for
            // splits: pin that before sectors change.
            const own: MarkerPatch = { ...patch };
            const m = c as ComponentConfig & MarkerPatch;
            if (own.showSectors !== undefined && own.showSplits === undefined && m.showSplits === undefined) own.showSplits = m.showSectors;
            components[id] = { ...c, ...own } as ComponentConfig;
            changed = true;
          }
        return changed ? { ...sh, components } : sh;
      }),
    }),
    { label: 'Graph markers' },
  );
}

/** The telemetry folder shortcuts (older settings only have the single telemetryRoot). */
export function telemetryFolders(s: Settings = get().settings): TelemetryFolder[] {
  if (s.telemetryFolders?.length) return s.telemetryFolders;
  return s.telemetryRoot ? [{ name: baseName(s.telemetryRoot) || s.telemetryRoot, path: s.telemetryRoot }] : [];
}

/** Replace the folder shortcuts; the first one becomes the default telemetry folder. */
export function setTelemetryFolders(folders: TelemetryFolder[]) {
  updateSettings({ telemetryFolders: folders, telemetryRoot: folders[0]?.path ?? '' });
}

/** Change the default telemetry folder (keeps the other shortcuts). */
export function setDefaultTelemetryFolder(path: string) {
  const rest = telemetryFolders().slice(1).filter((f) => f.path !== path);
  setTelemetryFolders([{ name: baseName(path) || path, path }, ...rest]);
}

/** Smoothing amounts offered in the top bar and stepped through by the more/less shortcuts. */
export const SMOOTH_PRESETS = [0.03, 0.05, 0.1, 0.2, 0.35, 0.5, 1];

export function setCornerSettings(patch: Partial<CornerSettings>) {
  updateSettings({ corners: { ...get().settings.corners, ...patch } });
}

export function setSmoothing(patch: Partial<Settings['smoothing']>) {
  updateSettings({ smoothing: { ...get().settings.smoothing, ...patch } });
}

export function toggleRefColors() {
  const next = get().settings.refColors === 'channel' ? 'lap' : 'channel';
  updateSettings({ refColors: next });
  toast(next === 'channel' ? 'Reference lap: channel colours' : 'Reference lap: single lap colour', 'info', 1600);
}

/** Open the Properties pop-out, optionally for a specific component. */
export function openProperties(componentId?: string | null) {
  if (componentId !== undefined) set({ activeComponentId: componentId });
  setUi({ properties: true });
}

// ---------------------------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------------------------

let lastRecordAt = 0;
let restoring = false;

function snapshot(label: string): Snapshot {
  const s = get();
  return { workspaces: s.workspaces, activeWorkspaceId: s.settings.activeWorkspaceId, trackProfiles: s.settings.trackProfiles, label };
}

/** Record the state *before* a change. Rapid successive edits (e.g. dragging a divider) coalesce. */
function recordHistory(label: string) {
  if (restoring) return;
  const now = Date.now();
  const coalesce = now - lastRecordAt < 500 && get().history.past.length > 0;
  lastRecordAt = now;
  if (coalesce) return;
  set((s) => ({ history: { past: [...s.history.past.slice(-99), snapshot(label)], future: [] } }));
}

function applySnapshot(snap: Snapshot) {
  const before = get();
  const prevWs = before.workspaces;
  const prevActive = activeWorkspace(before);
  restoring = true;
  set((s) => ({
    workspaces: snap.workspaces,
    settings: { ...s.settings, activeWorkspaceId: snap.activeWorkspaceId, trackProfiles: snap.trackProfiles },
    dataVersion: s.dataVersion + 1,
  }));
  restoring = false;
  saveSettings();
  for (const ws of snap.workspaces) if (!prevWs.includes(ws) && !ws.locked) pt().saveWorkspace(ws);
  for (const ws of prevWs)
    if (!snap.workspaces.some((w) => w.id === ws.id) && !ws.locked) {
      cancelSave(ws.id);
      pt().deleteWorkspace(ws.id);
    }
  const nowActive = activeWorkspace();
  if (nowActive && (nowActive.id !== prevActive?.id || nowActive.math !== prevActive.math || nowActive.constants !== prevActive.constants)) recomputeMath();
  const sheet = activeSheet();
  const ac = get().activeComponentId;
  if (ac && !sheet?.components[ac]) set({ activeComponentId: null });
}

export function undo() {
  const s = get();
  const snap = s.history.past[s.history.past.length - 1];
  if (!snap) return toast('Nothing to undo', 'info', 1400);
  const current = snapshot(snap.label);
  applySnapshot(snap);
  set((st) => ({ history: { past: st.history.past.slice(0, -1), future: [...st.history.future, current] } }));
  lastRecordAt = 0;
  toast(`Undo: ${snap.label}`, 'info', 1600);
}

export function redo() {
  const s = get();
  const snap = s.history.future[s.history.future.length - 1];
  if (!snap) return toast('Nothing to redo', 'info', 1400);
  const current = snapshot(snap.label);
  applySnapshot(snap);
  set((st) => ({ history: { past: [...st.history.past, current], future: st.history.future.slice(0, -1) } }));
  lastRecordAt = 0;
  toast(`Redo: ${snap.label}`, 'info', 1600);
}

// ---------------------------------------------------------------------------------------------
// Track profiles
// ---------------------------------------------------------------------------------------------

export function setTrackProfile(venue: string, patch: Partial<TrackProfile>, label = 'Track profile') {
  if (!venue) return;
  recordHistory(label);
  const cur = trackProfile(venue);
  updateSettings({ trackProfiles: { ...get().settings.trackProfiles, [venue]: { ...cur, ...patch } } });
  set((s) => ({ dataVersion: s.dataVersion + 1 }));
}

export function setWorkingRotation(venue: string, deg: number) {
  if (!venue) return;
  const norm = ((Math.round(deg * 10) / 10) % 360 + 360) % 360;
  set((s) => ({ workingRotation: { ...s.workingRotation, [venue]: norm } }));
}

export function saveRotation(venue: string) {
  const r = trackRotation(venue);
  setTrackProfile(venue, { rotation: r }, 'Save track rotation');
  set((s) => {
    const w = { ...s.workingRotation };
    delete w[venue];
    return { workingRotation: w };
  });
  toast(`Saved ${r.toFixed(0)}° as the default rotation for this track`, 'success', 2200);
}

export function resetRotation(venue: string) {
  set((s) => {
    const w = { ...s.workingRotation };
    delete w[venue];
    return { workingRotation: w };
  });
}

export function addCorner(venue: string, corner: TrackCorner) {
  const p = trackProfile(venue);
  setTrackProfile(venue, { corners: [...p.corners, corner].sort((a, b) => a.dist - b.dist) }, 'Add corner');
}

// ---------------------------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------------------------

function starterWorkspace(): Workspace {
  return { ...buildDefaultWorkspace('Starter'), id: STARTER_ID, locked: true, createdAt: 0, updatedAt: 0 };
}

/** Fill in fields a hand-made or older workspace file may lack. */
function normalizeWorkspace(w: Workspace): Workspace {
  return { ...w, version: 1, math: w.math ?? [], constants: w.constants ?? [], channelProps: w.channelProps ?? {}, activeSheet: w.activeSheet ?? 0, createdAt: w.createdAt ?? Date.now(), updatedAt: w.updatedAt ?? Date.now() };
}

function normalizeBuiltIn(w: Workspace): Workspace {
  return { ...normalizeWorkspace(w), locked: true, createdAt: 0, updatedAt: 0 };
}

/** Pick up workspace files that appeared in the workspaces folder (e.g. one someone shared). */
export async function syncWorkspacesFromFolder() {
  const list = (await pt().listWorkspaces()) as Workspace[];
  const known = new Set(get().workspaces.map((w) => w.id));
  const added = list.filter((w) => w && Array.isArray(w.worksheets) && !known.has(w.id)).map(normalizeWorkspace);
  if (!added.length) return;
  set((s) => ({ workspaces: [...s.workspaces, ...added] }));
  toast(`Added ${added.map((w) => `"${w.name}"`).join(', ')} from your workspaces folder — switch to it in the Workspace menu.`, 'success', 5000);
}

export async function initApp() {
  const bridge = pt();
  const [info, rawSettings, list, defaults, cache, notes, library] = await Promise.all([
    bridge.appInfo(),
    bridge.getSettings(),
    bridge.listWorkspaces(),
    bridge.defaultWorkspaces(),
    bridge.getCache(),
    bridge.getNotes(),
    bridge.getLibrary(),
  ]);
  const raw = rawSettings ?? {};
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...raw,
    units: { ...DEFAULT_UNITS, ...(raw.units ?? {}) },
    smoothing: { ...DEFAULT_SETTINGS.smoothing, ...(raw.smoothing ?? {}) },
    shortcuts: { ...(raw.shortcuts ?? {}) },
    corners: { ...DEFAULT_CORNER_SETTINGS, ...(raw.corners ?? {}) },
    settingsVersion: DEFAULT_SETTINGS.settingsVersion,
  };
  // v2: smoothing is on by default at 50 ms (older settings files saved it switched off).
  if ((raw.settingsVersion ?? 1) < 2) settings.smoothing = { ...DEFAULT_SETTINGS.smoothing };
  // Migrate track profiles from older versions (auto-corner renames → manual corners).
  const profiles: Record<string, TrackProfile> = {};
  for (const [venue, p] of Object.entries((raw.trackProfiles ?? {}) as Record<string, Partial<TrackProfile>>)) {
    profiles[venue] = { rotation: p.rotation ?? 0, mirror: !!p.mirror, sections: p.sections ?? [], corners: p.corners ?? [], sectionNames: p.sectionNames };
  }
  settings.trackProfiles = profiles;
  if (!settings.telemetryRoot && info.defaultTelemetryRoot) settings.telemetryRoot = info.defaultTelemetryRoot;

  // Built-in defaults: the Starter (rebuilt from code every launch) and the workspaces shipped in
  // default-workspaces/. They are read-only and never saved, so they're always pristine.
  const builtIns = [starterWorkspace(), ...(Array.isArray(defaults) ? defaults : []).map(normalizeBuiltIn)];
  const builtInIds = new Set(builtIns.map((w) => w.id));
  let workspaces = (list as Workspace[]).filter((w) => w && Array.isArray(w.worksheets) && !builtInIds.has(w.id)).map(normalizeWorkspace);
  if (!workspaces.length) {
    const mine = buildDefaultWorkspace('My Workspace');
    workspaces = [mine];
    bridge.saveWorkspace(mine);
  }
  workspaces.sort((a, b) => a.createdAt - b.createdAt);
  workspaces = [...builtIns, ...workspaces];
  if (!workspaces.some((w) => w.id === settings.activeWorkspaceId)) settings.activeWorkspaceId = workspaces[builtIns.length].id;
  document.documentElement.dataset.theme = settings.theme;
  // Platform styling hook (macOS: the header makes room for the window's traffic-light buttons).
  document.documentElement.dataset.platform = info.platform;
  set({
    appInfo: info,
    settings,
    workspaces,
    library: Array.isArray(library) ? library : [],
    sessionCache: cache ?? {},
    notes: notes ?? {},
    ready: true,
    ui: { ...get().ui, browser: !info.automation && settings.showBrowserOnLaunch },
  });
  bridge.setSettings(settings);
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

export async function openFiles(paths: string[], mode: 'replace' | 'add' = 'replace') {
  paths = paths.filter((p) => /\.(csv|txt|ld)$/i.test(p));
  if (!paths.length) return;
  if (mode === 'replace') {
    set({ sessions: [], laps: [], refKey: null, zoom: null, cursor: null, datum: false, measure: null, mathErrors: {} });
  }
  setUi({ browser: false });
  for (const path of paths) {
    if (get().sessions.some((s) => s.path === path)) continue;
    const name = baseName(path);
    set((s) => ({ loading: [...s.loading, { path, name, progress: 0 }] }));
    try {
      const session = await loadSessionFile(path, (p) =>
        set((s) => ({ loading: s.loading.map((l) => (l.path === path ? { ...l, progress: p } : l)) })),
      );
      const ws = activeWorkspace();
      const res = applyMathChannels(session, ws.math, ws.constants);
      set((s) => ({
        sessions: [...s.sessions, session],
        mathErrors: { ...s.mathErrors, [session.id]: res.errors },
        dataVersion: s.dataVersion + 1,
      }));
      // Select the fastest lap — valid or not: as reference for the first session, as an overlay for later ones.
      const fl = fastestLap(session, false) ?? session.laps[0];
      if (fl) {
        const key = lapKey({ sessionId: session.id, lapIndex: fl.index });
        if (!get().refKey) selectLap(key, 'replace');
        else selectLap(key, 'add');
      }
      rememberRecent(path);
      cacheSessionInfo(session);
      if (session.warnings.length) toast(session.warnings.slice(0, 2).join(' '), 'info', 6000);
    } catch (e) {
      toast(`Could not open ${name}: ${(e as Error).message}`, 'error', 8000);
    } finally {
      set((s) => ({ loading: s.loading.filter((l) => l.path !== path) }));
    }
  }
}

function rememberRecent(path: string) {
  const recent = [path, ...get().settings.recent.filter((p) => p !== path)].slice(0, 15);
  updateSettings({ recent, lastBrowsePath: dirName(path) });
}

function cacheSessionInfo(s: Session) {
  const fl = fastestLap(s, true);
  const valid = fl && !fl.invalid ? fl : undefined;
  const ideal = theoreticalBest(s);
  set((st) => ({
    sessionCache: {
      ...st.sessionCache,
      [s.path]: {
        mtime: s.fileMtime,
        size: s.fileSize,
        bestValid: valid?.time ?? null,
        bestValidNumber: valid?.number ?? null,
        ideal: ideal?.time ?? null,
        invalidLaps: s.laps.filter((l) => l.invalid).length,
      },
    },
  }));
  saveCache();
}

/** Move a loaded session to another position (the order of the Sessions & laps list, stint reports…). */
export function moveSession(id: string, toIndex: number) {
  set((s) => {
    const from = s.sessions.findIndex((x) => x.id === id);
    if (from < 0) return {};
    const sessions = s.sessions.slice();
    const [m] = sessions.splice(from, 1);
    sessions.splice(Math.max(0, Math.min(sessions.length, toIndex)), 0, m);
    return { sessions, dataVersion: s.dataVersion + 1 };
  });
}

export function closeSession(id: string) {
  set((s) => {
    const laps = s.laps.filter((l) => parseLapKey(l.key).sessionId !== id);
    const refKey = laps.some((l) => l.key === s.refKey) ? s.refKey : laps[0]?.key ?? null;
    return { sessions: s.sessions.filter((x) => x.id !== id), laps, refKey, dataVersion: s.dataVersion + 1 };
  });
}

export function closeAllSessions() {
  set((s) => ({ sessions: [], laps: [], refKey: null, dataVersion: s.dataVersion + 1 }));
}

// ---------------------------------------------------------------------------------------------
// Lap selection
// ---------------------------------------------------------------------------------------------

export function selectLap(key: string, mode: 'replace' | 'toggle' | 'add' | 'reference') {
  set((s) => {
    let laps = s.laps;
    let refKey = s.refKey;
    const has = laps.some((l) => l.key === key);
    const prevColor = laps.find((l) => l.key === key)?.color;
    const freeSlot = () => {
      const used = new Set(laps.map((l) => l.slot));
      for (let i = 0; i < 64; i++) if (!used.has(i)) return i;
      return laps.length;
    };
    if (mode === 'replace') {
      laps = [{ key, slot: 0, color: prevColor }];
      refKey = key;
    } else if (mode === 'toggle') {
      if (has) {
        if (laps.length === 1) return {};
        laps = laps.filter((l) => l.key !== key);
        if (refKey === key) refKey = laps[0]?.key ?? null;
      } else {
        laps = [...laps, { key, slot: freeSlot() }];
        refKey ??= key;
      }
    } else if (mode === 'add') {
      if (!has) laps = [...laps, { key, slot: freeSlot() }];
      refKey ??= key;
    } else if (mode === 'reference') {
      if (!has) laps = [...laps, { key, slot: freeSlot() }];
      refKey = key;
    }
    return { laps, refKey, measure: null };
  });
}

export function setLapColor(key: string, color: string | undefined) {
  set((s) => ({ laps: s.laps.map((l) => (l.key === key ? { ...l, color } : l)), dataVersion: s.dataVersion + 1 }));
}

export function clearOverlays() {
  const { refKey } = get();
  if (refKey) set((s) => ({ laps: s.laps.filter((l) => l.key === refKey) }));
}

export function fastestAsReference() {
  const s = get().sessions[0];
  if (!s) return;
  const fl = fastestLap(s, false);
  if (fl) selectLap(lapKey({ sessionId: s.id, lapIndex: fl.index }), 'reference');
}

/** Step the reference lap to the previous/next lap of the same session. */
export function stepReferenceLap(dir: -1 | 1) {
  const ref = refLap();
  if (!ref) return;
  const laps = ref.session.laps;
  const idx = ref.lap.index === -1 ? (dir > 0 ? -1 : laps.length) : ref.lap.index;
  const next = laps[idx + dir];
  if (!next) return;
  const newKey = lapKey({ sessionId: ref.session.id, lapIndex: next.index });
  set((s) => {
    if (s.laps.some((l) => l.key === newKey)) return { refKey: newKey };
    return { laps: s.laps.map((l) => (l.key === s.refKey ? { ...l, key: newKey } : l)), refKey: newKey };
  });
}

export function selectWholeSession(sessionId: string) {
  selectLap(lapKey({ sessionId, lapIndex: -1 }), 'replace');
  set({ zoom: null, xMode: 'time' });
}

// ---------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------

/** While a lap plays back, only playback moves the cursor or zoom; anything else is ignored. */
function blockedByPlayback(what: string): boolean {
  if (!get().playback.playing) return false;
  const now = performance.now();
  if (now - lastPlaybackHint > 3000) {
    lastPlaybackHint = now;
    toast(`Pause playback to ${what}.`, 'info', 1600);
  }
  return true;
}
let lastPlaybackHint = 0;

export function setCursor(x: number | null) {
  const s = get();
  if (s.datum || blockedByPlayback('move the cursor')) return;
  if (s.cursor !== x) set({ cursor: x });
}

// ---------------------------------------------------------------------------------------------
// Lap playback
// ---------------------------------------------------------------------------------------------

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4];
let playFrame = 0;

/**
 * Play the reference lap: the cursor advances in real time (× speed) from where it is (or the lap
 * start), so every graph, map, gauge and input moves with it. The zoomed graphs page along to keep
 * the cursor in view. While it plays, nothing else can move the cursor or change the zoom — only pause.
 */
export function togglePlayback() {
  const s = get();
  if (s.playback.playing) return stopPlayback();
  const ref = refLap(s);
  if (!ref) return toast('Select a lap to play it back.', 'info', 2000);
  const lap = ref.lap;
  let t = s.cursor != null ? xToTime(lap, s.cursor, s.xMode) : lap.start;
  if (!(t >= lap.start && t < lap.end - 0.05)) t = lap.start;
  set({ datum: false, playback: { ...s.playback, playing: true } });
  let last = performance.now();
  const step = (now: number) => {
    const st = get();
    if (!st.playback.playing) return;
    const r = refLap(st);
    if (!r || r.key !== ref.key) return stopPlayback();
    t += Math.min(0.1, (now - last) / 1000) * st.playback.speed;
    last = now;
    if (t >= lap.end) {
      t = lap.end;
      stopPlayback();
    }
    const x = timeToX(lap, t, st.xMode);
    set({ cursor: x });
    // Keep the cursor in view when zoomed: page so it sits near the left of the window.
    if (st.zoom && (x > st.zoom[1] || x < st.zoom[0])) {
      const span = st.zoom[1] - st.zoom[0];
      applyZoom([x - span * 0.1, x + span * 0.9]);
    }
    if (get().playback.playing) playFrame = requestAnimationFrame(step);
  };
  playFrame = requestAnimationFrame(step);
}

export function stopPlayback() {
  cancelAnimationFrame(playFrame);
  set((s) => ({ playback: { ...s.playback, playing: false } }));
}

export function setPlaybackSpeed(speed: number) {
  set((s) => ({ playback: { ...s.playback, speed } }));
}

/** Pin the cursor where it is (datum), or release it. */
export function toggleDatum() {
  const s = get();
  if (s.datum) {
    set({ datum: false });
    toast('Datum released — the cursor follows you again', 'info', 1800);
    return;
  }
  if (s.cursor == null) return toast('Place the cursor on a graph or map first, then set the datum.', 'info', 2500);
  set({ datum: true });
  toast('Datum set — the cursor stays here while you look around (press again to release)', 'info', 2500);
}
export function setZoom(z: [number, number] | null) {
  if (blockedByPlayback('zoom')) return;
  applyZoom(z);
}

/** Set the zoom (clamped to the laps' extent). Playback uses this directly to page along the lap. */
function applyZoom(z: [number, number] | null) {
  if (z) {
    const [a, b] = xExtent();
    let [x0, x1] = z[0] <= z[1] ? z : [z[1], z[0]];
    const minSpan = get().xMode === 'time' ? 0.05 : 2;
    if (x1 - x0 < minSpan) {
      const c = (x0 + x1) / 2;
      x0 = c - minSpan / 2;
      x1 = c + minSpan / 2;
    }
    if (x0 <= a && x1 >= b) z = null;
    else z = [Math.max(a - (b - a) * 0.05, x0), Math.min(b + (b - a) * 0.05, x1)];
  }
  set({ zoom: z });
}
export function setMeasure(m: [number, number] | null) {
  if (m && blockedByPlayback('measure a range')) return;
  set({ measure: m });
}
export function setHighlight(h: { entry: number; exit: number } | null) {
  const cur = get().highlight;
  if (h === cur || (h && cur && h.entry === cur.entry && h.exit === cur.exit)) return;
  set({ highlight: h });
}

/** Reset view (Esc or W): show the whole of the selected laps and clear any range measurement. */
export function resetView() {
  if (blockedByPlayback('reset the view')) return;
  set({ zoom: null, measure: null });
}

export function setXMode(mode: XMode) {
  const s = get();
  if (s.xMode === mode || blockedByPlayback('switch between time and distance')) return;
  const ref = refLap(s);
  const conv = (x: number) => (ref ? timeToX(ref.lap, xToTime(ref.lap, x, s.xMode), mode) : x);
  set({
    xMode: mode,
    zoom: s.zoom && ref ? [conv(s.zoom[0]), conv(s.zoom[1])] : null,
    cursor: s.cursor != null && ref ? conv(s.cursor) : null,
    measure: null,
  });
}

// ---------------------------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------------------------

function commitWorkspace(ws: Workspace) {
  ws = { ...ws, updatedAt: Date.now() };
  set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === ws.id ? ws : w)) }));
  saveWorkspace(ws);
  return ws;
}

function uniqueWorkspaceName(base: string) {
  const names = new Set(get().workspaces.map((w) => w.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

export interface EditOpts {
  label?: string;
  /** false for view-only changes (e.g. switching tabs) that shouldn't be undo steps. */
  history?: boolean;
}

export function updateWorkspace(fn: (ws: Workspace) => Workspace, opts: EditOpts = {}) {
  const ws = activeWorkspace();
  if (!ws) return;
  if (ws.locked) {
    if (opts.history === false) {
      set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === ws.id ? fn(w) : w)) }));
      return;
    }
    // Copy-on-write: built-in defaults stay pristine; edits continue in a personal copy.
    recordHistory(opts.label ?? 'Edit');
    const now = Date.now();
    const copy: Workspace = { ...structuredClone(ws), id: uid('ws'), name: uniqueWorkspaceName(`My ${ws.name}`), locked: false, createdAt: now, updatedAt: now };
    const edited = fn(copy);
    set((s) => ({ workspaces: [...s.workspaces, edited], settings: { ...s.settings, activeWorkspaceId: edited.id } }));
    saveSettings();
    pt().saveWorkspace(edited);
    toast(`"${ws.name}" is a read-only default, so your change was saved in a new workspace, "${edited.name}".`, 'info', 6500);
    return;
  }
  if (opts.history !== false) recordHistory(opts.label ?? 'Edit');
  commitWorkspace(fn(ws));
}

export function updateSheet(fn: (sh: Worksheet) => Worksheet, opts: EditOpts = {}) {
  updateWorkspace((ws) => {
    const i = Math.min(ws.activeSheet, ws.worksheets.length - 1);
    const sheets = ws.worksheets.slice();
    sheets[i] = fn(sheets[i]);
    return { ...ws, worksheets: sheets };
  }, opts);
}

export function setActiveSheet(index: number) {
  updateWorkspace((ws) => ({ ...ws, activeSheet: Math.max(0, Math.min(ws.worksheets.length - 1, index)) }), { history: false });
  set({ activeComponentId: null });
}

/** Deep-copy a worksheet with fresh ids. */
function cloneSheet(src: Worksheet, name?: string): Worksheet {
  const idMap: Record<string, string> = {};
  const components: Record<string, ComponentConfig> = {};
  for (const [id, c] of Object.entries(src.components)) {
    const nid = uid('c');
    idMap[id] = nid;
    components[nid] = { ...structuredClone(c), id: nid };
  }
  return { id: uid('w'), name: name ?? src.name, layout: cloneLayout(src.layout, idMap), components };
}

export function addWorksheet(name?: string) {
  updateWorkspace(
    (ws) => {
      const c = createComponent('graph');
      const sheet: Worksheet = {
        id: uid('w'),
        name: name || `Sheet ${ws.worksheets.length + 1}`,
        layout: { kind: 'leaf', id: uid('l'), componentId: c.id },
        components: { [c.id]: c },
      };
      return { ...ws, worksheets: [...ws.worksheets, sheet], activeSheet: ws.worksheets.length };
    },
    { label: 'Add worksheet' },
  );
}

export function duplicateWorksheet(index: number) {
  updateWorkspace(
    (ws) => {
      const copy = cloneSheet(ws.worksheets[index], ws.worksheets[index].name + ' copy');
      const sheets = ws.worksheets.slice();
      sheets.splice(index + 1, 0, copy);
      return { ...ws, worksheets: sheets, activeSheet: index + 1 };
    },
    { label: 'Duplicate worksheet' },
  );
}

export function renameWorksheet(index: number, name: string) {
  updateWorkspace((ws) => ({ ...ws, worksheets: ws.worksheets.map((w, i) => (i === index ? { ...w, name } : w)) }), { label: 'Rename worksheet' });
}

export function deleteWorksheet(index: number) {
  updateWorkspace(
    (ws) => {
      if (ws.worksheets.length <= 1) return ws;
      const sheets = ws.worksheets.filter((_, i) => i !== index);
      return { ...ws, worksheets: sheets, activeSheet: Math.min(ws.activeSheet, sheets.length - 1) };
    },
    { label: 'Delete worksheet' },
  );
}

export function moveWorksheet(from: number, to: number) {
  updateWorkspace(
    (ws) => {
      const sheets = ws.worksheets.slice();
      const [m] = sheets.splice(from, 1);
      sheets.splice(to, 0, m);
      return { ...ws, worksheets: sheets, activeSheet: to };
    },
    { label: 'Move worksheet' },
  );
}

/** Replace a worksheet with the Starter version of the same name. */
export function resetSheetToStarter(index: number) {
  const ws = activeWorkspace();
  const target = ws.worksheets[index];
  const starterSheet = starterWorkspace().worksheets.find((s) => s.name.toLowerCase() === target?.name.toLowerCase());
  if (!target || !starterSheet) {
    toast(`The Starter workspace has no worksheet called "${target?.name}".`, 'info');
    return;
  }
  updateWorkspace((w) => ({ ...w, worksheets: w.worksheets.map((s, i) => (i === index ? cloneSheet(starterSheet) : s)) }), { label: 'Reset worksheet' });
  toast(`"${target.name}" reset to the Starter layout (Ctrl/⌘+Z to undo)`, 'success', 3000);
}

/** Restore the current workspace's worksheets and math to the Starter versions. */
export function revertWorkspaceToStarter() {
  const ws = activeWorkspace();
  if (ws.locked) return toast('This is the Starter workspace already.', 'info');
  const st = starterWorkspace();
  updateWorkspace(
    (w) => ({ ...w, worksheets: st.worksheets.map((s) => cloneSheet(s)), activeSheet: 0, math: structuredClone(st.math), constants: [], channelProps: {} }),
    { label: 'Revert to Starter' },
  );
  recomputeMath();
  toast(`"${ws.name}" reverted to the Starter layout (Ctrl/⌘+Z to undo)`, 'success', 3000);
}

export function addComponent(type: ComponentType, targetId: string | null = null, zone: DropZone = 'right', patch: Partial<ComponentConfig> = {}) {
  const c = createComponent(type, patch);
  updateSheet(
    (sh) => ({
      ...sh,
      components: { ...sh.components, [c.id]: c },
      layout: insertComponent(sh.layout, targetId, c.id, zone),
    }),
    { label: 'Add component' },
  );
  set({ activeComponentId: c.id });
  return c.id;
}

// ---- copy / paste components ----

const COMPONENT_LABEL = (type: ComponentType) => COMPONENT_CATALOG.find((m) => m.type === type)?.label ?? 'component';

/** The last copied component (also put on the system clipboard as JSON, for pasting in another window). */
let copiedComponent: ComponentConfig | null = null;
const CLIP_KIND = 'project-trace-component';

/** Copy a component (its type and every setting). */
export function copyComponent(id: string | null = get().activeComponentId) {
  const c = id ? activeSheet()?.components[id] : undefined;
  if (!c) return toast('Click a component first, then copy it.', 'info', 2000);
  copiedComponent = structuredClone(c);
  navigator.clipboard?.writeText(JSON.stringify({ kind: CLIP_KIND, component: c })).catch(() => {});
  toast(`Copied “${c.title || COMPONENT_LABEL(c.type)}” — paste with Ctrl/⌘+V`, 'success', 1800);
}

/** Paste the copied component beside `targetId` (or into an empty worksheet). */
export async function pasteComponent(targetId: string | null = get().activeComponentId) {
  let src = copiedComponent;
  if (!src) {
    // Copied in another Project-Trace window: read it back from the system clipboard.
    try {
      const data = JSON.parse(await navigator.clipboard.readText());
      if (data?.kind === CLIP_KIND && data.component?.type) src = data.component as ComponentConfig;
    } catch {
      /* nothing usable on the clipboard */
    }
  }
  if (!src) return toast('Nothing to paste — copy a component first (right-click → Copy, or Ctrl/⌘+C).', 'info', 2400);
  const c = { ...structuredClone(src), id: uid('c') } as ComponentConfig;
  const sheet = activeSheet();
  const target = targetId && sheet?.components[targetId] ? targetId : null;
  updateSheet(
    (sh) => ({ ...sh, components: { ...sh.components, [c.id]: c }, layout: insertComponent(sh.layout, target, c.id, 'right') }),
    { label: 'Paste component' },
  );
  set({ activeComponentId: c.id });
}

/** Copy and paste in one go: a duplicate beside the original. */
export function duplicateComponent(id: string | null = get().activeComponentId) {
  const c = id ? activeSheet()?.components[id] : undefined;
  if (!c) return toast('Click a component first, then duplicate it.', 'info', 2000);
  const prev = copiedComponent;
  copiedComponent = structuredClone(c);
  pasteComponent(id);
  copiedComponent = prev;
}

export function removeComponentById(id: string) {
  updateSheet(
    (sh) => {
      const components = { ...sh.components };
      delete components[id];
      return { ...sh, components, layout: removeComponent(sh.layout, id) };
    },
    { label: 'Remove component' },
  );
  if (get().activeComponentId === id) set({ activeComponentId: null });
}

export function updateComponent(id: string, patch: Partial<ComponentConfig> | ((c: ComponentConfig) => ComponentConfig), label = 'Edit component') {
  updateSheet(
    (sh) => {
      const cur = sh.components[id];
      if (!cur) return sh;
      const next = typeof patch === 'function' ? patch(cur) : ({ ...cur, ...patch } as ComponentConfig);
      return { ...sh, components: { ...sh.components, [id]: next } };
    },
    { label },
  );
}

export function moveComponentTo(srcId: string, targetId: string, zone: DropZone) {
  updateSheet((sh) => ({ ...sh, layout: moveComponent(sh.layout, srcId, targetId, zone) }), { label: 'Move component' });
}

export function setSplitSizes(splitId: string, sizes: number[]) {
  updateSheet((sh) => ({ ...sh, layout: setSizes(sh.layout, splitId, sizes) }), { label: 'Resize' });
}

export function setActiveWorkspace(id: string) {
  updateSettings({ activeWorkspaceId: id });
  set({ activeComponentId: null });
  recomputeMath();
}

export function createWorkspace(kind: 'starter' | 'blank' | 'duplicate', name?: string) {
  recordHistory('New workspace');
  let ws: Workspace;
  const now = Date.now();
  if (kind === 'duplicate') {
    const src = activeWorkspace();
    ws = { ...structuredClone(src), id: uid('ws'), name: uniqueWorkspaceName(name || src.name + ' copy'), locked: false, createdAt: now, updatedAt: now };
    delete ws.locked;
  } else ws = kind === 'starter' ? buildDefaultWorkspace(uniqueWorkspaceName(name || 'My Workspace')) : buildBlankWorkspace(uniqueWorkspaceName(name || 'Blank workspace'));
  set((s) => ({ workspaces: [...s.workspaces, ws] }));
  pt().saveWorkspace(ws);
  setActiveWorkspace(ws.id);
}

/** Save the current workspace to its file now (workspaces also save automatically). Defaults → Save as. */
export async function saveCurrentWorkspace() {
  const ws = activeWorkspace();
  if (!ws) return;
  if (ws.locked) return saveWorkspaceAs();
  clearTimeout(timers.get('ws:' + ws.id));
  const file = await pt().saveWorkspace(ws);
  toast(`Saved "${ws.name}"${file ? ` to ${file}` : ''}`, 'success', 3500);
}

/** Save a copy of the current workspace under a new name (and switch to it). */
export async function saveWorkspaceAs(name?: string) {
  const ws = activeWorkspace();
  if (!ws) return;
  const n = name ?? (await promptName('Save workspace as', ws.locked ? `My ${ws.name}` : `${ws.name} copy`));
  if (!n) return;
  createWorkspace('duplicate', n);
  const copy = activeWorkspace();
  const file = await pt().saveWorkspace(copy);
  toast(`Saved "${copy.name}"${file ? ` to ${file}` : ''}`, 'success', 3500);
}

/** In-app name prompt (set by the UI layer, which owns the prompt dialog). */
let promptName: (title: string, value: string) => Promise<string | null> = async () => null;
export function setNamePrompt(fn: typeof promptName) {
  promptName = fn;
}

export function openWorkspacesFolder() {
  pt().openWorkspacesDir();
}

export function renameWorkspace(id: string, name: string) {
  const ws = get().workspaces.find((w) => w.id === id);
  if (!ws) return;
  if (ws.locked) return toast(`"${ws.name}" is a built-in default and can’t be renamed — use Save as.`, 'info');
  recordHistory('Rename workspace');
  commitWorkspace({ ...ws, name });
}

export function deleteWorkspace(id: string) {
  const { workspaces } = get();
  const ws = workspaces.find((w) => w.id === id);
  if (!ws) return;
  if (ws.locked) return toast(`"${ws.name}" is a built-in default and can’t be deleted.`, 'info');
  if (workspaces.filter((w) => !w.locked).length <= 1) return toast('You need at least one personal workspace.', 'info');
  recordHistory('Delete workspace');
  set({ workspaces: workspaces.filter((w) => w.id !== id) });
  cancelSave(id);
  pt().deleteWorkspace(id);
  if (get().settings.activeWorkspaceId === id) setActiveWorkspace(get().workspaces.find((w) => !w.locked)!.id);
}

const fileSafe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim() || 'export';

export async function exportWorkspace() {
  const ws = activeWorkspace();
  const p = await pt().saveFile(`${fileSafe(ws.name)}.ptw.json`, [{ name: 'Project-Trace workspace', extensions: ['json'] }], JSON.stringify({ ...ws, locked: undefined }, null, 2));
  if (p) toast(`Workspace exported to ${p}`, 'success');
}

export async function importWorkspace() {
  const data = await pt().openJson();
  if (!data) return;
  if (data.kind === 'project-trace-worksheet') return importWorksheetData(data);
  if (!Array.isArray(data.worksheets)) {
    toast('That file is not a Project-Trace workspace.', 'error');
    return;
  }
  recordHistory('Import workspace');
  const ws: Workspace = {
    ...data,
    id: uid('ws'),
    locked: false,
    name: uniqueWorkspaceName(data.name ? `${data.name} (imported)` : 'Imported workspace'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  ws.math ??= [];
  ws.constants ??= [];
  ws.channelProps ??= {};
  set((s) => ({ workspaces: [...s.workspaces, ws] }));
  pt().saveWorkspace(ws);
  setActiveWorkspace(ws.id);
  toast(`Imported "${ws.name}"`, 'success');
}

// ---- worksheet library, export & import ----

export function saveSheetToLibrary(index: number, name: string) {
  const sheet = activeWorkspace().worksheets[index];
  if (!sheet) return;
  const entry: SavedSheet = { id: uid('lib'), name, savedAt: Date.now(), sheet: structuredClone({ ...sheet, name }) };
  set((s) => ({ library: [...s.library.filter((l) => l.name !== name), entry] }));
  saveLibrary();
  toast(`Saved "${name}" to your worksheet library`, 'success', 2500);
}

export function insertLibrarySheet(id: string) {
  const entry = get().library.find((l) => l.id === id);
  if (!entry) return;
  updateWorkspace((ws) => ({ ...ws, worksheets: [...ws.worksheets, cloneSheet(entry.sheet, entry.name)], activeSheet: ws.worksheets.length }), {
    label: 'Insert worksheet',
  });
}

export function deleteLibrarySheet(id: string) {
  set((s) => ({ library: s.library.filter((l) => l.id !== id) }));
  saveLibrary();
}

export async function exportWorksheet(index: number) {
  const sheet = activeWorkspace().worksheets[index];
  if (!sheet) return;
  const p = await pt().saveFile(
    `${fileSafe(sheet.name)}.ptsheet.json`,
    [{ name: 'Project-Trace worksheet', extensions: ['json'] }],
    JSON.stringify({ kind: 'project-trace-worksheet', version: 1, sheet }, null, 2),
  );
  if (p) toast(`Worksheet exported to ${p}`, 'success');
}

function importWorksheetData(data: { sheet?: Worksheet }) {
  const sheet = data.sheet;
  if (!sheet || !sheet.components) return toast('That file is not a Project-Trace worksheet.', 'error');
  updateWorkspace((ws) => ({ ...ws, worksheets: [...ws.worksheets, cloneSheet(sheet)], activeSheet: ws.worksheets.length }), { label: 'Import worksheet' });
  toast(`Imported worksheet "${sheet.name}"`, 'success');
}

export async function importWorksheet() {
  const data = await pt().openJson();
  if (data) importWorksheetData(data.kind === 'project-trace-worksheet' ? data : { sheet: data.components ? data : undefined });
}

export function setChannelProps(name: string, patch: Partial<ChannelProps> | null) {
  updateWorkspace(
    (ws) => {
      const cp = { ...ws.channelProps };
      if (patch === null) delete cp[name];
      else cp[name] = { ...cp[name], ...patch };
      return { ...ws, channelProps: cp };
    },
    { label: 'Channel properties' },
  );
  set((s) => ({ dataVersion: s.dataVersion + 1 }));
}

// ---------------------------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------------------------

export function recomputeMath() {
  const ws = activeWorkspace();
  if (!ws) return;
  const mathErrors: Record<string, Record<string, string>> = {};
  for (const s of get().sessions) mathErrors[s.id] = applyMathChannels(s, ws.math, ws.constants).errors;
  set((s) => ({ mathErrors, dataVersion: s.dataVersion + 1 }));
}

export function setMathChannels(math: MathChannelDef[], constants?: MathConstant[]) {
  // Math channels keep their id when renamed: carry each rename through graphs, components, channel
  // properties and other expressions so nothing that used the old name breaks.
  const before = new Map(activeWorkspace().math.map((d) => [d.id, d.name.trim()]));
  const renames: RenameMap = new Map();
  for (const d of math) {
    const old = before.get(d.id);
    const now = d.name.trim();
    if (old && now && old !== now) renames.set(old, now);
  }
  updateWorkspace((ws) => ({ ...renameChannelsInWorkspace(ws, renames, math), constants: constants ?? ws.constants }), { label: 'Math channels' });
  recomputeMath();
  if (renames.size) toast(`Renamed ${[...renames].map(([a, b]) => `"${a}" → "${b}"`).join(', ')} everywhere it was used`, 'success', 3500);
}

// ---------------------------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------------------------

export function setNote(fileName: string, text: string) {
  set((s) => ({ notes: { ...s.notes, [fileName]: text } }));
  saveNotes();
}

export function bumpData() {
  set((s) => ({ dataVersion: s.dataVersion + 1 }));
}
