import { useEffect, useState } from 'react';
import { handleGlobalKey, handleMenuAction } from './actions';
import { pt } from './core/bridge';
import { lapKey } from './core/types';
import {
  activeWorkspace,
  initApp,
  openFiles,
  selectLap,
  setActiveSheet,
  setCursor,
  setMeasure,
  setUi,
  setXMode,
  setZoom,
  toast,
  updateSettings,
  useStore,
} from './state/store';
import { Inspector } from './ui/Inspector';
import { MathEditor } from './ui/MathEditor';
import { OverlayHosts } from './ui/overlays';
import { SessionBrowser } from './ui/SessionBrowser';
import { SheetView } from './ui/SheetView';
import { Sidebar } from './ui/Sidebar';
import { CommandPalette, SettingsDialog, ShortcutsDialog } from './ui/Dialogs';
import { SheetTabs, StatusBar, Toasts, TopBar } from './ui/Chrome';

function useResizer(key: 'sidebarWidth' | 'inspectorWidth', dir: 1 | -1) {
  return (e: React.PointerEvent) => {
    e.preventDefault();
    const start = e.clientX;
    const w0 = useStore.getState().settings[key];
    const move = (ev: PointerEvent) => {
      const w = Math.max(220, Math.min(560, w0 + (ev.clientX - start) * dir));
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

function installAutomation() {
  window.__ptAutomation = {
    ready: () => useStore.getState().ready,
    showBrowser: (dir: string) => {
      setUi({ browser: true });
      setTimeout(() => window.dispatchEvent(new CustomEvent('pt-browse', { detail: dir })), 50);
    },
    openFiles: (paths: string[]) => openFiles(paths, 'replace'),
    loaded: () => {
      const s = useStore.getState();
      return s.sessions.length > 0 && s.loading.length === 0;
    },
    worksheets: () => activeWorkspace().worksheets.map((w) => w.name),
    setWorksheet: (i: number, demo: boolean) => {
      setUi({ browser: false, math: false, settings: false, palette: false });
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
    extras: () => ['math-editor', 'command-palette', 'settings', 'zoom-measure', 'time-axis', 'light-theme'],
    runExtra: (name: string) => {
      setUi({ math: name === 'math-editor', palette: name === 'command-palette', settings: name === 'settings' });
      if (name === 'zoom-measure') {
        setActiveSheet(0);
        setZoom([850, 2000]);
        setMeasure([1180, 1420]);
      } else if (name === 'time-axis') {
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
  };
}

export function App() {
  const ready = useStore((s) => s.ready);
  const ui = useStore((s) => s.ui);
  const sidebarWidth = useStore((s) => s.settings.sidebarWidth);
  const inspectorWidth = useStore((s) => s.settings.inspectorWidth);
  const [fileDrag, setFileDrag] = useState(false);
  const sideResize = useResizer('sidebarWidth', 1);
  const inspResize = useResizer('inspectorWidth', -1);

  useEffect(() => {
    if (!window.pt) return;
    installAutomation();
    initApp().catch((e) => toast(`Startup failed: ${e.message}`, 'error', 10000));
    const offMenu = pt().onMenu(handleMenuAction);
    const offOpen = pt().onOpenFiles((files) => openFiles(files, 'replace'));
    window.addEventListener('keydown', handleGlobalKey);
    window.addEventListener('error', (e) => useStore.setState((s) => ({ errors: [...s.errors, String(e.message)] })));
    return () => {
      offMenu();
      offOpen();
      window.removeEventListener('keydown', handleGlobalKey);
    };
  }, []);

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
        openFiles(paths, e.shiftKey || e.ctrlKey || e.metaKey ? 'add' : 'replace');
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
                <Inspector />
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
      <OverlayHosts />
      <Toasts />
      {fileDrag && (
        <div className="modal-back" style={{ pointerEvents: 'none' }}>
          <div className="modal" style={{ padding: 40, fontSize: 16 }}>
            Drop CSV files to open them <span className="muted">(hold Shift to add for comparison)</span>
          </div>
        </div>
      )}
    </div>
  );
}
