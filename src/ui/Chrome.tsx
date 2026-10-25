// App chrome: top bar, worksheet tabs, status bar, toasts.

import { useEffect, useRef, useState } from 'react';
import { computeVariance, varianceAt, xToTime } from '../core/axis';
import { formatAxisTime, formatDelta, formatLapTime, prettyCar, prettyTrack } from '../core/format';
import { lapAtTime, lapDistAt, lapLabel } from '../core/session';
import {
  activeSheet,
  activeWorkspace,
  addWorksheet,
  deleteWorksheet,
  duplicateWorksheet,
  exportWorksheet,
  exportWorkspace,
  importWorkspace,
  moveWorksheet,
  openProperties,
  openWorkspacesFolder,
  renameWorksheet,
  resetSheetToStarter,
  saveCurrentWorkspace,
  saveSheetToLibrary,
  saveWorkspaceAs,
  setActiveWorkspace,
  selectedLaps,
  setActiveSheet,
  setSmoothing,
  SMOOTH_PRESETS,
  setUi,
  setXMode,
  resetView,
  useStore,
} from '../state/store';
import { addMenu } from './SheetView';
import { openMenu, promptText, useDismiss, type MenuItem } from './overlays';
import { toggleVarianceAll } from '../actions';
import { keyHint, shortcutHint } from '../shortcuts';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <path d="M5 21 C 9 21, 10 9, 14 9 S 18 23, 22 23 S 25 13, 27 11" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}


/** Smoothing toggle + amount popover (display only; statistics use raw data). */
function SmoothingControl() {
  const sm = useStore((s) => s.settings.smoothing);
  const hint = useStore((s) => shortcutHint('toggle-smoothing', s.settings.shortcuts));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const label = sm.enabled ? (sm.seconds < 1 ? (sm.seconds * 1000).toFixed(0) + ' ms' : sm.seconds.toFixed(1) + ' s') : 'off';
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="smooth-ctl" title={`Smoothing: display-only moving average for graph traces${hint ? ` (${hint})` : ''}`}>
        <button className={sm.enabled ? 'on' : ''} onClick={() => setSmoothing({ enabled: !sm.enabled })}>
          〰 Smooth {label}
        </button>
        <button onClick={() => setOpen((o) => !o)} title="Smoothing amount">
          ▾
        </button>
      </div>
      {open && (
        <div className="popover" style={{ position: 'absolute', top: 32, right: 0, width: 300, padding: 12 }}>
          <label className="check" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={sm.enabled} onChange={(e) => setSmoothing({ enabled: e.target.checked })} />
            Smooth graph traces
          </label>
          <div className="row">
            <input
              type="range"
              className="grow"
              min={0}
              max={SMOOTH_PRESETS.length - 1}
              step={1}
              value={Math.max(0, SMOOTH_PRESETS.findIndex((p) => p >= sm.seconds - 1e-6))}
              onChange={(e) => setSmoothing({ seconds: SMOOTH_PRESETS[Number(e.target.value)], enabled: true })}
            />
            <span className="num" style={{ width: 60, textAlign: 'right' }}>
              {sm.seconds < 1 ? `${(sm.seconds * 1000).toFixed(0)} ms` : `${sm.seconds.toFixed(1)} s`}
            </span>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {SMOOTH_PRESETS.map((p) => (
              <button key={p} className={'btn small' + (sm.enabled && Math.abs(sm.seconds - p) < 1e-6 ? ' active' : '')} onClick={() => setSmoothing({ seconds: p, enabled: true })}>
                {p < 1 ? `${p * 1000} ms` : `${p} s`}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
            A centred moving average over the chosen window, applied to graph traces and their legend values only. Off = the raw logged samples. Reports and
            statistics always use raw data.
          </div>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const sessions = useStore((s) => s.sessions);
  const xMode = useStore((s) => s.xMode);
  const zoom = useStore((s) => s.zoom);
  const measure = useStore((s) => s.measure);
  const shortcuts = useStore((s) => s.settings.shortcuts);
  const ws = useStore((s) => activeWorkspace(s));
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  const ref = selectedLaps()[0];
  const s0 = ref?.session ?? sessions[0];
  // Current key binding for an action, for tooltips (follows the shortcut editor).
  const k = (id: string) => {
    const h = shortcutHint(id, shortcuts);
    return h ? ` (${h})` : '';
  };
  // Highlighted while a graph on this worksheet is actually showing its variance pane (needs 2+ laps).
  const varianceOn = useStore((s) => s.laps.length > 1 && Object.values(activeSheet(s)?.components ?? {}).some((c) => c.type === 'graph' && c.showVariance));
  const canReset = !!zoom || !!measure;

  return (
    <div className="topbar">
      <div className="brand">
        <Logo />
        <span>Project-Trace</span>
      </div>
      <button className="btn primary" onClick={() => setUi({ browser: true })} title={`Session browser${k('open-browser')}`}>
        Open
      </button>
      {s0 ? (
        // The track is the way into the Track editor (corners, ranges, speed buckets, splits, rotation).
        <button className="session-pill clickable" title={`Edit this track — corners, ranges, speed buckets, splits, map rotation${k('track-profile')}`} onClick={() => setUi({ trackProfile: true })}>
          <b>{prettyTrack(s0.meta.venue).track}</b>
          <span className="muted">{prettyCar(s0.meta.vehicle)}</span>
          {sessions.length > 1 && <span className="tag">+{sessions.length - 1} more</span>}
          <span className="pill-action">Edit track ›</span>
        </button>
      ) : (
        <span className="muted">No session open</span>
      )}
      <span className="grow" />
      <button className="btn ghost ws-label" title="Workspaces: switch, save, open the workspaces folder, import or export" onClick={(e) => openMenu(e, workspaceMenuItems())}>
        ▦ {ws?.name}
        {ws?.locked ? ' (default)' : ''} ▾
      </button>
      <button
        className="btn"
        onClick={() => saveCurrentWorkspace()}
        title={ws?.locked ? `Defaults are read-only — save your own copy${k('ws-save')}` : `Save this workspace to your workspaces folder${k('ws-save')}`}
      >
        {ws?.locked ? 'Save as…' : 'Save'}
      </button>
      <div className="seg" title={`X axis${k('toggle-x')}`}>
        <button className={xMode === 'time' ? 'on' : ''} onClick={() => setXMode('time')}>
          Time
        </button>
        <button className={xMode === 'distance' ? 'on' : ''} onClick={() => setXMode('distance')}>
          Distance
        </button>
      </div>
      <SmoothingControl />
      <button
        className={'btn' + (varianceOn ? ' active' : '')}
        onClick={toggleVarianceAll}
        title={`${varianceOn ? 'Hide' : 'Show'} time variance in this worksheet's graphs${k('toggle-variance')}`}
      >
        Δ Variance
      </button>
      {/* Not disabled when there's nothing to reset, so its tooltip (with the key binding) still shows. */}
      <button className={'btn' + (canReset ? '' : ' idle')} onClick={resetView} title={`Reset view: whole lap, clear measurement${k('reset-view')}`}>
        Reset view
      </button>
      <button className="btn" onClick={() => openProperties()} title={`Properties of the selected component (side panel${k('toggle-inspector')})`}>
        ☰ Properties
      </button>
      <button className="btn" onClick={() => setUi({ math: true })} title={`Math channels${k('math')}`}>
        ƒx Math
      </button>
      <button className="btn icon" onClick={() => setUi({ palette: true })} title={`Command palette${k('palette')}`}>
        ⌘
      </button>
      <button className="btn icon" onClick={() => setUi({ settings: true })} title={`Settings${k('settings')}`}>
        ⚙
      </button>
      <button className="btn icon" onClick={() => setUi({ shortcuts: true })} title={`Keyboard shortcuts & shortcut editor${k('shortcuts')}`}>
        ?
      </button>
    </div>
  );
}

/** Workspace switcher and file actions (top bar). */
function workspaceMenuItems(): MenuItem[] {
  const st = useStore.getState();
  const builtIn = st.workspaces.filter((w) => w.locked);
  const mine = st.workspaces.filter((w) => !w.locked);
  const item = (w: (typeof st.workspaces)[number]) => ({ label: w.name, checked: w.id === st.settings.activeWorkspaceId, onClick: () => setActiveWorkspace(w.id) });
  return [
    { header: 'Defaults (read-only)' },
    ...builtIn.map(item),
    { header: 'My workspaces' },
    ...mine.map(item),
    { separator: true },
    { label: 'Save', shortcut: keyHint('ws-save'), onClick: () => saveCurrentWorkspace() },
    { label: 'Save as…', onClick: () => saveWorkspaceAs() },
    { label: 'Open workspaces folder', onClick: openWorkspacesFolder },
    { separator: true },
    { label: 'Import workspace…', onClick: importWorkspace },
    { label: 'Export workspace…', onClick: exportWorkspace },
  ];
}

export function sheetMenuItems(i: number, startRename: () => void) {
  const ws = activeWorkspace();
  const sh = ws.worksheets[i];
  return [
    { header: sh.name },
    { label: 'Rename', onClick: startRename },
    { label: 'Duplicate', onClick: () => duplicateWorksheet(i) },
    { label: 'Reset to Starter version', onClick: () => resetSheetToStarter(i) },
    { separator: true },
    {
      label: 'Save to worksheet library…',
      onClick: async () => {
        const name = await promptText('Save worksheet to your library as', sh.name);
        if (name) saveSheetToLibrary(i, name);
      },
    },
    { label: 'Export to file…', onClick: () => exportWorksheet(i) },
    { separator: true },
    { label: 'Move left', disabled: i === 0, onClick: () => moveWorksheet(i, i - 1) },
    { label: 'Move right', disabled: i === ws.worksheets.length - 1, onClick: () => moveWorksheet(i, i + 1) },
    { separator: true },
    { label: 'Delete', disabled: ws.worksheets.length <= 1, onClick: () => deleteWorksheet(i) },
  ];
}

export function SheetTabs() {
  const ws = useStore((s) => activeWorkspace(s));
  const [editing, setEditing] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  useEffect(() => {
    const h = () => setEditing(activeWorkspace().activeSheet);
    window.addEventListener('pt-rename-sheet', h);
    return () => window.removeEventListener('pt-rename-sheet', h);
  }, []);
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
            openMenu(e, sheetMenuItems(i, () => setEditing(i)));
          }}
          title={i < 9 && keyHint(`sheet-${i + 1}`) ? `Worksheet ${i + 1} (${keyHint(`sheet-${i + 1}`)})` : undefined}
        >
          {editing === i ? (
            <input
              className="input"
              autoFocus
              defaultValue={sh.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== sh.name) renameWorksheet(i, v);
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
  const refColors = useStore((s) => s.settings.refColors);
  const shortcuts = useStore((s) => s.settings.shortcuts);
  const datum = useStore((s) => s.datum);
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
          <span>
            {laps.length - 1} overlay{laps.length > 2 ? 's' : ''}
          </span>
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
      {datum && (
        <>
          <span className="sep" />
          <span className="datum-badge" title="The cursor is pinned. Press the datum key again, or right-click a graph → Release datum.">
            ⚑ Datum{shortcutHint('toggle-datum', shortcuts) ? ` — ${shortcutHint('toggle-datum', shortcuts)} to release` : ''}
          </span>
        </>
      )}
      {zoom && (
        <>
          <span className="sep" />
          <span className="num">Zoom {xMode === 'time' ? `${zoom[0].toFixed(2)}–${zoom[1].toFixed(2)} s` : `${zoom[0].toFixed(0)}–${zoom[1].toFixed(0)} m`}</span>
        </>
      )}
      <span className="grow" />
      <span className="muted" title="Reference lap colours — toggle with the shortcut shown">
        ref colours: {refColors === 'channel' ? 'per channel' : 'lap colour'} ({shortcutHint('toggle-ref-colors', shortcuts) ?? '—'})
      </span>
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
