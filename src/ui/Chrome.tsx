// App chrome: top bar, worksheet tabs, status bar, toasts.

import { useEffect, useRef, useState } from 'react';
import { computeVariance, varianceAt, xToTime } from '../core/axis';
import { formatAxisTime, formatDelta, formatLapTime, prettyCar, prettyTrack } from '../core/format';
import { fastestLap, lapAtTime, lapDistAt, lapLabel } from '../core/session';
import {
  activeWorkspace,
  addWorksheet,
  deleteWorksheet,
  duplicateWorksheet,
  exportWorksheet,
  moveWorksheet,
  openProperties,
  renameWorksheet,
  resetSheetToStarter,
  saveSheetToLibrary,
  selectedLaps,
  setActiveSheet,
  setSmoothing,
  setUi,
  setXMode,
  resetView,
  useStore,
} from '../state/store';
import { addMenu } from './SheetView';
import { openMenu, promptText } from './overlays';
import { toggleVarianceAll } from '../actions';
import { shortcutHint } from '../shortcuts';

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent)" />
      <path d="M5 21 C 9 21, 10 9, 14 9 S 18 23, 22 23 S 25 13, 27 11" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const SMOOTH_PRESETS = [0.03, 0.05, 0.1, 0.2, 0.35, 0.5, 1];

/** Smoothing toggle + amount popover (display only; statistics use raw data). */
function SmoothingControl() {
  const sm = useStore((s) => s.settings.smoothing);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const label = sm.enabled ? `Smoothing ${sm.seconds < 1 ? (sm.seconds * 1000).toFixed(0) + ' ms' : sm.seconds.toFixed(1) + ' s'}` : 'Smoothing off';
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="smooth-ctl" title="Display smoothing for graph traces (S)">
        <button className={sm.enabled ? 'on' : ''} onClick={() => setSmoothing({ enabled: !sm.enabled })}>
          〰 {label}
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
  const fl = s0 ? fastestLap(s0) : undefined;

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
      <span className="ws-label" title="Current workspace — switch, save, export or import from the Workspace menu">
        ▦ {ws?.name}
        {ws?.locked ? ' (read-only)' : ''}
      </span>
      <div className="seg" title="X axis (D)">
        <button className={xMode === 'time' ? 'on' : ''} onClick={() => setXMode('time')}>
          Time
        </button>
        <button className={xMode === 'distance' ? 'on' : ''} onClick={() => setXMode('distance')}>
          Distance
        </button>
      </div>
      <SmoothingControl />
      <button className="btn" onClick={toggleVarianceAll} title="Toggle time variance in this worksheet's graphs (F3)">
        Δ Variance
      </button>
      <button className="btn" disabled={!zoom && !measure} onClick={resetView} title={`Reset view: whole lap, clear measurement (${shortcutHint('reset-view', shortcuts) ?? 'Esc'})`}>
        Reset view
      </button>
      <button className="btn" onClick={() => openProperties()} title="Properties of the selected component (Ctrl/⌘+I)">
        ☰ Properties
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
          title={i < 9 ? `Worksheet ${i + 1} (press ${i + 1})` : undefined}
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
