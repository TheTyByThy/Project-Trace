// App-level actions shared by menus, keyboard shortcuts and the command palette.

import { xToTime } from './core/axis';
import { pt } from './core/bridge';
import { sampleAt } from './core/channel';
import { lapDistAt } from './core/session';
import { COMPONENT_CATALOG } from './state/components';
import {
  activeSheet,
  activeWorkspace,
  addComponent,
  fastestAsReference,
  openFiles,
  selectedLaps,
  setActiveSheet,
  setCursor,
  setMeasure,
  setUi,
  setXMode,
  setZoom,
  stepReferenceLap,
  toast,
  updateSheet,
  useStore,
  viewRange,
  xExtent,
} from './state/store';
import type { GraphConfig } from './state/workspace';

export function toggleVarianceAll() {
  const sheet = activeSheet();
  if (!sheet) return;
  const graphs = Object.values(sheet.components).filter((c): c is GraphConfig => c.type === 'graph');
  if (!graphs.length) return;
  const on = !graphs.every((g) => g.showVariance);
  updateSheet((sh) => {
    const components = { ...sh.components };
    for (const g of graphs) components[g.id] = { ...g, showVariance: on };
    return { ...sh, components };
  });
  if (on && selectedLaps().length < 2) toast('Variance needs at least two laps — Ctrl/⌘+click another lap to overlay it.', 'info');
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
  const name = `${ref.session.fileName.replace(/\.csv$/i, '')}-lap${ref.lap.number}.csv`;
  const p = await pt().saveFile(name, [{ name: 'CSV', extensions: ['csv'] }], lines.join('\n'));
  if (p) toast(`Exported ${lines.length - 2} rows to ${p}`, 'success');
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

export function buildCommands(): Command[] {
  const ws = activeWorkspace();
  const cmds: Command[] = [
    { id: 'browser', label: 'Open session browser', hint: 'Ctrl+O', run: () => setUi({ browser: true }) },
    { id: 'math', label: 'Math channels…', hint: 'Ctrl+M', run: () => setUi({ math: true }) },
    { id: 'settings', label: 'Settings…', hint: 'Ctrl+,', run: () => setUi({ settings: true }) },
    { id: 'time', label: 'X axis: time', run: () => setXMode('time') },
    { id: 'dist', label: 'X axis: distance', run: () => setXMode('distance') },
    { id: 'var', label: 'Toggle time variance', hint: 'F3', run: toggleVarianceAll },
    { id: 'fast', label: 'Fastest lap as reference', hint: 'F', run: fastestAsReference },
    { id: 'prev', label: 'Previous lap', hint: 'PgUp', run: () => stepReferenceLap(-1) },
    { id: 'next', label: 'Next lap', hint: 'PgDn', run: () => stepReferenceLap(1) },
    { id: 'reset', label: 'Reset zoom', hint: 'Esc', run: () => (setZoom(null), setMeasure(null)) },
    { id: 'csv', label: 'Export visible data to CSV', hint: 'Ctrl+E', run: exportVisibleCsv },
    { id: 'shot', label: 'Save screenshot', hint: 'Ctrl+Shift+S', run: saveScreenshot },
    { id: 'sidebar', label: 'Toggle sidebar', hint: 'Ctrl+B', run: () => setUi({ sidebar: !useStore.getState().ui.sidebar }) },
    { id: 'insp', label: 'Toggle inspector', hint: 'Ctrl+I', run: () => setUi({ inspector: !useStore.getState().ui.inspector }) },
    { id: 'keys', label: 'Keyboard shortcuts', hint: 'F1', run: () => setUi({ shortcuts: true }) },
  ];
  ws?.worksheets.forEach((sh, i) => cmds.push({ id: 'sheet' + i, label: `Go to worksheet: ${sh.name}`, hint: i < 9 ? String(i + 1) : undefined, run: () => setActiveSheet(i) }));
  for (const c of COMPONENT_CATALOG) cmds.push({ id: 'add' + c.type, label: `Add component: ${c.label}`, run: () => addComponent(c.type, useStore.getState().activeComponentId) });
  return cmds;
}

function inEditable(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function handleGlobalKey(e: KeyboardEvent) {
  const st = useStore.getState();
  const mod = e.ctrlKey || e.metaKey;
  const anyModal = st.ui.browser || st.ui.math || st.ui.settings || st.ui.palette || st.ui.shortcuts;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    setUi({ palette: !st.ui.palette });
    return;
  }
  if (inEditable(e) || anyModal) {
    if (e.key === 'Escape') setUi({ palette: false, shortcuts: false, settings: false });
    return;
  }
  if (mod) {
    switch (e.key.toLowerCase()) {
      case 'o':
        e.preventDefault();
        setUi({ browser: true });
        return;
      case 'm':
        e.preventDefault();
        setUi({ math: true });
        return;
      case 'b':
        e.preventDefault();
        setUi({ sidebar: !st.ui.sidebar });
        return;
      case 'i':
        e.preventDefault();
        setUi({ inspector: !st.ui.inspector });
        return;
      case 'e':
        e.preventDefault();
        exportVisibleCsv();
        return;
      case ',':
        e.preventDefault();
        setUi({ settings: true });
        return;
    }
    return;
  }
  switch (e.key) {
    case 'd':
    case 'D':
      setXMode(st.xMode === 'time' ? 'distance' : 'time');
      break;
    case 'F3':
    case 'v':
    case 'V':
      e.preventDefault();
      toggleVarianceAll();
      break;
    case 'f':
    case 'F':
      fastestAsReference();
      break;
    case 'PageUp':
    case '[':
      e.preventDefault();
      stepReferenceLap(-1);
      break;
    case 'PageDown':
    case ']':
      e.preventDefault();
      stepReferenceLap(1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      moveCursor(e.shiftKey ? -0.05 : -0.005);
      break;
    case 'ArrowRight':
      e.preventDefault();
      moveCursor(e.shiftKey ? 0.05 : 0.005);
      break;
    case '+':
    case '=':
      zoomBy(0.7);
      break;
    case '-':
    case '_':
      zoomBy(1 / 0.7);
      break;
    case 'Escape':
    case 'Home':
      setZoom(null);
      setMeasure(null);
      break;
    case 'F1':
      e.preventDefault();
      setUi({ shortcuts: true });
      break;
    default:
      if (/^[1-9]$/.test(e.key)) setActiveSheet(Number(e.key) - 1);
  }
}

export function handleMenuAction(action: string) {
  switch (action) {
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
    case 'settings':
      return setUi({ settings: true });
    case 'math':
      return setUi({ math: true });
    case 'toggle-x':
      return setXMode(useStore.getState().xMode === 'time' ? 'distance' : 'time');
    case 'toggle-variance':
      return toggleVarianceAll();
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
    case 'toggle-inspector':
      return setUi({ inspector: !useStore.getState().ui.inspector });
    case 'shortcuts':
      return setUi({ shortcuts: true });
  }
}
