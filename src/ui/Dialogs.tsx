// Settings, keyboard shortcuts and the command palette.

import { useEffect, useMemo, useState } from 'react';
import { pt } from '../core/bridge';
import { buildCommands } from '../actions';
import { bindings, comboFromEvent, formatCombo, keyHint, SHORTCUTS } from '../shortcuts';
import { DEFAULT_SETTINGS, setDefaultTelemetryFolder, setSmoothing, setUi, telemetryFolders, toast, updateSettings, useStore } from '../state/store';
import { MasterChannelsPanel } from './MasterChannels';
import { SIMS, type LiveSettings } from '../core/sims';
import { useLive } from '../state/live';

export function SettingsDialog() {
  const s = useStore((st) => st.settings);
  const info = useStore((st) => st.appInfo);
  const [wsDir, setWsDir] = useState('');
  useEffect(() => {
    pt().workspacesDir().then(setWsDir);
  }, []);
  const close = () => setUi({ settings: false });
  const tab = useStore((st) => st.ui.settingsTab ?? 'general');
  const setTab = (t: 'general' | 'masters') => setUi({ settingsTab: t });
  const live = s.live;
  const liveStatus = useLive();
  const setLive = (patch: Partial<LiveSettings>) => updateSettings({ live: { ...live, ...patch } });
  const folders = telemetryFolders(s);
  const seg = <T extends string>(value: T, options: [T, string][], onChange: (v: T) => void) => (
    <div className="seg">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
  const row = (label: string, control: React.ReactNode, hint?: string) => (
    <div className="row" style={{ alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 210 }}>
        <div>{label}</div>
        {hint && (
          <div className="muted" style={{ fontSize: 11.5 }}>
            {hint}
          </div>
        )}
      </div>
      <div className="grow">{control}</div>
    </div>
  );
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" style={{ width: tab === 'masters' ? 980 : 720 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <span className="grow" />
          {seg(tab, [['general', 'General'], ['masters', 'Master channels']], setTab)}
        </div>
        {tab === 'masters' ? (
          <div className="modal-body">
            <MasterChannelsPanel />
          </div>
        ) : (
        <div className="modal-body">
          {row('Theme', seg(s.theme, [['dark', 'Dark'], ['light', 'Light']], (v) => updateSettings({ theme: v })), 'Also in View → Theme; you can give it a key in Keyboard Shortcuts.')}
          {row(
            'Telemetry folder',
            <div className="row">
              <div className="code-path grow">{s.telemetryRoot || 'Not set'}</div>
              <button
                className="btn"
                onClick={async () => {
                  const p = await pt().chooseFolder(s.telemetryRoot || undefined);
                  if (p) setDefaultTelemetryFolder(p);
                }}
              >
                Change…
              </button>
            </div>,
            'Default Telemetrick export folder (exported, a driver folder or a car folder). Add more folder shortcuts in the session browser.',
          )}
          {row(
            'Live mode',
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="check">
                <input type="checkbox" checked={live.enabled} onChange={(e) => setLive({ enabled: e.target.checked })} />
                Open new exports automatically
              </label>
              {live.enabled && (
                <>
                  <div className="row">
                    <span className="muted" style={{ fontSize: 12 }}>
                      New session:
                    </span>
                    {seg(live.action, [['add', 'Add to the open sessions'], ['replace', 'Replace them']], (v) => setLive({ action: v }))}
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={live.requireSim} onChange={(e) => setLive({ requireSim: e.target.checked })} />
                    Only while a sim is running (or was in the last 15 minutes)
                  </label>
                  {live.requireSim && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 22 }}>
                      {SIMS.map((sim) => (
                        <label key={sim.id} className="check" title={sim.processes.join(', ')}>
                          <input
                            type="checkbox"
                            checked={live.sims.includes(sim.id)}
                            onChange={(e) => setLive({ sims: e.target.checked ? [...live.sims, sim.id] : live.sims.filter((x) => x !== sim.id) })}
                          />
                          {sim.name}
                        </label>
                      ))}
                      <input
                        className="input"
                        placeholder="Other programs, e.g. MySim.exe, OtherSim.exe"
                        value={live.extraProcesses}
                        onChange={(e) => setLive({ extraProcesses: e.target.value })}
                      />
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {liveStatus.simRunning === null ? 'Checking…' : liveStatus.simRunning ? '● A chosen sim is running now.' : '○ No chosen sim running.'}
                      </div>
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {folders.length
                      ? `Watching ${liveStatus.watching} of ${folders.length} telemetry folder${folders.length === 1 ? '' : 's'} (and everything inside): ${folders.map((f) => f.name).join(', ')}.`
                      : 'Set a telemetry folder above first — Live mode watches your telemetry folders.'}
                  </div>
                </>
              )}
            </div>,
            "Finish a run in the sim and the new export opens here by itself, as long as Project-Trace is running. It never takes focus from the sim — the taskbar / Dock icon flashes instead. Leave 'only while a sim is running' off if your telemetry syncs to another computer.",
          )}
          {row('Speed', seg(s.units.speed, [['kph', 'km/h'], ['mph', 'mph'], ['m/s', 'm/s']], (v) => updateSettings({ units: { ...s.units, speed: v } })))}
          {row('Temperature', seg(s.units.temperature, [['C', '°C'], ['F', '°F']], (v) => updateSettings({ units: { ...s.units, temperature: v } })))}
          {row('Pressure', seg(s.units.pressure, [['psi', 'psi'], ['bar', 'bar'], ['kPa', 'kPa']], (v) => updateSettings({ units: { ...s.units, pressure: v } })))}
          {row('Distance axis', seg(s.units.distance, [['m', 'metres'], ['km', 'km'], ['mi', 'miles']], (v) => updateSettings({ units: { ...s.units, distance: v } })))}
          {row(
            'Cursor',
            seg(s.cursorMode, [['click', 'Click to place, drag to zoom'], ['scrub', 'Drag to scrub, double-click-drag to zoom'], ['hover', 'Follows mouse']], (v) => updateSettings({ cursorMode: v })),
            'Classic (MoTeC): click places the cursor, drag zooms, double-click resets. Scrub: click/drag moves the cursor, double-click then drag zooms. Follows mouse: like classic, but the cursor tracks the pointer. Shift+drag measures in every mode.',
          )}
          {row(
            'Reference lap colours',
            seg(s.refColors, [['channel', 'Per channel'], ['lap', 'Single lap colour']], (v) => updateSettings({ refColors: v })),
            `Overlay laps are always drawn solid in their lap colour. Toggle the reference lap with ${keyHint('toggle-ref-colors') ?? 'a shortcut'} (editable in Keyboard Shortcuts).`,
          )}
          {row(
            'Smoothing',
            <div className="row">
              {seg(s.smoothing.enabled ? 'on' : 'off', [['off', 'Off (raw)'], ['on', 'On']], (v) => setSmoothing({ enabled: v === 'on' }))}
              <select className="input" style={{ width: 110 }} value={s.smoothing.seconds} onChange={(e) => setSmoothing({ seconds: Number(e.target.value) })}>
                {[0.03, 0.05, 0.1, 0.2, 0.35, 0.5, 1].map((v) => (
                  <option key={v} value={v}>
                    {v < 1 ? `${v * 1000} ms` : `${v} s`}
                  </option>
                ))}
              </select>
            </div>,
            `Display-only moving average for graph traces (also in the top bar${keyHint('toggle-smoothing') ? `; ${keyHint('toggle-smoothing')} toggles` : ''}). On by default at 50 ms. Reports always use raw data.`,
          )}
          {row(
            'In-game clock',
            seg(s.gameClock, [['track', 'Track local time'], ['utc', 'Raw UTC']], (v) => updateSettings({ gameClock: v })),
            "CSP logs the sim clock as UTC. 'Track local' converts it to the circuit's time zone (editable per track in the session browser).",
          )}
          {row(
            'On launch',
            <label className="check">
              <input type="checkbox" checked={s.showBrowserOnLaunch} onChange={(e) => updateSettings({ showBrowserOnLaunch: e.target.checked })} />
              Open the session browser
            </label>,
          )}
          {row(
            'Workspaces folder',
            <div className="row">
              <div className="code-path grow">{wsDir || '…'}</div>
              <button className="btn" onClick={() => pt().openWorkspacesDir()}>
                Open
              </button>
            </div>,
            'Every workspace is a .json file here, named after it. Drop in a workspace someone shared and it appears in the Workspace menu.',
          )}
          {row(
            'Data folder',
            <div className="row">
              <div className="code-path grow">{info?.userData}</div>
            </div>,
            'Settings, notes and the session cache live here.',
          )}
        </div>
        )}
        <div className="modal-foot">
          <button
            className="btn"
            onClick={() =>
              window.confirm('Reset all settings (not workspaces) to defaults?') &&
              updateSettings({ ...DEFAULT_SETTINGS, telemetryRoot: s.telemetryRoot, activeWorkspaceId: s.activeWorkspaceId, recent: s.recent, trackProfiles: s.trackProfiles, shortcuts: s.shortcuts })
            }
          >
            Reset to defaults
          </button>
          <span className="grow" />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mouse gestures (fixed; keyboard shortcuts are editable above them). */
const MOUSE: [string, string][] = [
  ['Click / drag (graph)', 'Move the cursor (scrub through the data)'],
  ['Drag (graph, classic cursor mode)', 'Zoom to the dragged range — the track map and GPS track zoom to it too'],
  ['Drag a pane border (graph)', 'Resize panes'],
  ['Shift + drag (graph)', 'Measure range: min / avg / max / Δ'],
  ['Wheel (graph)', 'Zoom; Shift+wheel or trackpad swipe pans'],
  ['Right/middle drag, Ctrl+drag', 'Pan'],
  ['Drag a rectangle (scatter, trend, histogram, FFT)', 'Zoom into that area (double-click resets)'],
  ['Drag the dial ring (track map / GPS track)', 'Rotate the map; Save stores it for the track'],
  ['Double-click (map)', 'Reset map view'],
  ['Click (track map)', 'Move the cursor to that point'],
  ['Click a lap', 'Show only that lap · Ctrl/⌘+click adds/removes it · Shift+click makes it the reference'],
  ['Click a selected lap’s colour square', 'Remove that lap (right-click it to change its colour)'],
  ['Right-click any component', 'Its main options + Properties… / Maximise / Remove component'],
  ['Drag channel', 'Onto any graph pane, histogram, report, gauge or track map'],
  ['Drag component header', 'Dock elsewhere (edges split, centre swaps)'],
  ['Ctrl/⌘ + Z · Ctrl/⌘ + Y (Shift+⌘+Z)', 'Undo · redo'],
];

function setShortcut(id: string, keys: string[]) {
  const overrides = { ...useStore.getState().settings.shortcuts };
  const def = SHORTCUTS.find((d) => d.id === id)!.keys;
  if (keys.length === def.length && keys.every((k, i) => k === def[i])) delete overrides[id];
  else overrides[id] = keys;
  updateSettings({ shortcuts: overrides });
}

export function ShortcutsDialog() {
  const close = () => setUi({ shortcuts: false });
  const overrides = useStore((s) => s.settings.shortcuts);
  const [recording, setRecording] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const b = bindings(overrides);

  // While recording, the next key combo is captured here (before the app's own shortcut handler).
  useEffect(() => {
    if (!recording) return;
    setUi({ recordingShortcut: true });
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = comboFromEvent(e);
      if (!combo) return;
      if (combo === 'Escape') {
        setRecording(null);
        return;
      }
      // A combo belongs to one action: take it away from any other action that had it.
      for (const d of SHORTCUTS)
        if (d.id !== recording && b[d.id].includes(combo)) {
          setShortcut(d.id, b[d.id].filter((k) => k !== combo));
          toast(`${formatCombo(combo)} was removed from “${d.label}”`, 'info', 2500);
        }
      if (!b[recording].includes(combo)) setShortcut(recording, [...b[recording], combo]);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setUi({ recordingShortcut: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const groups = [...new Set(SHORTCUTS.map((d) => d.group))];
  const q = filter.trim().toLowerCase();
  return (
    <div className="modal-back" onMouseDown={() => !recording && close()}>
      <div className="modal" style={{ width: 760 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Keyboard shortcuts</h2>
          <span className="grow" />
          <input className="input" style={{ width: 220 }} placeholder="Search actions…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="modal-body" style={{ overflowX: 'hidden' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Click <b>+ Add</b> and press the keys you want. Click a key to remove it. Each key combo can belong to one action only. Actions marked
            <i> not set</i> have no default key — give them one if you use them a lot.
          </div>
          {groups.map((g) => {
            const defs = SHORTCUTS.filter((d) => d.group === g && (!q || d.label.toLowerCase().includes(q)));
            if (!defs.length) return null;
            return (
              <div key={g}>
                <div className="section-title" style={{ padding: '10px 0 4px' }}>
                  {g}
                </div>
                <table className="grid">
                  <tbody>
                    {defs.map((d) => (
                      <tr key={d.id}>
                        <td className="l">{d.label}</td>
                        <td className="l" style={{ width: 330 }}>
                          <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                            {b[d.id].map((k) => (
                              <button key={k} className="kbd shortcut-key" title="Remove this key" onClick={() => setShortcut(d.id, b[d.id].filter((x) => x !== k))}>
                                {formatCombo(k)} <span className="muted">×</span>
                              </button>
                            ))}
                            {!b[d.id].length && recording !== d.id && <span className="muted" style={{ fontSize: 12 }}>not set</span>}
                            {recording === d.id ? (
                              <span className="kbd recording">Press keys… (Esc cancels)</span>
                            ) : (
                              <button className="btn small ghost" onClick={() => setRecording(d.id)}>
                                + Add
                              </button>
                            )}
                            {overrides[d.id] && (
                              <button className="btn small ghost" title="Restore the default keys" onClick={() => setShortcut(d.id, d.keys)}>
                                Reset
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          <div className="section-title" style={{ padding: '14px 0 4px' }}>
            Mouse
          </div>
          <table className="grid">
            <tbody>
              {MOUSE.map(([k, v]) => (
                <tr key={k}>
                  <td className="l" style={{ width: 260 }}>
                    <span className="kbd">{k}</span>
                  </td>
                  <td className="l">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-foot">
          <button className="btn" disabled={!Object.keys(overrides).length} onClick={() => window.confirm('Restore every keyboard shortcut to its default?') && updateSettings({ shortcuts: {} })}>
            Reset all to defaults
          </button>
          <span className="grow" />
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function CommandPalette() {
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const cmds = useMemo(buildCommands, []);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return cmds.filter((c) => words.every((w) => c.label.toLowerCase().includes(w))).slice(0, 40);
  }, [q, cmds]);
  const close = () => setUi({ palette: false });
  const run = (i: number) => {
    const c = list[i];
    if (!c) return;
    close();
    setTimeout(c.run, 0);
  };
  return (
    <div className="modal-back" style={{ alignItems: 'flex-start' }} onMouseDown={close}>
      <div className="popover palette" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
          <input
            className="input"
            autoFocus
            placeholder="Type a command…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHl(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setHl((h) => Math.min(list.length - 1, h + 1));
              else if (e.key === 'ArrowUp') setHl((h) => Math.max(0, h - 1));
              else if (e.key === 'Enter') run(hl);
              else if (e.key === 'Escape') close();
            }}
          />
        </div>
        <div className="list menu">
          {list.map((c, i) => (
            <div key={c.id} className="mi" style={i === hl ? { background: 'var(--accent-soft)' } : undefined} onMouseEnter={() => setHl(i)} onClick={() => run(i)}>
              {c.label}
              {c.hint && <span className="k">{c.hint}</span>}
            </div>
          ))}
          {!list.length && <div className="muted" style={{ padding: 10 }}>No matching commands</div>}
        </div>
      </div>
    </div>
  );
}
