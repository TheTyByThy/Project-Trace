// Central application state (zustand). High-frequency values (cursor, zoom) live here too; canvas
// components subscribe imperatively so moving the cursor never re-renders the React tree.

import { create } from 'zustand';
import { baseName, dirName, pt, type AppInfo } from '../core/bridge';
import { lapXRange, timeToX, xToTime } from '../core/axis';
import { lapColor, type Theme } from '../core/colors';
import { applyMathChannels, type MathChannelDef, type MathConstant } from '../core/math/evaluate';
import { fastestLap, getLap, theoreticalBest } from '../core/session';
import { lapKey, parseLapKey, type Lap, type Session, type XMode } from '../core/types';
import { DEFAULT_UNITS, type UnitPrefs } from '../core/units';
import { createComponent } from './components';
import { buildBlankWorkspace, buildDefaultWorkspace } from './defaultWorkspace';
import { cloneLayout, insertComponent, moveComponent, removeComponent, setSizes, type DropZone } from './layout';
import { loadSessionFile } from './loader';
import { uid, type ChannelProps, type ComponentConfig, type ComponentType, type Workspace, type Worksheet } from './workspace';

export interface TrackSection {
  name: string;
  dist: number;
}

export interface TrackProfile {
  rotation: number;
  mirror: boolean;
  sections: TrackSection[];
  cornerNames: Record<string, string>;
}

export interface Settings {
  telemetryRoot: string;
  lastBrowsePath: string;
  recent: string[];
  units: UnitPrefs;
  theme: Theme;
  cursorMode: 'click' | 'hover';
  gameClock: 'track' | 'utc';
  trackZones: Record<string, string>;
  activeWorkspaceId: string;
  trackProfiles: Record<string, TrackProfile>;
  hideConstant: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  overlayStyle: 'auto' | 'lap' | 'channel';
  showBrowserOnLaunch: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  telemetryRoot: '',
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
  inspectorWidth: 320,
  overlayStyle: 'auto',
  showBrowserOnLaunch: true,
};

export const emptyTrackProfile = (): TrackProfile => ({ rotation: 0, mirror: false, sections: [], cornerNames: {} });

export interface LapSel {
  key: string;
  slot: number;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface UiState {
  sidebar: boolean;
  inspector: boolean;
  browser: boolean;
  math: boolean;
  settings: boolean;
  shortcuts: boolean;
  palette: boolean;
  addComponent: boolean;
  sidebarTab: 'laps' | 'channels';
}

export interface SessionCacheEntry {
  mtime: number;
  size: number;
  bestValid: number | null;
  bestValidNumber: number | null;
  ideal: number | null;
  invalidLaps: number;
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
  measure: [number, number] | null;
  workspaces: Workspace[];
  activeComponentId: string | null;
  ui: UiState;
  toasts: Toast[];
  mathErrors: Record<string, Record<string, string>>;
  notes: Record<string, string>;
  sessionCache: Record<string, SessionCacheEntry>;
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
  measure: null,
  workspaces: [],
  activeComponentId: null,
  ui: { sidebar: true, inspector: true, browser: false, math: false, settings: false, shortcuts: false, palette: false, addComponent: false, sidebarTab: 'laps' },
  toasts: [],
  mathErrors: {},
  notes: {},
  sessionCache: {},
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
const saveWorkspace = (ws: Workspace) => debounce('ws:' + ws.id, 600, () => pt().saveWorkspace(ws));
const saveCache = () => debounce('cache', 800, () => pt().setCache(get().sessionCache));
const saveNotes = () => debounce('notes', 600, () => pt().setNotes(get().notes));

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
    out.push({ key: l.key, session, lap, slot: l.slot, color: lapColor(l.slot, s.settings.theme), isRef: l.key === s.refKey });
  }
  out.sort((a, b) => (a.isRef === b.isRef ? 0 : a.isRef ? -1 : 1));
  return out;
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
  return get().settings.trackProfiles[venue] ?? emptyTrackProfile();
}

// ---------------------------------------------------------------------------------------------
// Actions
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
  if (patch.units || patch.theme) set((s) => ({ dataVersion: s.dataVersion + 1 }));
}

export function setTrackProfile(venue: string, patch: Partial<TrackProfile>) {
  const cur = trackProfile(venue);
  updateSettings({ trackProfiles: { ...get().settings.trackProfiles, [venue]: { ...cur, ...patch } } });
  set((s) => ({ dataVersion: s.dataVersion + 1 }));
}

export async function initApp() {
  const bridge = pt();
  const [info, rawSettings, list, cache, notes] = await Promise.all([
    bridge.appInfo(),
    bridge.getSettings(),
    bridge.listWorkspaces(),
    bridge.getCache(),
    bridge.getNotes(),
  ]);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(rawSettings ?? {}), units: { ...DEFAULT_UNITS, ...(rawSettings?.units ?? {}) } };
  if (!settings.telemetryRoot && info.defaultTelemetryRoot) settings.telemetryRoot = info.defaultTelemetryRoot;
  let workspaces = (list as Workspace[]).filter((w) => w && Array.isArray(w.worksheets));
  if (!workspaces.length) {
    const ws = buildDefaultWorkspace();
    workspaces = [ws];
    bridge.saveWorkspace(ws);
  }
  workspaces.sort((a, b) => a.createdAt - b.createdAt);
  if (!workspaces.some((w) => w.id === settings.activeWorkspaceId)) settings.activeWorkspaceId = workspaces[0].id;
  document.documentElement.dataset.theme = settings.theme;
  set({
    appInfo: info,
    settings,
    workspaces,
    sessionCache: cache ?? {},
    notes: notes ?? {},
    ready: true,
    ui: { ...get().ui, browser: !info.automation && settings.showBrowserOnLaunch },
  });
  bridge.setSettings(settings);
}

// ---- sessions ----

export async function openFiles(paths: string[], mode: 'replace' | 'add' = 'replace') {
  paths = paths.filter((p) => /\.(csv|txt|ld)$/i.test(p));
  if (!paths.length) return;
  if (mode === 'replace') {
    set({ sessions: [], laps: [], refKey: null, zoom: null, cursor: null, measure: null, mathErrors: {} });
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
      // Select the fastest lap: as reference for the first session, as an overlay for later ones.
      const fl = fastestLap(session) ?? session.laps[0];
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

export function closeSession(id: string) {
  set((s) => {
    const laps = s.laps.filter((l) => parseLapKey(l.key).sessionId !== id);
    const refKey = laps.some((l) => l.key === s.refKey) ? s.refKey : laps[0]?.key ?? null;
    return { sessions: s.sessions.filter((x) => x.id !== id), laps, refKey, dataVersion: s.dataVersion + 1 };
  });
}

// ---- lap selection ----

export function selectLap(key: string, mode: 'replace' | 'toggle' | 'add' | 'reference') {
  set((s) => {
    let laps = s.laps;
    let refKey = s.refKey;
    const has = laps.some((l) => l.key === key);
    const freeSlot = () => {
      const used = new Set(laps.map((l) => l.slot));
      for (let i = 0; i < 64; i++) if (!used.has(i)) return i;
      return laps.length;
    };
    if (mode === 'replace') {
      laps = [{ key, slot: 0 }];
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
    const zoomKeep = s.zoom;
    return { laps, refKey, zoom: zoomKeep, measure: null };
  });
}

export function clearOverlays() {
  const { refKey } = get();
  if (refKey) set((s) => ({ laps: s.laps.filter((l) => l.key === refKey) }));
}

export function fastestAsReference() {
  const s = get().sessions[0];
  if (!s) return;
  const fl = fastestLap(s);
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

// ---- view ----

export function setCursor(x: number | null) {
  if (get().cursor !== x) set({ cursor: x });
}
export function setZoom(z: [number, number] | null) {
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
  set({ measure: m });
}

export function setXMode(mode: XMode) {
  const s = get();
  if (s.xMode === mode) return;
  const ref = refLap(s);
  const conv = (x: number) => (ref ? timeToX(ref.lap, xToTime(ref.lap, x, s.xMode), mode) : x);
  set({
    xMode: mode,
    zoom: s.zoom && ref ? [conv(s.zoom[0]), conv(s.zoom[1])] : null,
    cursor: s.cursor != null && ref ? conv(s.cursor) : null,
    measure: null,
  });
}

// ---- workspaces ----

function commitWorkspace(ws: Workspace) {
  ws = { ...ws, updatedAt: Date.now() };
  set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === ws.id ? ws : w)) }));
  saveWorkspace(ws);
  return ws;
}

export function updateWorkspace(fn: (ws: Workspace) => Workspace) {
  const ws = activeWorkspace();
  if (ws) commitWorkspace(fn(ws));
}

export function updateSheet(fn: (sh: Worksheet) => Worksheet) {
  updateWorkspace((ws) => {
    const i = Math.min(ws.activeSheet, ws.worksheets.length - 1);
    const sheets = ws.worksheets.slice();
    sheets[i] = fn(sheets[i]);
    return { ...ws, worksheets: sheets };
  });
}

export function setActiveSheet(index: number) {
  updateWorkspace((ws) => ({ ...ws, activeSheet: Math.max(0, Math.min(ws.worksheets.length - 1, index)) }));
  set({ activeComponentId: null });
}

export function addWorksheet(name?: string) {
  updateWorkspace((ws) => {
    const c = createComponent('graph');
    const sheet: Worksheet = {
      id: uid('w'),
      name: name || `Sheet ${ws.worksheets.length + 1}`,
      layout: { kind: 'leaf', id: uid('l'), componentId: c.id },
      components: { [c.id]: c },
    };
    return { ...ws, worksheets: [...ws.worksheets, sheet], activeSheet: ws.worksheets.length };
  });
}

export function duplicateWorksheet(index: number) {
  updateWorkspace((ws) => {
    const src = ws.worksheets[index];
    const idMap: Record<string, string> = {};
    const components: Record<string, ComponentConfig> = {};
    for (const [id, c] of Object.entries(src.components)) {
      const nid = uid('c');
      idMap[id] = nid;
      components[nid] = { ...structuredClone(c), id: nid };
    }
    const copy: Worksheet = { id: uid('w'), name: src.name + ' copy', layout: cloneLayout(src.layout, idMap), components };
    const sheets = ws.worksheets.slice();
    sheets.splice(index + 1, 0, copy);
    return { ...ws, worksheets: sheets, activeSheet: index + 1 };
  });
}

export function renameWorksheet(index: number, name: string) {
  updateWorkspace((ws) => ({ ...ws, worksheets: ws.worksheets.map((w, i) => (i === index ? { ...w, name } : w)) }));
}

export function deleteWorksheet(index: number) {
  updateWorkspace((ws) => {
    if (ws.worksheets.length <= 1) return ws;
    const sheets = ws.worksheets.filter((_, i) => i !== index);
    return { ...ws, worksheets: sheets, activeSheet: Math.min(ws.activeSheet, sheets.length - 1) };
  });
}

export function moveWorksheet(from: number, to: number) {
  updateWorkspace((ws) => {
    const sheets = ws.worksheets.slice();
    const [m] = sheets.splice(from, 1);
    sheets.splice(to, 0, m);
    return { ...ws, worksheets: sheets, activeSheet: to };
  });
}

export function addComponent(type: ComponentType, targetId: string | null = null, zone: DropZone = 'right', patch: Partial<ComponentConfig> = {}) {
  const c = createComponent(type, patch);
  updateSheet((sh) => ({
    ...sh,
    components: { ...sh.components, [c.id]: c },
    layout: insertComponent(sh.layout, targetId, c.id, zone),
  }));
  set({ activeComponentId: c.id });
  return c.id;
}

export function removeComponentById(id: string) {
  updateSheet((sh) => {
    const components = { ...sh.components };
    delete components[id];
    return { ...sh, components, layout: removeComponent(sh.layout, id) };
  });
  if (get().activeComponentId === id) set({ activeComponentId: null });
}

export function updateComponent(id: string, patch: Partial<ComponentConfig> | ((c: ComponentConfig) => ComponentConfig)) {
  updateSheet((sh) => {
    const cur = sh.components[id];
    if (!cur) return sh;
    const next = typeof patch === 'function' ? patch(cur) : ({ ...cur, ...patch } as ComponentConfig);
    return { ...sh, components: { ...sh.components, [id]: next } };
  });
}

export function moveComponentTo(srcId: string, targetId: string, zone: DropZone) {
  updateSheet((sh) => ({ ...sh, layout: moveComponent(sh.layout, srcId, targetId, zone) }));
}

export function setSplitSizes(splitId: string, sizes: number[]) {
  updateSheet((sh) => ({ ...sh, layout: setSizes(sh.layout, splitId, sizes) }));
}

export function setActiveWorkspace(id: string) {
  updateSettings({ activeWorkspaceId: id });
  set({ activeComponentId: null });
  recomputeMath();
}

export function createWorkspace(kind: 'default' | 'blank' | 'duplicate', name?: string) {
  let ws: Workspace;
  if (kind === 'duplicate') {
    const src = activeWorkspace();
    ws = { ...structuredClone(src), id: uid('ws'), name: name || src.name + ' copy', createdAt: Date.now(), updatedAt: Date.now() };
  } else ws = kind === 'default' ? buildDefaultWorkspace(name) : buildBlankWorkspace(name);
  set((s) => ({ workspaces: [...s.workspaces, ws] }));
  pt().saveWorkspace(ws);
  setActiveWorkspace(ws.id);
}

export function renameWorkspace(id: string, name: string) {
  const ws = get().workspaces.find((w) => w.id === id);
  if (ws) commitWorkspace({ ...ws, name });
}

export function deleteWorkspace(id: string) {
  const { workspaces } = get();
  if (workspaces.length <= 1) {
    toast('You need at least one workspace.', 'info');
    return;
  }
  set({ workspaces: workspaces.filter((w) => w.id !== id) });
  pt().deleteWorkspace(id);
  if (get().settings.activeWorkspaceId === id) setActiveWorkspace(get().workspaces[0].id);
}

export async function exportWorkspace() {
  const ws = activeWorkspace();
  const p = await pt().saveFile(`${ws.name.replace(/[^\w\- ]+/g, '')}.ptw.json`, [{ name: 'Project-Trace workspace', extensions: ['json'] }], JSON.stringify(ws, null, 2));
  if (p) toast(`Workspace exported to ${p}`, 'success');
}

export async function importWorkspace() {
  const data = await pt().openJson();
  if (!data) return;
  if (!Array.isArray(data.worksheets)) {
    toast('That file is not a Project-Trace workspace.', 'error');
    return;
  }
  const ws: Workspace = { ...data, id: uid('ws'), name: data.name ? `${data.name} (imported)` : 'Imported workspace', createdAt: Date.now(), updatedAt: Date.now() };
  ws.math ??= [];
  ws.constants ??= [];
  ws.channelProps ??= {};
  set((s) => ({ workspaces: [...s.workspaces, ws] }));
  pt().saveWorkspace(ws);
  setActiveWorkspace(ws.id);
  toast(`Imported "${ws.name}"`, 'success');
}

export function setChannelProps(name: string, patch: Partial<ChannelProps> | null) {
  updateWorkspace((ws) => {
    const cp = { ...ws.channelProps };
    if (patch === null) delete cp[name];
    else cp[name] = { ...cp[name], ...patch };
    return { ...ws, channelProps: cp };
  });
  set((s) => ({ dataVersion: s.dataVersion + 1 }));
}

// ---- math ----

export function recomputeMath() {
  const ws = activeWorkspace();
  if (!ws) return;
  const mathErrors: Record<string, Record<string, string>> = {};
  for (const s of get().sessions) mathErrors[s.id] = applyMathChannels(s, ws.math, ws.constants).errors;
  set((s) => ({ mathErrors, dataVersion: s.dataVersion + 1 }));
}

export function setMathChannels(math: MathChannelDef[], constants?: MathConstant[]) {
  updateWorkspace((ws) => ({ ...ws, math, constants: constants ?? ws.constants }));
  recomputeMath();
}

// ---- notes ----

export function setNote(fileName: string, text: string) {
  set((s) => ({ notes: { ...s.notes, [fileName]: text } }));
  saveNotes();
}

export function bumpData() {
  set((s) => ({ dataVersion: s.dataVersion + 1 }));
}
