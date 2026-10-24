// App chrome: top bar, worksheet tabs, status bar, toasts.

import { useState } from 'react';
import { computeVariance, varianceAt, xToTime } from '../core/axis';
import { formatAxisTime, formatDelta, formatLapTime, prettyCar, prettyTrack } from '../core/format';
import { fastestLap, lapAtTime, lapDistAt, lapLabel } from '../core/session';
import {
  activeWorkspace,
  addWorksheet,
  createWorkspace,
  deleteWorksheet,
  deleteWorkspace,
  duplicateWorksheet,
  exportWorkspace,
  importWorkspace,
  moveWorksheet,
  renameWorksheet,
  renameWorkspace,
  selectedLaps,
  setActiveSheet,
  setActiveWorkspace,
  setUi,
  setXMode,
  setZoom,
  useStore,
} from '../state/store';
import { addMenu } from './SheetView';
import { openMenu, promptText } from './overlays';
import { toggleVarianceAll } from '../actions';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <path d="M5 21 C 9 21, 10 9, 14 9 S 18 23, 22 23 S 25 13, 27 11" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function TopBar() {
  const sessions = useStore((s) => s.sessions);
  const xMode = useStore((s) => s.xMode);
  const zoom = useStore((s) => s.zoom);
  const ws = useStore((s) => activeWorkspace(s));
  const workspaces = useStore((s) => s.workspaces);
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  const ref = selectedLaps()[0];
  const s0 = ref?.session ?? sessions[0];
  const fl = s0 ? fastestLap(s0) : undefined;

  const wsMenu = (e: React.MouseEvent) =>
    openMenu(e, [
      { header: 'Workspaces' },
      ...workspaces.map((w) => ({ label: w.name, checked: w.id === ws.id, onClick: () => setActiveWorkspace(w.id) })),
      { separator: true },
      { label: 'New from default template', onClick: async () => createWorkspace('default', (await promptText('Workspace name', 'My workspace')) ?? undefined) },
      { label: 'New blank workspace', onClick: async () => createWorkspace('blank', (await promptText('Workspace name', 'Blank workspace')) ?? undefined) },
      { label: 'Duplicate current', onClick: () => createWorkspace('duplicate') },
      {
        label: 'Rename current…',
        onClick: async () => {
          const n = await promptText('Rename workspace', ws.name);
          if (n) renameWorkspace(ws.id, n);
        },
      },
      { separator: true },
      { label: 'Export current to file…', onClick: exportWorkspace },
      { label: 'Import from file…', onClick: importWorkspace },
      { separator: true },
      { label: 'Delete current', disabled: workspaces.length <= 1, onClick: () => window.confirm(`Delete workspace "${ws.name}"?`) && deleteWorkspace(ws.id) },
    ]);

  return (
    <div className="topbar">
      <div className="brand">
        <Logo />
        <span>Project-Trace</span>
      </div>
      <button className="btn primary" onClick={() => setUi({ browser: true })} title="Session browser (Ctrl/⌘+O)">
        Open
      </button>
      {s0 ? (
        <div className="session-pill" title={s0.path}>
          <b>{prettyTrack(s0.meta.venue).track}</b>
          <span className="muted">{prettyCar(s0.meta.vehicle)}</span>
          <span className="muted">· {s0.meta.driver}</span>
          {fl && (
            <span>
              · best <b className="num">{formatLapTime(fl.time)}</b>
            </span>
          )}
          {sessions.length > 1 && <span className="tag">+{sessions.length - 1} more</span>}
        </div>
      ) : (
        <span className="muted">No session open</span>
      )}
      <span className="grow" />
      <div className="seg" title="X axis (D)">
        <button className={xMode === 'time' ? 'on' : ''} onClick={() => setXMode('time')}>
          Time
        </button>
        <button className={xMode === 'distance' ? 'on' : ''} onClick={() => setXMode('distance')}>
          Distance
        </button>
      </div>
      <button className="btn" onClick={toggleVarianceAll} title="Toggle time variance in this worksheet's graphs (F3)">
        Δ Variance
      </button>
      <button className="btn" disabled={!zoom} onClick={() => setZoom(null)} title="Reset zoom (Esc)">
        Reset zoom
      </button>
      <button className="btn" onClick={wsMenu} title="Workspaces">
        ▦ {ws?.name}
      </button>
      <button className="btn" onClick={() => setUi({ math: true })} title="Math channels (Ctrl/⌘+M)">
        ƒx Math
      </button>
      <button className="btn icon" onClick={() => setUi({ palette: true })} title="Command palette (Ctrl/⌘+K)">
        ⌘
      </button>
      <button className="btn icon" onClick={() => setUi({ settings: true })} title="Settings">
        ⚙
      </button>
      <button className="btn icon" onClick={() => setUi({ shortcuts: true })} title="Keyboard shortcuts (F1)">
        ?
      </button>
    </div>
  );
}

export function SheetTabs() {
  const ws = useStore((s) => activeWorkspace(s));
  const [editing, setEditing] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  if (!ws) return null;
  return (
    <div className="sheet-tabs">
      {ws.worksheets.map((sh, i) => (
        <div
          key={sh.id}
          className={'sheet-tab' + (i === ws.activeSheet ? ' on' : '')}
          onClick={() => setActiveSheet(i)}
          onDoubleClick={() => setEditing(i)}
          draggable={editing !== i}
          onDragStart={(e) => {
            setDragFrom(i);
            e.dataTransfer.setData('application/x-pt-sheet', String(i));
          }}
          onDragOver={(e) => e.dataTransfer.types.includes('application/x-pt-sheet') && e.preventDefault()}
          onDrop={() => {
            if (dragFrom != null && dragFrom !== i) moveWorksheet(dragFrom, i);
            setDragFrom(null);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu(e, [
              { label: 'Rename', onClick: () => setEditing(i) },
              { label: 'Duplicate', onClick: () => duplicateWorksheet(i) },
              { label: 'Move left', disabled: i === 0, onClick: () => moveWorksheet(i, i - 1) },
              { label: 'Move right', disabled: i === ws.worksheets.length - 1, onClick: () => moveWorksheet(i, i + 1) },
              { separator: true },
              { label: 'Delete', disabled: ws.worksheets.length <= 1, onClick: () => window.confirm(`Delete worksheet "${sh.name}"?`) && deleteWorksheet(i) },
            ]);
          }}
          title={i < 9 ? `Worksheet ${i + 1} (press ${i + 1})` : undefined}
        >
          {editing === i ? (
            <input
              className="input"
              autoFocus
              defaultValue={sh.name}
              onBlur={(e) => {
                renameWorksheet(i, e.target.value.trim() || sh.name);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            sh.name
          )}
        </div>
      ))}
      <div className="sheet-tab" title="New worksheet" onClick={() => addWorksheet()}>
        ＋
      </div>
      <span className="grow" />
      <div className="sheet-tab" onClick={(e) => addMenu(e, null)} title="Add a component to this worksheet">
        ＋ Component
      </div>
    </div>
  );
}

export function StatusBar() {
  const cursor = useStore((s) => s.cursor);
  const zoom = useStore((s) => s.zoom);
  const xMode = useStore((s) => s.xMode);
  const loading = useStore((s) => s.loading);
  const units = useStore((s) => s.settings.units);
  const version = useStore((s) => s.appInfo?.version);
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  const laps = selectedLaps();
  const ref = laps[0];
  let cursorInfo = '';
  let delta = '';
  if (ref && cursor != null) {
    const t = xToTime(ref.lap, cursor, xMode);
    const lap = ref.lap.index === -1 ? lapAtTime(ref.session, t) : ref.lap;
    const lt = lap ? t - lap.start : t;
    const d = lap ? lapDistAt(lap, t) : NaN;
    cursorInfo = `${lap ? lapLabel(lap) : ''} · ${formatAxisTime(lt, 0.001)} s · ${Number.isFinite(d) ? d.toFixed(0) + ' m' : ''}`;
    if (laps[1]) delta = `Δ ${lapLabel(laps[1].lap)} vs ref ${formatDelta(varianceAt(computeVariance(ref.lap, laps[1].lap), cursor, xMode))} s`;
  }
  return (
    <div className="statusbar">
      {loading.length > 0 ? (
        <>
          <span>Loading {loading[0].name}…</span>
          <div className="progress">
            <div style={{ width: `${Math.round(loading[0].progress * 100)}%` }} />
          </div>
        </>
      ) : (
        <span>{ref ? `Ref: ${lapLabel(ref.lap)} ${ref.lap.complete ? formatLapTime(ref.lap.time) : ''}` : 'Ready'}</span>
      )}
      {laps.length > 1 && (
        <>
          <span className="sep" />
          <span>{laps.length - 1} overlay{laps.length > 2 ? 's' : ''}</span>
        </>
      )}
      {cursorInfo && (
        <>
          <span className="sep" />
          <span className="num">Cursor: {cursorInfo}</span>
        </>
      )}
      {delta && (
        <>
          <span className="sep" />
          <span className="num">{delta}</span>
        </>
      )}
      {zoom && (
        <>
          <span className="sep" />
          <span className="num">
            Zoom {xMode === 'time' ? `${zoom[0].toFixed(2)}–${zoom[1].toFixed(2)} s` : `${zoom[0].toFixed(0)}–${zoom[1].toFixed(0)} m`}
          </span>
        </>
      )}
      <span className="grow" />
      <span className="muted">
        {units.speed} · °{units.temperature} · {units.pressure}
      </span>
      <span className="muted">Project-Trace {version}</span>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          <span>{t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : 'ℹ'}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
