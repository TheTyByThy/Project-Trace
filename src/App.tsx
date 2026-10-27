import { useEffect, useState } from 'react';
import { handleGlobalKey, handleMenuAction } from './actions';
import { bindings } from './shortcuts';
import { pt } from './core/bridge';
import { suggestCorners } from './core/corners';
import { lapKey } from './core/types';
import type { LayoutNode } from './state/workspace';
import {
  activeSheet,
  activeWorkspace,
  copyWorksheet,
  deleteWorksheet,
  deleteWorkspace,
  saveCurrentWorkspace,
  saveWorkspaceAs,
  pasteWorksheet,
  redo,
  removeComponentById,
  setActiveWorkspace,
  updateWorkspace,
  trackProfile,
  STARTER_ID,
  undo,
  initApp,
  openFiles,
  openProperties,
  selectLap,
  selectedLaps,
  setActiveSheet,
  setCursor,
  setMeasure,
  setSmoothing,
  setTrackProfile,
  setUi,
  setWorkingRotation,
  setXMode,
  addComponent,
  setNamePrompt,
  setSplitSizes,
  setZoom,
  syncWorkspacesFromFolder,
  toggleDatum,
  togglePlayback,
  toast,
  updateComponent,
  updateSettings,
  useStore,
} from './state/store';
import { MathEditor } from './ui/MathEditor';
import { OverlayHosts, promptText } from './ui/overlays';
import { InspectorPanel, PropertiesModal } from './ui/PropertiesModal';
import { SessionBrowser } from './ui/SessionBrowser';
import { SheetView } from './ui/SheetView';
import { Sidebar } from './ui/Sidebar';
import { TrackProfileDialog } from './ui/TrackProfileEditor';
import { CommandPalette, SettingsDialog, ShortcutsDialog } from './ui/Dialogs';
import { SheetTabs, StatusBar, Toasts, TopBar } from './ui/Chrome';
import { startLive } from './state/live';
import { allTyreWearSheets } from './state/tyreWearSheets';
import { setWearFocus } from './charts/wearShared';
import { WEAR_CHANNEL_PROPS } from './state/tyreWearSheets';
import { DEFAULT_MATH_CHANNELS } from './state/defaultMath';

function usePanelResizer(key: 'sidebarWidth' | 'inspectorWidth', dir: 1 | -1) {
  return (e: React.PointerEvent) => {
    e.preventDefault();
    const start = e.clientX;
    const w0 = useStore.getState().settings[key];
    const move = (ev: PointerEvent) => {
      const w = Math.max(220, Math.min(620, w0 + (ev.clientX - start) * dir));
      useStore.setState((s) => ({ settings: { ...s.settings, [key]: w } }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      updateSettings({ [key]: useStore.getState().settings[key] });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

/** Keep the native menu bar (Workspace / Worksheet / Analysis menus) in sync with app state. */
function useMenuSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastKey = '';
    const push = () => {
      const s = useStore.getState();
      const state = {
        workspaces: s.workspaces.map((w) => ({ id: w.id, name: w.name, locked: !!w.locked })),
        activeWorkspaceId: s.settings.activeWorkspaceId,
        library: s.library.map((l) => ({ id: l.id, name: l.name })),
        refColors: s.settings.refColors,
        smoothing: s.settings.smoothing.enabled,
        theme: s.settings.theme,
        canUndo: s.history.past.length > 0,
        canRedo: s.history.future.length > 0,
        shortcuts: Object.fromEntries(Object.entries(bindings(s.settings.shortcuts)).map(([id, keys]) => [id, keys[0] ?? ''])),
      };
      const key = JSON.stringify(state);
      if (key === lastKey) return;
      lastKey = key;
      pt().setMenuState(state);
    };
    push();
    return useStore.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(push, 120);
    });
  }, []);
}

let prevWorkspace = '';
let compareExtra = '';

function installAutomation() {
  const sheetIndex = (name: string) => activeWorkspace().worksheets.findIndex((w) => w.name === name);
  window.__ptAutomation = {
    ready: () => useStore.getState().ready,
    showBrowser: (dir: string) => {
      setUi({ browser: true });
      setTimeout(() => window.dispatchEvent(new CustomEvent('pt-browse', { detail: dir })), 50);
    },
    openFiles: (paths: string[]) => openFiles(paths, 'replace'),
    loaded: (n = 1) => {
      const s = useStore.getState();
      return s.sessions.length >= n && s.loading.length === 0;
    },
    worksheets: () => activeWorkspace().worksheets.map((w) => w.name),
    setWorksheet: (i: number, demo: boolean) => {
      setUi({ browser: false, math: false, settings: false, palette: false, properties: false, trackProfile: false });
      setActiveSheet(i);
      const s = useStore.getState();
      if (demo && s.sessions[0]) {
        // Show the fastest lap with the next-best valid lap overlaid, cursor mid-lap.
        const ses = s.sessions[0];
        const others = ses.laps.filter((l) => l.complete && !l.invalid && lapKey({ sessionId: ses.id, lapIndex: l.index }) !== s.refKey).sort((a, b) => a.time - b.time);
        if (s.laps.length < 2 && others[0]) selectLap(lapKey({ sessionId: ses.id, lapIndex: others[0].index }), 'add');
        if (s.cursor == null) setCursor(1240);
      }
    },
    extras: () => [
      'corners-and-gps',
      'properties-graph',
      'properties-scatter',
      'properties-inputs',
      'track-profile',
      'track-sections',
      'smoothing',
      'ref-lap-colour',
      'math-editor',
      'command-palette',
      'settings',
      'settings-masters',
      'zoom-measure',
      'fuel-corrected',
      'gg-envelope',
      'trend-fit',
      'tyre-wear',
      'tyre-wear-detail',
      'wear-popout',
      'wear-balance',
      'wear-by-corner',
      'wear-deep-fronts',
      'wear-deep-rears',
      'wear-stint',
      'wear-stint-tyres',
      'live-mode',
      'scatter-fit',
      'playback',
      'bars',
      'bars-combined',
      'datum',
      'hidden-channel',
      'lap-report-delta',
      'shortcuts',
      'basic-fa26',
      'compare-lap',
      'time-axis',
      'light-theme',
    ],
    runExtra: (name: string) => {
      setUi({ math: name === 'math-editor', palette: name === 'command-palette', settings: name === 'settings' || name === 'live-mode' || name === 'settings-masters',
        settingsTab: name === 'settings-masters' ? 'masters' : 'general', shortcuts: name === 'shortcuts', properties: false, trackProfile: false });
      const ref = selectedLaps()[0];
      const venue = ref?.session.meta.venue ?? '';
      if (name === 'corners-and-gps') {
        // Demonstrate user-defined corners (temporary screenshot profile only) and the GPS track.
        if (ref) setTrackProfile(venue, { corners: suggestCorners(ref.session, ref.lap).slice(0, 12) });
        setWorkingRotation(venue, 35);
        setActiveSheet(sheetIndex('Racing Lines'));
        setZoom([360, 700]);
        setCursor(560);
      } else if (name === 'properties-graph') {
        setZoom(null);
        setWorkingRotation(venue, 0);
        setActiveSheet(0);
        const g = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'graph');
        openProperties(g?.id ?? null);
      } else if (name === 'properties-scatter') {
        setActiveSheet(sheetIndex('Aero'));
        const sc = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'scatter');
        openProperties(sc?.id ?? null);
      } else if (name === 'properties-inputs') {
        setActiveSheet(sheetIndex('Driver'));
        const inp = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'inputs');
        openProperties(inp?.id ?? null);
      } else if (name === 'track-profile') {
        setActiveSheet(0);
        // Two splits with named sections, to show the Sections table (screenshot profile only).
        if (venue) setTrackProfile(venue, { sections: [{ name: 'Split A', dist: 1500 }, { name: 'Split B', dist: 3200 }], sectionNames: ['Sector 1', 'Sector 2', 'Sector 3'] });
        setUi({ trackProfile: true });
      } else if (name === 'track-sections') {
        setUi({ trackProfile: true });
        setTimeout(() => document.querySelector('.track-editor-right')?.scrollTo(0, 99999), 50);
      } else if (name === 'live-mode') {
        // Screenshot profile only: show the Live mode settings switched on.
        updateSettings({ live: { ...useStore.getState().settings.live, enabled: true, requireSim: true } });
      } else if (name.startsWith('wear-')) {
        // Screenshot profile only: add the full tyre-wear worksheet set (as in a dedicated workspace) once.
        if (sheetIndex('Wear by Corner') < 0)
          updateWorkspace((ws) => ({
            ...ws,
            worksheets: [...ws.worksheets, ...allTyreWearSheets().slice(2)],
            math: [...ws.math, ...DEFAULT_MATH_CHANNELS.filter((m) => !ws.math.some((x) => x.name === m.name))],
            channelProps: { ...WEAR_CHANNEL_PROPS, ...ws.channelProps },
          }));
        const target = { 'wear-balance': 'Wear Balance', 'wear-popout': 'Tyre Wear', 'wear-by-corner': 'Wear by Corner', 'wear-deep-fronts': 'Wear Deep Dive – Fronts', 'wear-deep-rears': 'Wear Deep Dive – Rears', 'wear-stint': 'Wear Stint', 'wear-stint-tyres': 'Wear Stint – Tyres' }[name]!;
        setActiveSheet(sheetIndex(target));
        // Wear by Corner shows the wheels' % view (the other sheets show metres).
        if (name === 'wear-by-corner')
          for (const c of Object.values(activeSheet()?.components ?? {})) if (c.type === 'wearwheels') updateComponent(c.id, { units: 'pct' });
        // Focus the second corner (from a Tyre Wear table on this sheet, so its pop-out opens).
        const corner = trackProfile(venue).corners.slice().sort((a, b) => a.dist - b.dist)[1];
        const tw = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'tyrewear');
        if (corner && name !== 'wear-stint' && name !== 'wear-stint-tyres' && name !== 'wear-balance') {
          setWearFocus({ name: corner.name, entry: corner.dist - 120, exit: corner.dist + 80, venue, source: tw?.id ?? '' });
          setXMode('distance');
          setZoom([corner.dist - 250, corner.dist + 200]);
          setCursor(corner.dist);
        } else {
          setWearFocus(null);
          setZoom(null);
        }
      } else if (name === 'tyre-wear' || name === 'tyre-wear-detail') {
        setZoom(null);
        setActiveSheet(sheetIndex(name === 'tyre-wear' ? 'Tyre Wear' : 'Tyre Wear Detail'));
      } else if (name === 'smoothing') {
        setActiveSheet(0);
        setSmoothing({ enabled: true, seconds: 0.2 });
        setZoom([850, 2000]);
      } else if (name === 'ref-lap-colour') {
        setSmoothing({ enabled: false });
        updateSettings({ refColors: 'lap' });
        setActiveSheet(0);
      } else if (name === 'zoom-measure') {
        updateSettings({ refColors: 'channel' });
        setSmoothing({ enabled: true, seconds: 0.05 });
        setActiveSheet(0);
        setZoom([850, 2000]);
        setMeasure([1180, 1420]);
      } else if (name === 'fuel-corrected') {
        setActiveSheet(sheetIndex('Lap Analysis'));
        const t = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'trend' && !c.channel);
        if (t) updateComponent(t.id, { lapTimes: 'both' });
      } else if (name === 'trend-fit') {
        setActiveSheet(sheetIndex('Lap Analysis'));
        const t = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'trend' && !c.channel);
        if (t) updateComponent(t.id, { lapTimes: 'raw', showFit: true, fit: 'poly2', showEquation: true });
      } else if (name === 'scatter-fit') {
        setActiveSheet(sheetIndex('Driver'));
        const sc = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'scatter');
        if (sc) updateComponent(sc.id, { showFit: true, fit: 'linear', showEquation: true });
      } else if (name === 'gg-envelope') {
        setActiveSheet(sheetIndex('Driver'));
      } else if (name === 'playback') {
        setActiveSheet(0);
        setZoom(null);
        setCursor(200);
        togglePlayback();
      } else if (name === 'bars') {
        if (useStore.getState().playback.playing) togglePlayback();
        // A Bars component directly under the Overview graph (screenshot profile only).
        setMeasure(null);
        setActiveSheet(0);
        const g = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'graph');
        if (g && !Object.values(activeSheet()?.components ?? {}).some((c) => c.type === 'bars')) {
          const id = addComponent('bars', g.id, 'bottom');
          const bars = activeSheet()?.components[id];
          if (bars && bars.type === 'bars')
            updateComponent(id, { rows: [...bars.rows, { id: 'coast', channel: 'Coasting', op: 'nonzero', value: 0, label: 'Coasting', color: '#c98500' }] });
          // Keep the bars short, like a strip under the graph.
          const sheet = activeSheet();
          const findSplit = (n: LayoutNode | null): Extract<LayoutNode, { kind: 'split' }> | null =>
            !n || n.kind === 'leaf' ? null : n.children.some((ch) => ch.kind === 'leaf' && ch.componentId === id) ? n : n.children.map(findSplit).find(Boolean) ?? null;
          const sp = findSplit(sheet?.layout ?? null);
          if (sp) setSplitSizes(sp.id, sp.children.map((ch) => (ch.kind === 'leaf' && ch.componentId === id ? 0.16 : 0.84)));
        }
      } else if (name === 'bars-combined') {
        const b = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'bars');
        if (b) updateComponent(b.id, { combined: true });
      } else if (name === 'datum') {
        setMeasure(null);
        setZoom([850, 2000]);
        setCursor(1300);
        if (!useStore.getState().datum) toggleDatum();
      } else if (name === 'hidden-channel') {
        if (useStore.getState().datum) toggleDatum();
        // Hide Brake Pos in the first graph (it stays in its pane, dimmed in the legend).
        const g = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'graph');
        if (g && g.type === 'graph')
          updateComponent(g.id, { panes: g.panes.map((p) => (p.channels.includes('Brake Pos') ? { ...p, hidden: ['Brake Pos'] } : p)) });
      } else if (name === 'lap-report-delta') {
        const g = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'graph');
        if (g && g.type === 'graph') updateComponent(g.id, { panes: g.panes.map((p) => ({ ...p, hidden: undefined })) });
        if (useStore.getState().datum) toggleDatum();
        setMeasure(null);
        setZoom(null);
        const lr = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'lapreport');
        if (lr) updateComponent(lr.id, { sectorMode: 'delta' });
      } else if (name === 'shortcuts') {
        const lr = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'lapreport');
        if (lr) updateComponent(lr.id, { sectorMode: 'absolute' });
      } else if (name === 'basic-fa26') {
        if (useStore.getState().workspaces.some((w) => w.id === 'basic-fa26')) {
          prevWorkspace = useStore.getState().settings.activeWorkspaceId;
          setActiveWorkspace('basic-fa26');
          setActiveSheet(0);
        }
      } else if (name === 'compare-lap') {
        // A third lap selected; the Driver sheet's gain/loss map compares it instead of the first overlay.
        if (prevWorkspace) setActiveWorkspace(prevWorkspace);
        prevWorkspace = '';
        const s = useStore.getState().sessions[0];
        const extra = s && s.laps.find((l) => l.complete && l.number === 2);
        if (extra) {
          const key = lapKey({ sessionId: s.id, lapIndex: extra.index });
          selectLap(key, 'add');
          setActiveSheet(sheetIndex('Driver'));
          const map = Object.values(activeSheet()?.components ?? {}).find((c) => c.type === 'trackmap' && c.colorBy === 'delta');
          if (map) updateComponent(map.id, { compareKey: key });
          compareExtra = key;
        }
      } else if (name === 'time-axis') {
        if (compareExtra) selectLap(compareExtra, 'toggle');
        compareExtra = '';
        if (prevWorkspace) setActiveWorkspace(prevWorkspace);
        setMeasure(null);
        setXMode('time');
        setActiveSheet(1);
      } else if (name === 'light-theme') {
        setXMode('distance');
        setZoom(null);
        updateSettings({ theme: 'light' });
        setActiveSheet(0);
      }
    },
    errors: () => useStore.getState().errors,
    sessions: () => useStore.getState().sessions.map((x) => x.fileName),
    /** End-to-end checks of undo/redo and the read-only Starter workspace (run by the screenshot script). */
    checks: async () => {
      const out: string[] = [];
      const ok = (cond: boolean, what: string) => out.push(`${cond ? 'PASS' : 'FAIL'}: ${what}`);
      const count = () => Object.keys(activeSheet()?.components ?? {}).length;
      setActiveSheet(0);
      const before = count();
      const id = Object.keys(activeSheet()!.components)[0];
      removeComponentById(id);
      ok(count() === before - 1, 'remove component');
      undo();
      ok(count() === before && !!activeSheet()!.components[id], 'undo restores the removed component');
      redo();
      ok(count() === before - 1, 'redo removes it again');
      undo();
      const sheets = activeWorkspace().worksheets.length;
      deleteWorksheet(1);
      ok(activeWorkspace().worksheets.length === sheets - 1, 'delete worksheet');
      undo();
      ok(activeWorkspace().worksheets.length === sheets, 'undo restores the deleted worksheet');
      const mine = activeWorkspace().id;
      setActiveWorkspace(STARTER_ID);
      const starterSheets = activeWorkspace().worksheets.length;
      deleteWorksheet(0);
      const starter = useStore.getState().workspaces.find((w) => w.id === STARTER_ID)!;
      ok(starter.worksheets.length === starterSheets && activeWorkspace().id !== STARTER_ID, 'editing the Starter creates a personal copy and leaves the Starter intact');
      undo();
      ok(useStore.getState().workspaces.every((w) => w.locked || w.id === mine), 'undo removes the copy again');
      setActiveWorkspace(mine);
      // Copy a worksheet into another workspace that lacks its math channels.
      const other = useStore.getState().workspaces.find((w) => w.id !== mine && w.id !== STARTER_ID);
      const wearIdx = activeWorkspace().worksheets.findIndex((w) => w.name === 'Tyre Wear');
      if (other && wearIdx >= 0) {
        copyWorksheet(wearIdx);
        setActiveWorkspace(other.id);
        const hadMath = activeWorkspace().math.some((m) => m.name === 'Tyre Wear Rate Avg');
        void pasteWorksheet(0);
        const target = activeWorkspace();
        ok(
          target.id !== mine && target.worksheets[1]?.name.startsWith('Tyre Wear') && Object.values(target.worksheets[1].components).some((c) => c.type === 'tyrewear'),
          `paste a copied worksheet into another workspace (${other.name})`,
        );
        ok(hadMath || ['Tyre Wear Rate Avg', 'Tyre Wear Rate FL', 'Tyre Wear Lap RR'].every((n) => target.math.some((m) => m.name === n)), 'pasting brings the math channels it uses');
        undo();
        setActiveWorkspace(mine);
      }
      // Save / Save as: each way of saving shows the "Saved" pop-up and writes the file.
      const savedToast = () => useStore.getState().toasts.some((t) => t.kind === 'success' && t.text.startsWith('Saved'));
      const clearToasts = () => useStore.setState({ toasts: [] });
      const onDisk = async (id: string) => (await pt().listWorkspaces()).some((w) => w.id === id);
      for (const [how, run] of [
        ['Save', () => saveCurrentWorkspace()],
        ['the Workspace menu Save', () => handleMenuAction('ws-save')],
        ['⌘/Ctrl+S', async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, ctrlKey: true, cancelable: true }))],
      ] as const) {
        clearToasts();
        await run();
        await new Promise((r) => setTimeout(r, 300));
        ok(savedToast() && (await onDisk(mine)), `${how} shows the Saved pop-up and writes the file`);
      }
      clearToasts();
      const count0 = useStore.getState().workspaces.length;
      await saveWorkspaceAs('Save As Check');
      const copy = activeWorkspace();
      ok(copy.name === 'Save As Check' && useStore.getState().workspaces.length === count0 + 1, 'Save as makes a named copy and switches to it');
      ok(savedToast() && (await onDisk(copy.id)), 'Save as shows the Saved pop-up and writes the file');
      deleteWorkspace(copy.id);
      setActiveWorkspace(mine);
      // A save that fails (here: a value that can't be sent to the main process) says so instead of doing nothing.
      clearToasts();
      const saved = useStore.getState().workspaces;
      useStore.setState({ workspaces: saved.map((w) => (w.id === mine ? ({ ...w, unsendable: () => 0 } as typeof w) : w)) });
      await saveCurrentWorkspace();
      const ts = useStore.getState().toasts;
      ok(!savedToast() && ts.some((t) => t.kind === 'error' && t.text.startsWith("Couldn't save")), 'a failed save shows an error instead of nothing');
      useStore.setState({ workspaces: saved, errors: [] });
      clearToasts();
      return out;
    },
  };
}

export function App() {
  const ready = useStore((s) => s.ready);
  const ui = useStore((s) => s.ui);
  const sidebarWidth = useStore((s) => s.settings.sidebarWidth);
  const [fileDrag, setFileDrag] = useState(false);
  const sideResize = usePanelResizer('sidebarWidth', 1);
  const inspResize = usePanelResizer('inspectorWidth', -1);
  const inspectorWidth = useStore((s) => s.settings.inspectorWidth);

  useEffect(() => {
    if (!window.pt) return;
    installAutomation();
    setNamePrompt(promptText);
    initApp().catch((e) => toast(`Startup failed: ${e.message}`, 'error', 10000));
    const offMenu = pt().onMenu(handleMenuAction);
    const offWs = pt().onWorkspacesChanged(() => useStore.getState().ready && syncWorkspacesFromFolder());
    const offFs = pt().onFullscreen((on) => document.documentElement.classList.toggle('fullscreen', on));
    const offOpen = pt().onOpenFiles((files) => openFiles(files, 'replace'));
    const offLive = startLive();
    window.addEventListener('keydown', handleGlobalKey);
    window.addEventListener('error', (e) => useStore.setState((s) => ({ errors: [...s.errors, String(e.message)] })));
    return () => {
      offMenu();
      offWs();
      offFs();
      offOpen();
      offLive();
      window.removeEventListener('keydown', handleGlobalKey);
    };
  }, []);
  useMenuSync();

  if (!window.pt)
    return (
      <div className="empty-state" style={{ marginTop: 100 }}>
        Project-Trace must be started with <span className="mono">npm start</span> (it runs inside Electron).
      </div>
    );
  if (!ready) return <div className="empty-state" style={{ marginTop: 120 }}>Starting Project-Trace…</div>;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setFileDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget) setFileDrag(false);
      }}
      onDrop={(e) => {
        setFileDrag(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        const paths = [...e.dataTransfer.files].map((f) => pt().pathForFile(f)).filter(Boolean);
        // Dropping adds to what's open (per the browser's double-click setting); Shift inverts it.
        const st = useStore.getState();
        const add = st.sessions.length > 0 && st.settings.browserOpenMode === 'add';
        openFiles(paths, add !== (e.shiftKey || e.ctrlKey || e.metaKey) ? 'add' : 'replace');
      }}
    >
      <TopBar />
      <div className="main">
        {ui.sidebar && (
          <>
            <div className="sidebar" style={{ width: sidebarWidth }}>
              <Sidebar />
            </div>
            <div className="resizer-v" onPointerDown={sideResize} />
          </>
        )}
        <div className="center">
          <SheetTabs />
          <div className="sheet-area">
            <SheetView />
          </div>
        </div>
        {ui.inspector && (
          <>
            <div className="resizer-v" onPointerDown={inspResize} />
            <div className="inspector" style={{ width: inspectorWidth }}>
              <div className="panel-tabs">
                <button className="on">Properties</button>
              </div>
              <div className="scroll">
                <InspectorPanel />
              </div>
            </div>
          </>
        )}
      </div>
      <StatusBar />
      {ui.browser && <SessionBrowser />}
      {ui.math && <MathEditor />}
      {ui.settings && <SettingsDialog />}
      {ui.shortcuts && <ShortcutsDialog />}
      {ui.palette && <CommandPalette />}
      {ui.properties && <PropertiesModal />}
      {ui.trackProfile && <TrackProfileDialog />}
      <OverlayHosts />
      <Toasts />
      {fileDrag && (
        <div className="modal-back" style={{ pointerEvents: 'none' }}>
          <div className="modal" style={{ padding: 40, fontSize: 16 }}>
            Drop CSV or .ld files to open them <span className="muted">(Shift switches between adding and replacing)</span>
          </div>
        </div>
      )}
    </div>
  );
}
