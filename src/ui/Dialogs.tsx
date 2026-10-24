// Settings, keyboard shortcuts and the command palette.

import { useMemo, useState } from 'react';
import { pt } from '../core/bridge';
import { buildCommands } from '../actions';
import { DEFAULT_SETTINGS, setSmoothing, setUi, updateSettings, useStore } from '../state/store';

export function SettingsDialog() {
  const s = useStore((st) => st.settings);
  const info = useStore((st) => st.appInfo);
  const close = () => setUi({ settings: false });
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
      <div className="modal" style={{ width: 720 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
        </div>
        <div className="modal-body">
          {row(
            'Telemetry folder',
            <div className="row">
              <div className="code-path grow">{s.telemetryRoot || 'Not set'}</div>
              <button
                className="btn"
                onClick={async () => {
                  const p = await pt().chooseFolder(s.telemetryRoot || undefined);
                  if (p) updateSettings({ telemetryRoot: p });
                }}
              >
                Change…
              </button>
            </div>,
            'Telemetrick export folder (exported, a driver folder or a car folder).',
          )}
          {row('Speed', seg(s.units.speed, [['kph', 'km/h'], ['mph', 'mph'], ['m/s', 'm/s']], (v) => updateSettings({ units: { ...s.units, speed: v } })))}
          {row('Temperature', seg(s.units.temperature, [['C', '°C'], ['F', '°F']], (v) => updateSettings({ units: { ...s.units, temperature: v } })))}
          {row('Pressure', seg(s.units.pressure, [['psi', 'psi'], ['bar', 'bar'], ['kPa', 'kPa']], (v) => updateSettings({ units: { ...s.units, pressure: v } })))}
          {row('Distance axis', seg(s.units.distance, [['m', 'metres'], ['km', 'km'], ['mi', 'miles']], (v) => updateSettings({ units: { ...s.units, distance: v } })))}
          {row('Theme', seg(s.theme, [['dark', 'Dark'], ['light', 'Light']], (v) => updateSettings({ theme: v })))}
          {row(
            'Cursor',
            seg(s.cursorMode, [['click', 'Click to place, drag to zoom'], ['scrub', 'Drag to scrub, double-click-drag to zoom'], ['hover', 'Follows mouse']], (v) => updateSettings({ cursorMode: v })),
            'Classic (MoTeC): click places the cursor, drag zooms, double-click resets. Scrub: click/drag moves the cursor, double-click then drag zooms. Follows mouse: like classic, but the cursor tracks the pointer. Shift+drag measures in every mode.',
          )}
          {row(
            'Reference lap colours',
            seg(s.refColors, [['channel', 'Per channel'], ['lap', 'Single lap colour']], (v) => updateSettings({ refColors: v })),
            'Overlay laps are always drawn solid in their lap colour. Toggle the reference lap with J.',
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
            'Display-only moving average for graph traces (also in the top bar; S toggles). Reports always use raw data.',
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
            'Data folder',
            <div className="row">
              <div className="code-path grow">{info?.userData}</div>
            </div>,
            'Settings, workspaces, notes and the session cache live here.',
          )}
        </div>
        <div className="modal-foot">
          <button
            className="btn"
            onClick={() =>
              window.confirm('Reset all settings (not workspaces) to defaults?') &&
              updateSettings({ ...DEFAULT_SETTINGS, telemetryRoot: s.telemetryRoot, activeWorkspaceId: s.activeWorkspaceId, recent: s.recent })
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

const SHORTCUTS: [string, string][] = [
  ['Ctrl/⌘ + O', 'Session browser'],
  ['Ctrl/⌘ + Shift + O', 'Open CSV files directly'],
  ['Ctrl/⌘ + K', 'Command palette'],
  ['Ctrl/⌘ + M', 'Math channel editor'],
  ['Ctrl/⌘ + ,', 'Settings'],
  ['Ctrl/⌘ + Z', 'Undo (deleted components, panes, channels, worksheets, layouts…)'],
  ['Ctrl/⌘ + Y, Ctrl/⌘ + Shift + Z', 'Redo'],
  ['Ctrl/⌘ + I', 'Properties of the selected component'],
  ['Ctrl/⌘ + B', 'Toggle sidebar'],
  ['Ctrl/⌘ + E', 'Export visible data to CSV'],
  ['Ctrl/⌘ + Shift + S', 'Save screenshot'],
  ['D', 'Toggle time / distance x-axis'],
  ['F3 or V', 'Toggle time variance pane'],
  ['F', 'Fastest lap as reference'],
  ['W', 'Zoom to the whole reference lap'],
  ['J', 'Reference lap: channel colours ⇄ single lap colour'],
  ['S', 'Toggle trace smoothing'],
  ['↑ / ↓ (also PgUp / PgDn, [ / ])', 'Previous / next lap as reference'],
  ['← / →', 'Move cursor (Shift = bigger steps)'],
  ['+ / −', 'Zoom in / out around the cursor'],
  ['Esc or Home', 'Reset zoom and clear measurement'],
  ['1 … 9', 'Switch worksheet'],
  ['Click / drag (graph)', 'Move the cursor (scrub through the data)'],
  ['Double-click + drag (graph)', 'Zoom to the dragged range'],
  ['Drag a pane border (graph)', 'Resize panes'],
  ['Shift + drag (graph)', 'Measure range: min / avg / max / Δ'],
  ['Wheel (graph)', 'Zoom; Shift+wheel or trackpad swipe pans'],
  ['Right/middle drag, Ctrl+drag', 'Pan'],
  ['Drag a rectangle (scatter, trend, histogram, FFT)', 'Zoom into that area (double-click resets)'],
  ['Drag the dial ring (track map / GPS track)', 'Rotate the map; Save stores it for the track'],
  ['Double-click (map)', 'Reset map view'],
  ['Click (track map)', 'Move the cursor to that point'],
  ['Ctrl/⌘ + click (lap)', 'Add / remove overlay lap'],
  ['Click a selected lap’s colour square', 'Change that lap’s colour'],
  ['Right-click any component', 'Its options + Properties… / Remove component'],
  ['Shift + click (lap)', 'Make reference lap'],
  ['Drag channel', 'Onto any graph pane, histogram, report, gauge or track map'],
  ['Drag component header', 'Dock elsewhere (edges split, centre swaps)'],
];

export function ShortcutsDialog() {
  const close = () => setUi({ shortcuts: false });
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" style={{ width: 640 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Keyboard & mouse</h2>
        </div>
        <div className="modal-body">
          <table className="grid">
            <tbody>
              {SHORTCUTS.map(([k, v]) => (
                <tr key={k}>
                  <td className="l" style={{ width: 230 }}>
                    <span className="kbd">{k}</span>
                  </td>
                  <td className="l">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={close}>
            Close
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
