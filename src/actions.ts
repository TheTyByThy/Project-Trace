// App-level actions shared by menus, keyboard shortcuts and the command palette.

import { xToTime } from './core/axis';
import { pt } from './core/bridge';
import { sampleAt } from './core/channel';
import { lapDistAt, lapLabel } from './core/session';
import { formatLapTime, prettyCar, prettyTrack } from './core/format';
import { COMPONENT_CATALOG } from './state/components';
import {
  activeSheet,
  activeWorkspace,
  addComponent,
  addWorksheet,
  createWorkspace,
  deleteLibrarySheet,
  deleteWorksheet,
  deleteWorkspace,
  duplicateWorksheet,
  exportWorksheet,
  exportWorkspace,
  fastestAsReference,
  importWorksheet,
  importWorkspace,
  insertLibrarySheet,
  openFiles,
  openProperties,
  openWorkspacesFolder,
  redo,
  renameWorkspace,
  resetView,
  resetSheetToStarter,
  revertWorkspaceToStarter,
  saveCurrentWorkspace,
  saveSheetToLibrary,
  saveWorkspaceAs,
  selectedLaps,
  setActiveSheet,
  setActiveWorkspace,
  setCursor,
  setMarkersEverywhere,
  setSmoothing,
  setUi,
  setXMode,
  setZoom,
  stepReferenceLap,
  toast,
  PLAYBACK_SPEEDS,
  setPlaybackSpeed,
  toggleDatum,
  togglePlayback,
  toggleRefColors,
  undo,
  updateSheet,
  useStore,
  viewRange,
  xExtent,
  addCorner,
  clearOverlays,
  selectLap,
  selectWholeSession,
  setMeasure,
  setTrackProfile,
  setWorkingRotation,
  SMOOTH_PRESETS,
  trackProfile,
  trackRotation,
  updateSettings,
} from './state/store';
import { actionForCombo, comboFromEvent, shortcutHint, SHORTCUTS } from './shortcuts';
import type { GraphConfig, TrackMapConfig } from './state/workspace';
import { promptText } from './ui/overlays';

export function toggleVarianceAll() {
  const sheet = activeSheet();
  if (!sheet) return;
  const graphs = Object.values(sheet.components).filter((c): c is GraphConfig => c.type === 'graph');
  if (!graphs.length) return;
  const on = !graphs.every((g) => g.showVariance);
  updateSheet(
    (sh) => {
      const components = { ...sh.components };
      for (const g of graphs) components[g.id] = { ...g, showVariance: on };
      return { ...sh, components };
    },
    { label: 'Toggle variance' },
  );
  if (on && selectedLaps().length < 2) toast('Variance needs at least two laps — Ctrl/⌘+click another lap to overlay it.', 'info');
}

/** Sector/section or corner lines on every graph, track map and GPS track in the workspace. */
export function toggleMarkersAll(key: 'showSectors' | 'showCorners') {
  const ws = activeWorkspace();
  const all = ws.worksheets.flatMap((sh) => Object.values(sh.components)).filter((c) => c.type === 'graph' || c.type === 'trackmap' || c.type === 'gpstrack' || c.type === 'bars');
  if (!all.length) return;
  const on = !all.every((c) => (c as GraphConfig)[key]);
  setMarkersEverywhere({ [key]: on });
  toast(`${key === 'showSectors' ? 'Sector & split lines' : 'Corner lines'} ${on ? 'on' : 'off'}`, 'info', 1400);
}

export function toggleSmoothing() {
  const sm = useStore.getState().settings.smoothing;
  setSmoothing({ enabled: !sm.enabled });
  toast(!sm.enabled ? `Smoothing on (${Math.round(sm.seconds * 1000)} ms)` : 'Smoothing off — raw data', 'info', 1500);
}

export function moveCursor(frac: number) {
  const st = useStore.getState();
  const [a, b] = viewRange(st);
  const cur = st.cursor ?? (a + b) / 2;
  const next = Math.max(xExtent(st)[0], Math.min(xExtent(st)[1], cur + (b - a) * frac));
  setCursor(next);
  if (next < a || next > b) setZoom([next - (b - a) / 2, next + (b - a) / 2]);
}

export function zoomBy(f: number) {
  const st = useStore.getState();
  const [a, b] = viewRange(st);
  const c = st.cursor != null && st.cursor >= a && st.cursor <= b ? st.cursor : (a + b) / 2;
  setZoom([c - (c - a) * f, c + (b - c) * f]);
}

/** Export the visible range of the reference lap (graph channels on the active sheet) to CSV. */
export async function exportVisibleCsv() {
  const st = useStore.getState();
  const ref = selectedLaps(st)[0];
  if (!ref) return toast('Select a lap first.', 'info');
  const sheet = activeSheet(st);
  const names = new Set<string>();
  for (const c of Object.values(sheet?.components ?? {})) if (c.type === 'graph') c.panes.forEach((p) => p.channels.forEach((n) => names.add(n)));
  const chans = [...names].map((n) => ref.session.channels.get(n)).filter((c): c is NonNullable<typeof c> => !!c);
  if (!chans.length) return toast('No graph channels on this worksheet to export.', 'info');
  const [x0, x1] = viewRange(st);
  const ta = Math.max(ref.lap.start, xToTime(ref.lap, x0, st.xMode));
  const tb = Math.min(ref.lap.end, xToTime(ref.lap, x1, st.xMode));
  const rate = Math.max(...chans.map((c) => c.rate));
  const lines = [['Session Time', 'Lap Time', 'Lap Distance', ...chans.map((c) => c.name)].join(','), ['s', 's', 'm', ...chans.map((c) => c.unit)].join(',')];
  for (let t = ta; t <= tb; t += 1 / rate) {
    const row = [t.toFixed(4), (t - ref.lap.start).toFixed(4), lapDistAt(ref.lap, t).toFixed(2), ...chans.map((c) => sampleAt(c, t).toPrecision(7))];
    lines.push(row.join(','));
  }
  const name = `${ref.session.fileName.replace(/\.(csv|ld)$/i, '')}-lap${ref.lap.number}.csv`;
  const p = await pt().saveFile(name, [{ name: 'CSV', extensions: ['csv'] }], lines.join('\n'));
  if (p) toast(`Exported ${lines.length - 2} rows to ${p}`, 'success');
}

/** Save the worksheet on screen — exactly as shown — as a one-page PDF with a title line. */
export async function printWorksheetPdf() {
  const el = document.querySelector('.sheet-area');
  const sheet = activeSheet();
  if (!el || !sheet) return;
  const r = el.getBoundingClientRect();
  const ws = activeWorkspace();
  const ref = selectedLaps()[0];
  const tr = ref ? prettyTrack(ref.session.meta.venue) : null;
  const date = new Date();
  const subtitle = [
    tr ? `${tr.track}${tr.layout ? ` ${tr.layout}` : ''}` : '',
    ref ? prettyCar(ref.session.meta.vehicle) : '',
    ref ? `ref ${lapLabel(ref.lap)}${ref.lap.complete ? ` ${formatLapTime(ref.lap.time)}` : ''}` : '',
    date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
  ]
    .filter(Boolean)
    .join(' · ');
  const safe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
  const defaultName = `${[tr ? safe(tr.track) : '', safe(sheet.name), date.toISOString().slice(0, 10)].filter(Boolean).join('_')}.pdf`;
  const p = await pt().printSheetPdf({ rect: { x: r.left, y: r.top, width: r.width, height: r.height }, title: `${sheet.name} — ${ws.name}`, subtitle, defaultName });
  if (p) toast(`Saved ${p}`, 'success', 3500);
}

/** Capture the whole window (via the main process) and save it as a PNG. */
export async function saveScreenshot() {
  const png = await pt().capture();
  const p = await pt().saveFile(`project-trace-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, [{ name: 'PNG image', extensions: ['png'] }], png);
  if (p) toast(`Screenshot saved to ${p}`, 'success');
}

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Ask for a name and save a corner or split at the cursor, for the reference lap's track. */
export async function markAtCursor(kind: 'corner' | 'split') {
  const st = useStore.getState();
  const ref = selectedLaps(st)[0];
  if (!ref || st.cursor == null || ref.lap.index === -1) return toast('Place the cursor on a lap first.', 'info', 2000);
  const venue = ref.session.meta.venue;
  const dist = Math.round(lapDistAt(ref.lap, xToTime(ref.lap, st.cursor, st.xMode)));
  const prof = trackProfile(venue);
  if (kind === 'corner') {
    const name = await promptText(`Corner name at ${dist} m`, `T${prof.corners.length + 1}`);
    if (name) addCorner(venue, { name, dist });
  } else {
    const name = await promptText(`Split name at ${dist} m`, `Split ${prof.sections.length + 1}`);
    if (name) setTrackProfile(venue, { sections: [...prof.sections, { name, dist }].sort((a, b) => a.dist - b.dist) }, 'Add section');
  }
}

function stepPlaybackSpeed(dir: 1 | -1) {
  const cur = useStore.getState().playback.speed;
  const i = PLAYBACK_SPEEDS.indexOf(cur);
  const next = PLAYBACK_SPEEDS[Math.max(0, Math.min(PLAYBACK_SPEEDS.length - 1, (i < 0 ? 2 : i) + dir))];
  setPlaybackSpeed(next);
  toast(`Playback ${next}×`, 'info', 1000);
}

/** Step the smoothing amount through the top-bar presets (and switch smoothing on). */
function stepSmoothing(dir: 1 | -1) {
  const sm = useStore.getState().settings.smoothing;
  const i = SMOOTH_PRESETS.findIndex((p) => p >= sm.seconds - 1e-6);
  const next = SMOOTH_PRESETS[Math.max(0, Math.min(SMOOTH_PRESETS.length - 1, (i < 0 ? SMOOTH_PRESETS.length - 1 : i) + (sm.enabled ? dir : 0)))];
  setSmoothing({ enabled: true, seconds: next });
  toast(`Smoothing ${next < 1 ? `${Math.round(next * 1000)} ms` : `${next} s`}`, 'info', 1200);
}

const refVenue = () => selectedLaps()[0]?.session.meta.venue ?? '';

/** Gain/loss track maps on this worksheet: compare the next comparison lap with the reference. */
function cycleCompareLap() {
  const laps = selectedLaps();
  if (laps.length < 3) return toast('Select two or more comparison laps to switch between them.', 'info', 2200);
  const maps = Object.values(activeSheet()?.components ?? {}).filter((c): c is TrackMapConfig => c.type === 'trackmap' && c.colorBy === 'delta');
  if (!maps.length) return;
  const others = laps.slice(1);
  const cur = others.findIndex((l) => l.key === maps[0].compareKey);
  const next = others[(Math.max(0, cur) + 1) % others.length];
  updateSheet(
    (sh) => ({ ...sh, components: { ...sh.components, ...Object.fromEntries(maps.map((m) => [m.id, { ...m, compareKey: next.key }])) } }),
    { label: 'Compare lap' },
  );
  toast(`Gain / loss: ${lapLabel(next.lap)} vs reference`, 'info', 1400);
}

function stepSheet(dir: 1 | -1) {
  const ws = activeWorkspace();
  const n = ws.worksheets.length;
  setActiveSheet((ws.activeSheet + dir + n) % n);
}

/** What each bindable shortcut (src/shortcuts.ts) does. */
const SHORTCUT_ACTIONS: Record<string, () => void> = {
  'ws-save': () => saveCurrentWorkspace(),
  'toggle-sectors': () => toggleMarkersAll('showSectors'),
  'toggle-corners': () => toggleMarkersAll('showCorners'),
  'open-browser': () => setUi({ browser: true }),
  'open-files': () => handleMenuAction('open-files'),
  palette: () => setUi({ palette: !useStore.getState().ui.palette }),
  math: () => setUi({ math: true }),
  settings: () => setUi({ settings: true }),
  'export-csv': () => exportVisibleCsv(),
  screenshot: () => saveScreenshot(),
  'print-pdf': () => printWorksheetPdf(),
  shortcuts: () => setUi({ shortcuts: true }),
  'toggle-inspector': () => setUi({ inspector: !useStore.getState().ui.inspector }),
  'toggle-sidebar': () => setUi({ sidebar: !useStore.getState().ui.sidebar }),
  'toggle-x': () => setXMode(useStore.getState().xMode === 'time' ? 'distance' : 'time'),
  'toggle-variance': toggleVarianceAll,
  'toggle-smoothing': toggleSmoothing,
  'toggle-ref-colors': toggleRefColors,
  'fastest-lap': fastestAsReference,
  'prev-lap': () => stepReferenceLap(-1),
  'next-lap': () => stepReferenceLap(1),
  'reset-view': resetView,
  'toggle-datum': toggleDatum,
  'toggle-playback': togglePlayback,
  'playback-faster': () => stepPlaybackSpeed(1),
  'playback-slower': () => stepPlaybackSpeed(-1),
  'cursor-left': () => moveCursor(-0.005),
  'cursor-right': () => moveCursor(0.005),
  'cursor-left-big': () => moveCursor(-0.05),
  'cursor-right-big': () => moveCursor(0.05),
  'zoom-in': () => zoomBy(0.7),
  'zoom-out': () => zoomBy(1 / 0.7),
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`sheet-${i + 1}`, () => setActiveSheet(i)])),
  // No default key (bind them in the shortcut editor).
  'ws-save-as': () => saveWorkspaceAs(),
  'ws-open-folder': openWorkspacesFolder,
  'ws-import': () => importWorkspace(),
  'ws-export': () => exportWorkspace(),
  'open-properties': () => openProperties(),
  maximise: () => window.dispatchEvent(new Event('pt-maximise')),
  'x-time': () => setXMode('time'),
  'x-distance': () => setXMode('distance'),
  'smoothing-more': () => stepSmoothing(1),
  'smoothing-less': () => stepSmoothing(-1),
  'toggle-theme': () => updateSettings({ theme: useStore.getState().settings.theme === 'dark' ? 'light' : 'dark' }),
  'cycle-cursor-mode': () => {
    const order = ['click', 'scrub', 'hover'] as const;
    const next = order[(order.indexOf(useStore.getState().settings.cursorMode) + 1) % order.length];
    updateSettings({ cursorMode: next });
    toast(`Cursor: ${next === 'click' ? 'click to place, drag to zoom' : next === 'scrub' ? 'drag to scrub' : 'follows the mouse'}`, 'info', 1600);
  },
  'sidebar-laps': () => setUi({ sidebar: true, sidebarTab: 'laps' }),
  'sidebar-channels': () => setUi({ sidebar: true, sidebarTab: 'channels' }),
  'clear-overlays': clearOverlays,
  'swap-reference': () => {
    const second = selectedLaps()[1];
    if (second) selectLap(second.key, 'reference');
  },
  'whole-session': () => {
    const ref = selectedLaps()[0];
    if (ref) selectWholeSession(ref.session.id);
  },
  'clear-measure': () => setMeasure(null),
  'cursor-start': () => setCursor(xExtent()[0]),
  'cursor-end': () => setCursor(xExtent()[1]),
  'add-corner': () => markAtCursor('corner'),
  'add-split': () => markAtCursor('split'),
  'track-profile': () => setUi({ trackProfile: true }),
  'rotate-map': () => refVenue() && setWorkingRotation(refVenue(), trackRotation(refVenue()) + 90),
  'mirror-map': () => refVenue() && setTrackProfile(refVenue(), { mirror: !trackProfile(refVenue()).mirror }, 'Mirror track'),
  'cycle-compare': cycleCompareLap,
  'next-sheet': () => stepSheet(1),
  'prev-sheet': () => stepSheet(-1),
  'new-sheet': () => addWorksheet(),
  'duplicate-sheet': () => duplicateWorksheet(activeWorkspace().activeSheet),
  'rename-sheet': () => window.dispatchEvent(new Event('pt-rename-sheet')),
};

export function buildCommands(): Command[] {
  const st = useStore.getState();
  const ws = activeWorkspace();
  const k = (id: string) => shortcutHint(id, st.settings.shortcuts);
  const cmds: Command[] = [
    { id: 'browser', label: 'Open session browser', hint: k('open-browser'), run: () => setUi({ browser: true }) },
    { id: 'props', label: 'Properties pop-out for selected component', run: () => openProperties() },
    { id: 'insp', label: 'Toggle Properties side panel', hint: k('toggle-inspector'), run: () => setUi({ inspector: !useStore.getState().ui.inspector }) },
    { id: 'math', label: 'Math channels…', hint: k('math'), run: () => setUi({ math: true }) },
    { id: 'track', label: 'Track editor (corners, ranges, speed buckets, splits, rotation)…', hint: k('track-profile'), run: () => setUi({ trackProfile: true }) },
    { id: 'settings', label: 'Settings…', hint: k('settings'), run: () => setUi({ settings: true }) },
    { id: 'undo', label: 'Undo', hint: 'Ctrl/⌘+Z', run: undo },
    { id: 'redo', label: 'Redo', hint: 'Ctrl/⌘+Y', run: redo },
    { id: 'time', label: 'X axis: time', run: () => setXMode('time') },
    { id: 'dist', label: 'X axis: distance', run: () => setXMode('distance') },
    { id: 'smooth', label: 'Toggle smoothing', hint: k('toggle-smoothing'), run: toggleSmoothing },
    { id: 'refcol', label: 'Toggle reference lap colours (channel / lap)', hint: k('toggle-ref-colors'), run: toggleRefColors },
    { id: 'var', label: 'Toggle time variance', hint: k('toggle-variance'), run: toggleVarianceAll },
    { id: 'fast', label: 'Fastest lap as reference', hint: k('fastest-lap'), run: fastestAsReference },
    { id: 'prev', label: 'Previous lap', hint: k('prev-lap'), run: () => stepReferenceLap(-1) },
    { id: 'next', label: 'Next lap', hint: k('next-lap'), run: () => stepReferenceLap(1) },
    { id: 'play', label: 'Play / pause the reference lap', hint: k('toggle-playback'), run: togglePlayback },
    { id: 'datum', label: 'Datum: pin / release the cursor', hint: k('toggle-datum'), run: toggleDatum },
    { id: 'reset', label: 'Reset view (whole lap, clear measurement)', hint: k('reset-view'), run: resetView },
    { id: 'csv', label: 'Export visible data to CSV', hint: k('export-csv'), run: exportVisibleCsv },
    { id: 'shot', label: 'Save screenshot', hint: k('screenshot'), run: saveScreenshot },
    { id: 'pdf', label: 'Print worksheet to PDF…', hint: k('print-pdf'), run: printWorksheetPdf },
    { id: 'sidebar', label: 'Toggle sidebar', hint: k('toggle-sidebar'), run: () => setUi({ sidebar: !useStore.getState().ui.sidebar }) },
    { id: 'keys', label: 'Keyboard shortcuts & shortcut editor', hint: k('shortcuts'), run: () => setUi({ shortcuts: true }) },
    { id: 'sheet-reset', label: 'Reset this worksheet to the Starter version', run: () => resetSheetToStarter(activeWorkspace().activeSheet) },
    { id: 'ws-revert', label: 'Revert this workspace to Starter', run: revertWorkspaceToStarter },
  ];
  // Actions that have no default key (bindable in the shortcut editor) are always in the palette.
  for (const d of SHORTCUTS) if (!d.keys.length) cmds.push({ id: 'sc-' + d.id, label: d.label, hint: k(d.id), run: SHORTCUT_ACTIONS[d.id] });
  st.workspaces.forEach((w) => cmds.push({ id: 'ws' + w.id, label: `Switch workspace: ${w.name}`, run: () => setActiveWorkspace(w.id) }));
  ws?.worksheets.forEach((sh, i) => cmds.push({ id: 'sheet' + i, label: `Go to worksheet: ${sh.name}`, hint: i < 9 ? k(`sheet-${i + 1}`) : undefined, run: () => setActiveSheet(i) }));
  st.library.forEach((l) => cmds.push({ id: 'lib' + l.id, label: `Insert saved worksheet: ${l.name}`, run: () => insertLibrarySheet(l.id) }));
  for (const c of COMPONENT_CATALOG) cmds.push({ id: 'add' + c.type, label: `Add component: ${c.label}`, run: () => addComponent(c.type, useStore.getState().activeComponentId) });
  return cmds;
}

function inEditable(target: EventTarget | null) {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function handleGlobalKey(e: KeyboardEvent) {
  const st = useStore.getState();
  // The shortcut editor is capturing a new key combo.
  if (st.ui.recordingShortcut) return;
  const anyModal = st.ui.browser || st.ui.math || st.ui.settings || st.ui.palette || st.ui.shortcuts || st.ui.properties || st.ui.trackProfile;
  const combo = comboFromEvent(e);
  if (!combo) return;
  const action = actionForCombo(combo, st.settings.shortcuts);
  if (action === 'palette') {
    e.preventDefault();
    SHORTCUT_ACTIONS.palette();
    return;
  }
  if (inEditable(e.target) || anyModal) {
    if (e.key === 'Escape') setUi({ palette: false, shortcuts: false, settings: false, trackProfile: false });
    return;
  }
  if (!action) return;
  // Always swallow the key: on macOS an unhandled key event is passed on to the native menu, which
  // would run the same action a second time.
  e.preventDefault();
  SHORTCUT_ACTIONS[action]?.();
}

/** Undo/redo from the Edit menu: text undo inside text fields, otherwise the app's history. */
function editHistory(kind: 'undo' | 'redo') {
  if (inEditable(document.activeElement)) {
    document.execCommand(kind);
    return;
  }
  if (kind === 'undo') undo();
  else redo();
}

export async function handleMenuAction(action: string) {
  const [cmd, arg] = action.includes(':') ? [action.slice(0, action.indexOf(':')), action.slice(action.indexOf(':') + 1)] : [action, ''];
  const ws = activeWorkspace();
  const sheetIdx = ws?.activeSheet ?? 0;
  switch (cmd) {
    case 'undo':
      return editHistory('undo');
    case 'redo':
      return editHistory('redo');
    case 'open-browser':
      return setUi({ browser: true });
    case 'open-files':
      return pt()
        .chooseFiles(useStore.getState().settings.lastBrowsePath || undefined)
        .then((f) => {
          if (f.length) openFiles(f, 'replace');
        });
    case 'export-csv':
      return exportVisibleCsv();
    case 'screenshot':
      return saveScreenshot();
    case 'print-pdf':
      return printWorksheetPdf();
    case 'settings':
      return setUi({ settings: true });
    case 'math':
      return setUi({ math: true });
    case 'track-profile':
      return setUi({ trackProfile: true });
    case 'properties':
      return openProperties();
    case 'toggle-inspector':
      return setUi({ inspector: !useStore.getState().ui.inspector });
    case 'toggle-x':
      return setXMode(useStore.getState().xMode === 'time' ? 'distance' : 'time');
    case 'toggle-variance':
      return toggleVarianceAll();
    case 'toggle-smoothing':
      return toggleSmoothing();
    case 'toggle-ref-colors':
      return toggleRefColors();
    case 'zoom-lap':
    case 'reset-view':
      return resetView();
    case 'toggle-datum':
      return toggleDatum();
    case 'toggle-playback':
      return togglePlayback();
    case 'theme':
      return updateSettings({ theme: arg === 'light' ? 'light' : 'dark' });
    case 'toggle-theme':
      return SHORTCUT_ACTIONS['toggle-theme']();
    case 'fastest-lap':
      return fastestAsReference();
    case 'prev-lap':
      return stepReferenceLap(-1);
    case 'next-lap':
      return stepReferenceLap(1);
    case 'palette':
      return setUi({ palette: true });
    case 'toggle-sidebar':
      return setUi({ sidebar: !useStore.getState().ui.sidebar });
    case 'shortcuts':
      return setUi({ shortcuts: true });
    // ---- Workspace menu ----
    case 'ws-switch':
      return setActiveWorkspace(arg);
    case 'ws-save':
      return saveCurrentWorkspace();
    case 'ws-save-as':
      return saveWorkspaceAs();
    case 'ws-open-folder':
      return openWorkspacesFolder();
    case 'ws-new-starter': {
      const n = await promptText('Name the new workspace', 'My Workspace');
      if (n) createWorkspace('starter', n);
      return;
    }
    case 'ws-new-blank': {
      const n = await promptText('Name the new workspace', 'Blank workspace');
      if (n) createWorkspace('blank', n);
      return;
    }
    case 'ws-duplicate':
      return createWorkspace('duplicate');
    case 'ws-rename': {
      if (ws.locked) return toast(`"${ws.name}" is a read-only default — use Save as to make your own copy.`, 'info');
      const n = await promptText('Rename workspace', ws.name);
      if (n) renameWorkspace(ws.id, n);
      return;
    }
    case 'ws-revert':
      return revertWorkspaceToStarter();
    case 'ws-export':
      return exportWorkspace();
    case 'ws-import':
      return importWorkspace();
    case 'ws-delete':
      if (ws.locked) return toast(`"${ws.name}" is a built-in default and can’t be deleted.`, 'info');
      if (window.confirm(`Delete workspace "${ws.name}"? (Ctrl/⌘+Z can undo this)`)) deleteWorkspace(ws.id);
      return;
    // ---- Worksheet menu ----
    case 'sheet-new':
      return addWorksheet();
    case 'sheet-duplicate':
      return duplicateWorksheet(sheetIdx);
    case 'sheet-rename':
      window.dispatchEvent(new Event('pt-rename-sheet'));
      return;
    case 'sheet-reset':
      return resetSheetToStarter(sheetIdx);
    case 'sheet-save-lib': {
      const n = await promptText('Save worksheet to your library as', ws.worksheets[sheetIdx]?.name ?? 'Worksheet');
      if (n) saveSheetToLibrary(sheetIdx, n);
      return;
    }
    case 'sheet-insert-lib':
      return insertLibrarySheet(arg);
    case 'sheet-delete-lib':
      return deleteLibrarySheet(arg);
    case 'sheet-export':
      return exportWorksheet(sheetIdx);
    case 'sheet-import':
      return importWorksheet();
    case 'sheet-delete':
      if (ws.worksheets.length <= 1) return toast('A workspace needs at least one worksheet.', 'info');
      if (window.confirm(`Delete worksheet "${ws.worksheets[sheetIdx].name}"? (Ctrl/⌘+Z can undo this)`)) deleteWorksheet(sheetIdx);
      return;
  }
}
