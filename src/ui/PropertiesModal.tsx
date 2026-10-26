// Properties pop-out: a large centred window for editing the selected component. Opened from the
// top-bar "Properties" button, Ctrl/⌘+I, or "Properties…" in any component's right-click menu.

import { useEffect, useState } from 'react';
import { CATEGORICAL, channelColors, RAMP_LABELS, type RampName } from '../core/colors';
import { COMPONENT_CATALOG, pane } from '../state/components';
import { activeSheet, activeWorkspace, addComponent, removeComponentById, selectedLaps, setChannelProps, setGraphMarkers, setUi, updateComponent, useStore } from '../state/store';
import { TYRE_FIELDS, uid, type BarRow, type BarsConfig, type ComponentConfig, type GaugeDef, type GraphConfig, type GraphPane, type InputRole, type InputsConfig, type TrackMapConfig } from '../state/workspace';
import { BAR_OPS, barCondition } from '../charts/BarsView';
import { compareLap } from '../charts/TrackMapView';
import { lapLabel } from '../core/session';
import { formatLapTime } from '../core/format';
import { FIT_KINDS, fitSettings, type FitOptions } from '../core/fit';
import { defaultTitle } from '../charts/registry';
import { keyHint } from '../shortcuts';
import { channelLabel, conv, findChannel } from '../charts/data';
import { ChannelPickerButton, ColorField, openChannelPicker, openChannelProps, openColorPicker, openMenu, renameChannel } from './overlays';
import { TrackEditorLink } from './TrackProfileEditor';

function Num({ value, onChange, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string }) {
  const [s, setS] = useState(value == null ? '' : String(value));
  useEffect(() => setS(value == null ? '' : String(value)), [value]);
  const commit = () => {
    const t = s.trim();
    onChange(t === '' ? undefined : Number.isFinite(Number(t)) ? Number(t) : value);
  };
  return <input className="input num" value={s} placeholder={placeholder ?? 'auto'} onChange={(e) => setS(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/** Best-fit line on/off, its kind, and the equation toggle (Lap Trend, Scatter). */
function FitFields({ c, up, note }: { c: FitOptions; up: (p: FitOptions) => void; note: string }) {
  const f = fitSettings(c);
  return (
    <>
      <Check label="Best fit line" value={f.on} onChange={(v) => up({ showFit: v, fit: f.kind })} />
      {f.on && (
        <>
          <F label="Fit type">
            <Select value={f.kind} options={FIT_KINDS} onChange={(v) => up({ fit: v, showFit: true })} />
          </F>
          <Check label="Show the equation and R²" value={f.equation} onChange={(v) => up({ showEquation: v })} />
        </>
      )}
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        {note} Exponential and power fits need positive values, logarithmic and power fits a positive x. R² is how well the line fits (1 = perfectly). Also on
        the chart's right-click menu.
      </div>
    </>
  );
}

const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="field">
    {label}
    {children}
  </label>
);

const G = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="insp-group">
    <h4>{title}</h4>
    {children}
  </div>
);

const rampOptions = Object.entries(RAMP_LABELS) as [RampName, string][];

/** Min/max inputs for one axis. */
function AxisRange({ label, min, max, onChange }: { label: string; min?: number; max?: number; onChange: (min: number | undefined, max: number | undefined) => void }) {
  return (
    <div className="row">
      <span style={{ width: 62, fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }} className="dim">
        {label}
      </span>
      <Num value={min} placeholder="min (auto)" onChange={(v) => onChange(v, max)} />
      <Num value={max} placeholder="max (auto)" onChange={(v) => onChange(min, v)} />
      <button className="btn small" disabled={min == null && max == null} onClick={() => onChange(undefined, undefined)}>
        Auto
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Graph: panes & channels (MoTeC-style)
// ---------------------------------------------------------------------------------------------

function PaneCard({ c, p, i, up }: { c: GraphConfig; p: GraphPane; i: number; up: (patch: Partial<GraphConfig>, label?: string) => void }) {
  const sessions = useStore((s) => s.sessions);
  const theme = useStore((s) => s.settings.theme);
  const cprops = useStore((s) => activeWorkspace(s)?.channelProps) ?? {};
  const colors = channelColors(p.channels, theme, cprops);
  const setPane = (patch: Partial<GraphPane>, label?: string) => up({ panes: c.panes.map((x, k) => (k === i ? { ...x, ...patch } : x)) }, label);
  const move = (d: number) => {
    const panes = c.panes.slice();
    const j = i + d;
    if (j < 0 || j >= panes.length) return;
    [panes[i], panes[j]] = [panes[j], panes[i]];
    up({ panes }, 'Move pane');
  };
  // Drag a pane card by its header onto another card to move it there.
  const [dropOver, setDropOver] = useState(false);
  const dropPane = (from: number) => {
    if (from === i || from < 0 || from >= c.panes.length) return;
    const panes = c.panes.slice();
    const [m] = panes.splice(from, 1);
    panes.splice(i, 0, m);
    up({ panes }, 'Move pane');
  };
  const removeChannel = (name: string) => setPane({ channels: p.channels.filter((x) => x !== name), hidden: p.hidden?.filter((x) => x !== name) }, 'Remove channel');
  const isHidden = (name: string) => !!p.hidden?.includes(name);
  const toggleHidden = (name: string) =>
    setPane({ hidden: isHidden(name) ? (p.hidden ?? []).filter((x) => x !== name) : [...(p.hidden ?? []), name] }, 'Show / hide channel');
  const moveChannelTo = (name: string, target: number | 'new') => {
    const panes = c.panes.map((x, k) => (k === i ? { ...x, channels: x.channels.filter((n) => n !== name), hidden: x.hidden?.filter((n) => n !== name) } : x));
    if (target === 'new') panes.splice(i + 1, 0, pane([name]));
    else panes[target] = { ...panes[target], channels: [...panes[target].channels, name] };
    up({ panes: panes.filter((x) => x.channels.length) }, 'Move channel');
  };
  const rowMenu = (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    openMenu(e, [
      { header: cprops[name]?.label || name },
      { label: 'Rename…', onClick: () => renameChannel(name) },
      { label: isHidden(name) ? 'Show in graph' : 'Hide in graph', onClick: () => toggleHidden(name) },
      { label: 'Channel properties…', onClick: () => openChannelProps(name) },
      { label: 'Colour…', onClick: () => openColorPicker(e, cprops[name]?.color, (col) => setChannelProps(name, { color: col }), { allowAuto: true, title: name }) },
      { separator: true },
      { label: 'Move to its own pane', disabled: p.channels.length <= 1, onClick: () => moveChannelTo(name, 'new') },
      ...c.panes.map((_, k) => ({ label: `Move to pane ${k + 1}`, disabled: k === i, onClick: () => moveChannelTo(name, k) })),
      { separator: true },
      { label: 'Remove from graph', onClick: () => removeChannel(name) },
    ]);
  };
  return (
    <div
      className={'pane-card' + (dropOver ? ' drop-over' : '')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-pt-pane')) return;
        e.preventDefault();
        setDropOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropOver(false)}
      onDrop={(e) => {
        setDropOver(false);
        const from = e.dataTransfer.getData('application/x-pt-pane');
        if (from === '') return;
        e.preventDefault();
        dropPane(Number(from));
      }}
    >
      <div className="ph">
        <span
          className="drag-handle"
          draggable
          title="Drag onto another pane to reorder"
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-pt-pane', String(i));
            e.dataTransfer.effectAllowed = 'move';
          }}
        >
          <span className="drag-grip">⋮⋮</span>
          <b>Pane {i + 1}</b>
        </span>
        <select className="input" style={{ height: 24, width: 200, fontSize: 12 }} value={p.scale} onChange={(e) => setPane({ scale: e.target.value as GraphPane['scale'] })}>
          <option value="auto">Scale: automatic</option>
          <option value="shared">Scale: shared (tiled)</option>
          <option value="independent">Scale: independent (overlapped)</option>
        </select>
        <span className="muted" style={{ fontSize: 11 }}>
          height
        </span>
        <input type="range" min={0.3} max={4} step={0.1} value={p.weight} onChange={(e) => setPane({ weight: Number(e.target.value) }, 'Resize pane')} style={{ width: 90 }} />
        <span className="grow" />
        <button className="btn small icon" title="Move up" onClick={() => move(-1)}>
          ↑
        </button>
        <button className="btn small icon" title="Move down" onClick={() => move(1)}>
          ↓
        </button>
        <button className="btn small icon" title="Remove pane" onClick={() => up({ panes: c.panes.filter((_, k) => k !== i) }, 'Remove pane')}>
          ×
        </button>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th className="l" style={{ width: 30 }} title="Show / hide (also: click the channel's name in the graph legend)">
              Show
            </th>
            <th className="l" style={{ width: 50 }}>
              Colour
            </th>
            <th className="l">Channel</th>
            <th>Unit</th>
            <th>Rate</th>
            <th>Range</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {p.channels.map((name, ci) => {
            const ch = findChannel(sessions, name);
            const props = cprops[name] ?? {};
            return (
              <tr key={name} className="chan-props-row" style={isHidden(name) ? { opacity: 0.55 } : undefined} onContextMenu={(e) => rowMenu(e, name)} onDoubleClick={() => openChannelProps(name)}>
                <td className="l">
                  <button className="btn small icon ghost" title={isHidden(name) ? 'Show this channel' : 'Hide this channel (it stays in the pane)'} onClick={() => toggleHidden(name)}>
                    {isHidden(name) ? '◌' : '◉'}
                  </button>
                </td>
                <td className="l">
                  <span
                    className="lap-color-dot"
                    style={{ background: colors[ci] }}
                    title="Change colour"
                    onClick={(e) => openColorPicker(e, props.color, (col) => setChannelProps(name, { color: col }), { allowAuto: true, title: name })}
                  />
                </td>
                <td className="l">
                  {cprops[name]?.label || name} {cprops[name]?.label && <span className="muted">({name})</span>} {!ch && <span className="muted">(not in session)</span>}
                </td>
                <td className="muted">{ch ? conv(ch).unit : ''}</td>
                <td className="muted num">{ch ? `${ch.rate} Hz` : ''}</td>
                <td className="num muted">{props.min != null || props.max != null ? `${props.min ?? 'auto'} – ${props.max ?? 'auto'}` : 'auto'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small" onClick={() => openChannelProps(name)}>
                    Properties…
                  </button>{' '}
                  <button className="btn small icon" title="Remove" onClick={() => removeChannel(name)}>
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row" style={{ padding: 8, flexWrap: 'wrap' }}>
        <button className="btn small" onClick={(e) => openChannelPicker(e, (n) => !p.channels.includes(n) && setPane({ channels: [...p.channels, n] }, 'Add channel'))}>
          + Add channel to this pane
        </button>
        {p.scale !== 'independent' && (
          <>
            <span className="muted" style={{ fontSize: 11 }}>
              shared y-range
            </span>
            <div style={{ width: 90 }}>
              <Num value={p.min} placeholder="min" onChange={(v) => setPane({ min: v })} />
            </div>
            <div style={{ width: 90 }}>
              <Num value={p.max} placeholder="max" onChange={(v) => setPane({ max: v })} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GraphForm({ c }: { c: GraphConfig }) {
  const up = (p: Partial<GraphConfig>, label?: string) => updateComponent(c.id, p, label);
  return (
    <div className="props-grid">
      <div>
        <G title="Display">
          <Check label={`Time variance pane${keyHint('toggle-variance') ? ` (${keyHint('toggle-variance')})` : ''}`} value={c.showVariance} onChange={(v) => up({ showVariance: v })} />
          <Check label="Legends with live values" value={c.showLegend !== false} onChange={(v) => up({ showLegend: v })} />
          <Check label="Horizontal grid lines" value={c.showGrid !== false} onChange={(v) => up({ showGrid: v })} />
          <F label="Y range">
            <Select value={c.yRange} options={[['full', 'Whole lap'], ['visible', 'Visible (zoomed) area']]} onChange={(v) => up({ yRange: v })} />
          </F>
          <F label={`Reference line width (${c.refLineWidth ?? 1.5}px)`}>
            <input type="range" min={0.5} max={4} step={0.25} value={c.refLineWidth ?? 1.5} onChange={(e) => up({ refLineWidth: Number(e.target.value) })} />
          </F>
          <F label={`Comparison line width (${c.lapLineWidth ?? 1.2}px)`}>
            <input type="range" min={0.5} max={4} step={0.25} value={c.lapLineWidth ?? 1.2} onChange={(e) => up({ lapLineWidth: Number(e.target.value) })} />
          </F>
        </G>
        <G title="Markers (all time / distance graphs)">
          <Check label={`Sector lines (S2, S3…)${keyHint('toggle-sectors') ? ` (${keyHint('toggle-sectors')})` : ''}`} value={c.showSectors} onChange={(v) => setGraphMarkers({ showSectors: v })} />
          <Check label={`Split lines (your splits)${keyHint('toggle-splits') ? ` (${keyHint('toggle-splits')})` : ''}`} value={c.showSplits ?? c.showSectors} onChange={(v) => setGraphMarkers({ showSplits: v })} />
          <Check label={`Corner lines — your saved corners${keyHint('toggle-corners') ? ` (${keyHint('toggle-corners')})` : ''}`} value={c.showCorners} onChange={(v) => setGraphMarkers({ showCorners: v })} />
        </G>
        <G title="Tips">
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            Drag the border between panes on the graph to change their heights. Right-click a channel row (or double-click it) for its properties. Drag channels
            from the sidebar straight onto a pane.
          </div>
        </G>
      </div>
      <div>
        <div className="row">
          <h4 className="grow" style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)' }}>
            Panes & channels (top to bottom)
          </h4>
          <button className="btn small primary" onClick={(e) => openChannelPicker(e, (n) => up({ panes: [...c.panes, pane([n])] }, 'Add pane'))}>
            + Add pane
          </button>
        </div>
        {c.panes.map((p, i) => (
          <PaneCard key={p.id} c={c} p={p} i={i} up={up} />
        ))}
      </div>
    </div>
  );
}

/** Driver Inputs: which channel drives each bar / readout (Automatic = the detected one). */
function InputChannelsForm({ c }: { c: InputsConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  const ref = selectedLaps()[0];
  const set = (role: InputRole, v: string) => updateComponent(c.id, { channels: { ...c.channels, [role]: v === '__auto' ? undefined : v } } as Partial<InputsConfig>, 'Input channel');
  const inv = (role: 'throttle' | 'brake' | 'clutch', v: boolean) => updateComponent(c.id, { invert: { ...c.invert, [role]: v } } as Partial<InputsConfig>, 'Invert pedal');
  const rows: [InputRole, string][] = [
    ['throttle', 'Throttle bar'],
    ['brake', 'Brake bar'],
    ['clutch', 'Clutch bar'],
    ['steering', 'Steering wheel (degrees)'],
    ['gear', 'Gear'],
    ['speed', 'Speed'],
    ['rpm', 'RPM bar'],
  ];
  return (
    <G title="Channels">
      {rows.map(([role, label]) => {
        const detected = ref?.session.key[role];
        const auto = `Automatic${detected ? ` (${channelLabel(detected)})` : ' (none found)'}`;
        return (
          <div key={role}>
            <F label={label}>
              <ChannelPickerButton value={c.channels?.[role] ?? '__auto'} onChange={(v) => set(role, v)} extras={[{ value: '__auto', label: auto }]} />
            </F>
            {(role === 'throttle' || role === 'brake' || role === 'clutch') && (
              <Check
                label="Invert (show 100 − value)"
                value={role === 'clutch' ? c.invert?.clutch ?? /^clutch pos$/i.test(c.channels?.clutch ?? detected ?? '') : !!c.invert?.[role]}
                onChange={(v) => inv(role, v)}
              />
            )}
          </div>
        );
      })}
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
        Pedal bars read 0–100 %: channels logged 0–1 are scaled up, and ones that go above 100 are scaled to their maximum. AC's clutch is logged as
        engagement, so it's inverted automatically to show pedal travel.
      </div>
    </G>
  );
}

/** Which comparison lap a gain/loss track map compares with the reference. */
function CompareLapField({ c }: { c: TrackMapConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  const laps = selectedLaps();
  if (laps.length < 2) return <div className="muted" style={{ fontSize: 12 }}>Select a comparison lap to see where time is gained or lost.</div>;
  const cur = compareLap(laps, c.compareKey);
  return (
    <F label="Compared with the reference">
      <div className="row" style={{ gap: 6 }}>
        <span className="swatch" style={{ background: cur.color, width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} title="This lap's colour" />
        <select className="input grow" value={cur.key} onChange={(e) => updateComponent(c.id, { compareKey: e.target.value }, 'Compare lap')}>
          {laps.slice(1).map((l) => (
            <option key={l.key} value={l.key}>
              {lapLabel(l.lap)} — {formatLapTime(l.lap.time)}
              {l.session !== laps[0].session ? ` · ${l.session.meta.driver || l.session.fileName}` : ''}
            </option>
          ))}
        </select>
      </div>
    </F>
  );
}

// ---------------------------------------------------------------------------------------------
// Bars: one row per condition
// ---------------------------------------------------------------------------------------------

function BarsForm({ c }: { c: BarsConfig }) {
  const theme = useStore((s) => s.settings.theme);
  const up = (p: Partial<BarsConfig>, label?: string) => updateComponent(c.id, p, label);
  const setRow = (i: number, patch: Partial<BarRow>) => up({ rows: c.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) }, 'Edit bar');
  const move = (i: number, d: number) => {
    const rows = c.rows.slice();
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    up({ rows }, 'Move bar');
  };
  return (
    <div className="props-grid">
      <div>
        <G title="Display">
          <F label="Laps">
            <Select value={c.laps} options={[['all', 'Every selected lap (one thin lane each)'], ['ref', 'Reference lap only']]} onChange={(v) => up({ laps: v })} />
          </F>
          <Check label="Combine all rows into one (where several are true, the higher row wins)" value={!!c.combined} onChange={(v) => up({ combined: v }, 'Combine bars')} />
          <Check label="Row labels (● = true at the cursor)" value={c.showLabels} onChange={(v) => up({ showLabels: v })} />
          <Check label="X-axis labels (off = sits seamlessly under a graph)" value={c.showAxis} onChange={(v) => up({ showAxis: v })} />
        </G>
        <G title="Markers (all graphs and bars)">
          <Check label={`Sector lines (S2, S3…)${keyHint('toggle-sectors') ? ` (${keyHint('toggle-sectors')})` : ''}`} value={c.showSectors} onChange={(v) => setGraphMarkers({ showSectors: v })} />
          <Check label={`Split lines (your splits)${keyHint('toggle-splits') ? ` (${keyHint('toggle-splits')})` : ''}`} value={c.showSplits ?? c.showSectors} onChange={(v) => setGraphMarkers({ showSplits: v })} />
          <Check label={`Corner lines${keyHint('toggle-corners') ? ` (${keyHint('toggle-corners')})` : ''}`} value={c.showCorners} onChange={(v) => setGraphMarkers({ showCorners: v })} />
        </G>
        <G title="Tips">
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            Bars share the graphs' axis, zoom and cursor. Put this component directly under a time/distance graph and the bars line up with the traces. Values are
            compared in the channel's display units. Drag a channel from the sidebar onto the bars to add a row that's on wherever the channel isn't 0.
          </div>
        </G>
      </div>
      <div>
        <div className="row">
          <h4 className="grow" style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)' }}>
            {c.combined ? 'Rows — priority order (top wins)' : 'Rows (top to bottom)'}
          </h4>
          <button className="btn small primary" onClick={(e) => openChannelPicker(e, (n) => up({ rows: [...c.rows, { id: uid('r'), channel: n, op: 'nonzero', value: 0 }] }, 'Add bar'))}>
            + Add row
          </button>
        </div>
        {c.rows.map((r, i) => (
          <div key={r.id} className="pane-card">
            <div className="ph">
              {c.combined && <span className="muted" style={{ fontSize: 11, width: 16 }}>{i + 1}</span>}
              <span
                className="lap-color-dot"
                style={{ background: r.color || CATEGORICAL[theme][i % CATEGORICAL[theme].length] }}
                title="Bar colour (the reference lap; comparison laps use their lap colour)"
                onClick={(e) => openColorPicker(e, r.color, (col) => setRow(i, { color: col }), { allowAuto: true, title: 'Bar colour' })}
              />
              <input className="input" style={{ width: 150, height: 24 }} placeholder={barCondition(r)} value={r.label ?? ''} onChange={(e) => setRow(i, { label: e.target.value || undefined })} />
              <span className="grow" />
              <button className="btn small icon" title={c.combined ? 'Higher priority' : 'Move up'} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="btn small icon" title={c.combined ? 'Lower priority' : 'Move down'} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="btn small icon" title="Remove row" onClick={() => up({ rows: c.rows.filter((_, k) => k !== i) }, 'Remove bar')}>
                ×
              </button>
            </div>
            <div className="row" style={{ padding: 8, flexWrap: 'wrap' }}>
              <div style={{ width: 200 }}>
                <ChannelPickerButton value={r.channel} onChange={(v) => setRow(i, { channel: v })} />
              </div>
              <select className="input" style={{ width: 150, height: 26 }} value={r.op} onChange={(e) => setRow(i, { op: e.target.value as BarRow['op'] })}>
                {BAR_OPS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              {r.op !== 'nonzero' && (
                <div style={{ width: 80 }}>
                  <Num value={r.value} placeholder="value" onChange={(v) => setRow(i, { value: v ?? 0 })} />
                </div>
              )}
              {r.op === 'between' && (
                <>
                  <span className="muted">and</span>
                  <div style={{ width: 80 }}>
                    <Num value={r.value2} placeholder="value" onChange={(v) => setRow(i, { value2: v })} />
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        {!c.rows.length && <div className="muted" style={{ fontSize: 12, padding: 8 }}>No rows yet — add one, or drag a channel onto the bars.</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Other components
// ---------------------------------------------------------------------------------------------

export function ComponentForm({ c }: { c: ComponentConfig }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const up = (p: any) => updateComponent(c.id, p);
  switch (c.type) {
    case 'graph':
      return <GraphForm c={c} />;
    case 'bars':
      return <BarsForm c={c} />;
    case 'trackmap':
      return (
        <div className="props-grid">
          <div>
            <G title="Colouring">
              <F label="Colour by">
                <ChannelPickerButton
                  value={c.colorBy}
                  onChange={(v) =>
                    up({ colorBy: v, ramp: v === 'delta' && c.ramp !== 'custom' ? 'gainloss' : (c.ramp === 'diverging' || c.ramp === 'gainloss') && v !== 'delta' ? 'blue' : c.ramp })
                  }
                  extras={[
                    { value: 'lap', label: 'Lap colours' },
                    { value: 'delta', label: 'Time gained / lost vs reference' },
                  ]}
                />
              </F>
              {c.colorBy !== 'lap' && (
                <F label="Colour ramp">
                  <Select value={c.ramp} options={rampOptions} onChange={(v) => up({ ramp: v })} />
                </F>
              )}
              {c.colorBy !== 'lap' && c.ramp === 'custom' && (
                <>
                  <div className="field">
                    {c.colorBy === 'delta' ? 'Gaining colour' : 'Low-value colour'}
                    <ColorField value={c.customLow ?? '#1baf7a'} onChange={(v) => up({ customLow: v ?? '#1baf7a' })} />
                  </div>
                  <div className="field">
                    {c.colorBy === 'delta' ? 'Losing colour' : 'High-value colour'}
                    <ColorField value={c.customHigh ?? '#e66767'} onChange={(v) => up({ customHigh: v ?? '#e66767' })} />
                  </div>
                </>
              )}
              {c.colorBy === 'delta' && (
                <>
                  <CompareLapField c={c} />
                  <F label={`Gain / loss sensitivity (×${(c.deltaSensitivity ?? 1).toFixed(2)})`}>
                    <input type="range" min={0.25} max={4} step={0.25} value={c.deltaSensitivity ?? 1} onChange={(e) => up({ deltaSensitivity: Number(e.target.value) })} />
                  </F>
                  <F label={`Gain / loss smoothing (${c.deltaSmoothing ?? 32} m)`}>
                    <input type="range" min={4} max={200} step={4} value={c.deltaSmoothing ?? 32} onChange={(e) => up({ deltaSmoothing: Number(e.target.value) })} />
                  </F>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Higher sensitivity shows small gains and losses in stronger colour. More smoothing shows broader regions instead of every small spike.
                  </div>
                </>
              )}
              {c.colorBy === 'lap' && <div className="muted" style={{ fontSize: 12 }}>Lap colours are set by right-clicking a lap’s colour square in the sidebar.</div>}
            </G>
            <G title="Display">
              <F label={`Line width (${c.lineWidth}px)`}>
                <input type="range" min={1.5} max={10} step={0.5} value={c.lineWidth} onChange={(e) => up({ lineWidth: Number(e.target.value) })} />
              </F>
              <Check label="Sector lines (S2, S3…)" value={c.showSectors} onChange={(v) => up({ showSectors: v, showSplits: c.showSplits ?? c.showSectors })} />
              <Check label="Split lines (your splits)" value={c.showSplits ?? c.showSectors} onChange={(v) => up({ showSplits: v })} />
              <Check label="Corner labels" value={c.showCorners} onChange={(v) => up({ showCorners: v })} />
              <Check label="Start / finish line" value={c.showStartFinish !== false} onChange={(v) => up({ showStartFinish: v })} />
              <Check label="Zoom in on the graphs’ selected range" value={c.fitToZoom !== false} onChange={(v) => up({ fitToZoom: v })} />
              <Check label="Dim the track outside the selected range" value={c.showZoom} onChange={(v) => up({ showZoom: v })} />
              <Check label="Track outline under the line" value={c.showOutline !== false} onChange={(v) => up({ showOutline: v })} />
              <Check label="Car positions at the cursor" value={c.showCars !== false} onChange={(v) => up({ showCars: v })} />
              <Check label="Legend" value={c.showLegend !== false} onChange={(v) => up({ showLegend: v })} />
              <div className="muted" style={{ fontSize: 12 }}>
                Scroll to zoom, drag to pan, double-click to reset the view. Drag the dial ring to rotate.
              </div>
            </G>
          </div>
          <div>
            <TrackEditorLink />
          </div>
        </div>
      );
    case 'gpstrack':
      return (
        <div className="props-grid">
          <div>
            <G title="Racing lines">
              <F label={`Line width (${c.lineWidth}px)`}>
                <input type="range" min={0.75} max={5} step={0.25} value={c.lineWidth} onChange={(e) => up({ lineWidth: Number(e.target.value) })} />
              </F>
              <Check label="Frame the graphs’ zoomed range" value={c.fitToZoom} onChange={(v) => up({ fitToZoom: v })} />
              <Check label="Follow the cursor when zoomed in" value={c.followCursor} onChange={(v) => up({ followCursor: v })} />
              <Check label="Sector markers (S/F, S2, S3…)" value={c.showSectors} onChange={(v) => up({ showSectors: v, showSplits: c.showSplits ?? c.showSectors })} />
              <Check label="Split markers (your splits)" value={c.showSplits ?? c.showSectors} onChange={(v) => up({ showSplits: v })} />
              <Check label="Corner labels" value={c.showCorners} onChange={(v) => up({ showCorners: v })} />
              <Check label="Scale bar" value={c.showScale !== false} onChange={(v) => up({ showScale: v })} />
              <Check label="Lap legend" value={c.showLegend !== false} onChange={(v) => up({ showLegend: v })} />
              <Check label="Offset from the reference line at the cursor" value={c.showOffsets !== false} onChange={(v) => up({ showOffsets: v })} />
              <div className="muted" style={{ fontSize: 12 }}>
                Lines use each lap’s colour — click a lap’s colour square in the sidebar to change it.
              </div>
            </G>
          </div>
          <div>
            <TrackEditorLink />
          </div>
        </div>
      );
    case 'breakdown':
      return (
        <div className="props-grid">
          <div>
            <G title="Time breakdown">
              <Check label="Gain / loss bars" value={c.showBars !== false} onChange={(v) => up({ showBars: v })} />
              <Check label="Reference lap's time in each section" value={c.showTimes !== false} onChange={(v) => up({ showTimes: v })} />
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                The lap is split at your corners into low, medium and high-speed corners and the straights between them. The four add up to the whole lap.
              </div>
            </G>
          </div>
          <div>
            <TrackEditorLink />
          </div>
        </div>
      );
    case 'corners':
      return (
        <div className="props-grid">
          <div>
            <G title="Corner report">
              <F label="Metric">
                <Select value={c.metric} options={[['time', 'Time through corner'], ['minSpeed', 'Minimum speed'], ['entrySpeed', 'Entry speed'], ['exitSpeed', 'Exit speed']]} onChange={(v) => up({ metric: v })} />
              </F>
              <Check label="Straights between corners" value={c.showStraights !== false} onChange={(v) => up({ showStraights: v })} />
              <Check label="Total time in corners vs on straights" value={c.showTotals !== false} onChange={(v) => up({ showTotals: v })} />
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                Each corner runs from where you leave full throttle before it to where you're back at full throttle after it (with the padding above), never past
                halfway to the neighbouring corners — unless you set an exact range in advanced mode. Anything not inside a corner counts as a straight.
              </div>
            </G>
          </div>
          <div>
            <TrackEditorLink />
          </div>
        </div>
      );
    case 'scatter':
      return (
        <div className="props-grid">
          <div>
            <G title="Channels">
              <F label="X axis">
                <ChannelPickerButton value={c.x} onChange={(v) => up({ x: v })} />
              </F>
              <F label="Y axis">
                <ChannelPickerButton value={c.y} onChange={(v) => up({ y: v })} />
              </F>
              <F label="Colour">
                <ChannelPickerButton value={c.color} onChange={(v) => up({ color: v })} extras={[{ value: 'lap', label: 'Lap colours' }]} />
              </F>
              {c.color !== 'lap' && (
                <F label="Colour ramp">
                  <Select value={c.ramp} options={rampOptions.filter(([k]) => k !== 'custom')} onChange={(v) => up({ ramp: v })} />
                </F>
              )}
              <F label="Gate (only plot where this channel ≠ 0)">
                <ChannelPickerButton value={c.gate ?? ''} placeholder="none" onChange={(v) => up({ gate: v === '__none' ? undefined : v })} extras={[{ value: '__none', label: 'No gate' }]} />
              </F>
            </G>
          </div>
          <div>
            <G title="Axes & scales">
              <AxisRange label="X axis" min={c.xMin} max={c.xMax} onChange={(a, b) => up({ xMin: a, xMax: b })} />
              <AxisRange label="Y axis" min={c.yMin} max={c.yMax} onChange={(a, b) => up({ yMin: a, yMax: b })} />
              <Check label="Equal aspect (G-G diagram; ignored when ranges are fixed)" value={c.equalAspect} onChange={(v) => up({ equalAspect: v })} />
              <div className="muted" style={{ fontSize: 12 }}>
                On the chart: drag a rectangle to zoom into it, scroll to zoom, right-drag to pan, double-click to reset.
              </div>
            </G>
            <G title="Analysis">
              <button className="btn small" onClick={() => up({ x: c.y, y: c.x, xMin: c.yMin, xMax: c.yMax, yMin: c.xMin, yMax: c.xMax })}>
                ⇄ Swap X and Y
              </button>
              <FitFields c={c} up={up} note="One line per selected lap, through its points." />
              <Check label="X-interval averages" value={c.intervalAvg} onChange={(v) => up({ intervalAvg: v })} />
              {c.intervalAvg && (
                <F label="Intervals">
                  <Num value={c.intervalCount} onChange={(v) => up({ intervalCount: Math.max(2, Math.round(v ?? 20)) })} />
                </F>
              )}
              <F label={`Point size (${c.pointSize})`}>
                <input type="range" min={1} max={6} step={0.5} value={c.pointSize} onChange={(e) => up({ pointSize: Number(e.target.value) })} />
              </F>
              <Check label="Only zoomed range" value={c.useZoom} onChange={(v) => up({ useZoom: v })} />
              <Check label="Grip envelope (outer line) and % used — for G-G plots" value={!!c.envelope} onChange={(v) => up({ envelope: v })} />
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                The envelope traces the outermost points of the selected laps in every direction — roughly the car's grip limit this session. Each lap's
                “% used” is how close, on average, it ran to that line whenever it was cornering, braking or accelerating hard.
              </div>
            </G>
          </div>
        </div>
      );
    case 'trend':
      return (
        <div className="props-single">
          <G title="Statistic">
            <F label="Channel">
              <ChannelPickerButton value={c.channel} placeholder="Lap time" onChange={(v) => up({ channel: v === '__lap' ? '' : v, yMin: undefined, yMax: undefined })} extras={[{ value: '__lap', label: 'Lap time' }]} />
            </F>
            {c.channel && (
              <F label="Statistic per lap">
                <Select value={c.stat} options={[['mean', 'Mean'], ['max', 'Max'], ['min', 'Min'], ['first', 'Start of lap'], ['last', 'End of lap'], ['delta', 'Change over lap']]} onChange={(v) => up({ stat: v })} />
              </F>
            )}
            <Check label="Valid laps only" value={c.validOnly} onChange={(v) => up({ validOnly: v })} />
            {!c.channel && (
              <>
                <F label="Lap times">
                  <Select value={c.lapTimes ?? 'raw'} options={[['raw', 'Raw'], ['corrected', 'Fuel-corrected'], ['both', 'Both (corrected dashed)']]} onChange={(v) => up({ lapTimes: v })} />
                </F>
                <F label={`Fuel effect (${(c.fuelEffect ?? 0.03).toFixed(3)} s per litre)`}>
                  <input type="range" min={0} max={0.1} step={0.005} value={c.fuelEffect ?? 0.03} onChange={(e) => up({ fuelEffect: Number(e.target.value) })} />
                </F>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                  Fuel-corrected = lap time − (fuel effect × average fuel on board during the lap): each lap as if run on an empty tank, so stint pace and tyre
                  wear are easier to compare. Around 0.03 s per litre suits most cars; heavier, slower cars a bit more.
                </div>
              </>
            )}
          </G>
          <G title="Best fit">
            <FitFields c={c} up={up} note="One line per session (and for raw and fuel-corrected times separately), with lap number as x. A linear fit also shows the change per lap." />
          </G>
          <G title="Y axis">
            <AxisRange label="Y axis" min={c.yMin} max={c.yMax} onChange={(a, b) => up({ yMin: a, yMax: b })} />
            <div className="muted" style={{ fontSize: 12 }}>
              {c.channel ? 'In the channel’s display units.' : 'Lap time in seconds (e.g. 100 = 1:40.000).'} Drag a rectangle on the chart to zoom; double-click to reset.
            </div>
          </G>
        </div>
      );
    case 'histogram':
      return (
        <div className="props-single">
          <G title="Histogram">
            <F label="Channel">
              <ChannelPickerButton value={c.channel} onChange={(v) => up({ channel: v, min: undefined, max: undefined })} />
            </F>
            <F label="Bins">
              <Num value={c.bins} onChange={(v) => up({ bins: Math.max(1, Math.round(v ?? 30)) })} />
            </F>
            <AxisRange label="X range" min={c.min} max={c.max} onChange={(a, b) => up({ min: a, max: b })} />
            <F label="Zone boundaries (comma separated)">
              <input
                className="input"
                defaultValue={c.zones.join(', ')}
                key={c.zones.join(',')}
                onBlur={(e) =>
                  up({
                    zones: e.target.value
                      .split(/[,\s]+/)
                      .filter(Boolean)
                      .map(Number)
                      .filter(Number.isFinite)
                      .sort((a, b) => a - b),
                  })
                }
              />
            </F>
            <Check label="Cumulative" value={c.cumulative} onChange={(v) => up({ cumulative: v })} />
            <Check label="Only zoomed range" value={c.useZoom} onChange={(v) => up({ useZoom: v })} />
          </G>
        </div>
      );
    case 'mixture':
      return (
        <div className="props-single">
          <G title="Mixture map">
            <F label="X axis">
              <ChannelPickerButton value={c.x} onChange={(v) => up({ x: v })} />
            </F>
            <F label="Y axis">
              <ChannelPickerButton value={c.y} onChange={(v) => up({ y: v })} />
            </F>
            <F label="Cell value">
              <ChannelPickerButton
                value={c.z}
                placeholder="% of time"
                onChange={(v) => up({ z: v === '__none' ? '' : v, mode: v === '__none' ? 'time' : c.mode === 'time' ? 'mean' : c.mode })}
                extras={[{ value: '__none', label: '% of time' }]}
              />
            </F>
            {c.z && (
              <F label="Statistic">
                <Select value={c.mode} options={[['mean', 'Mean'], ['max', 'Max'], ['min', 'Min'], ['time', '% of time']]} onChange={(v) => up({ mode: v })} />
              </F>
            )}
            <div className="row">
              <F label="X bins">
                <Num value={c.xBins} onChange={(v) => up({ xBins: Math.max(1, Math.round(v ?? 12)) })} />
              </F>
              <F label="Y bins">
                <Num value={c.yBins} onChange={(v) => up({ yBins: Math.max(1, Math.round(v ?? 10)) })} />
              </F>
            </div>
            <F label="Colour ramp">
              <Select value={c.ramp} options={rampOptions.filter(([k]) => k !== 'diverging' && k !== 'custom')} onChange={(v) => up({ ramp: v })} />
            </F>
            <Check label="Show cell values" value={c.showValues} onChange={(v) => up({ showValues: v })} />
            <Check label="Only zoomed range" value={c.useZoom} onChange={(v) => up({ useZoom: v })} />
          </G>
        </div>
      );
    case 'laps':
    case 'lapreport':
      return (
        <div className="props-single">
          <G title={c.type === 'laps' ? 'Stint report (every lap)' : 'Lap report (selected laps)'}>
            <F label="Split columns">
              <Select value={c.split} options={[['sectors', 'Game sectors'], ['sections', 'Custom sections'], ['none', 'None']]} onChange={(v) => up({ split: v })} />
            </F>
            <Check label="Split / sector columns" value={c.showSplits !== false} onChange={(v) => up({ showSplits: v })} />
            <Check label={c.type === 'laps' ? 'Δ to best lap column' : 'Δ to reference column'} value={c.showDelta !== false} onChange={(v) => up({ showDelta: v })} />
            {c.type === 'laps' && <Check label="Ideal lap row" value={c.showIdeal !== false} onChange={(v) => up({ showIdeal: v })} />}
            <Check label="Lap tags (out / in / invalid)" value={c.showTags !== false} onChange={(v) => up({ showTags: v })} />
            <Check label="Max speed & fuel columns" value={c.showStats} onChange={(v) => up({ showStats: v })} />
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
              Green background = best in its stint; purple = best of every lap open at this track.
            </div>
          </G>
        </div>
      );
    case 'channels':
      return (
        <div className="props-single">
          <G title="Channels">
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {c.channels.map((ch) => (
                <span key={ch} className="chip" onContextMenu={(e) => (e.preventDefault(), openChannelProps(ch))}>
                  <span className="n">{channelLabel(ch)}</span>
                  <button title="Channel properties" onClick={() => openChannelProps(ch)}>
                    ⚙
                  </button>
                  <button onClick={() => up({ channels: c.channels.filter((x) => x !== ch) })}>×</button>
                </span>
              ))}
              <button className="btn small ghost" onClick={(e) => openChannelPicker(e, (n) => !c.channels.includes(n) && up({ channels: [...c.channels, n] }))}>
                + channel
              </button>
            </div>
          </G>
          <G title="Statistics">
            {(['min', 'max', 'mean', 'std', 'first', 'last'] as const).map((s) => (
              <Check key={s} label={s} value={c.stats.includes(s)} onChange={(v) => up({ stats: v ? [...c.stats, s] : c.stats.filter((x) => x !== s) })} />
            ))}
            <Check label="Only zoomed range" value={c.useZoom} onChange={(v) => up({ useZoom: v })} />
          </G>
        </div>
      );
    case 'gauges':
      return (
        <div className="props-single">
          <G title="Gauges">
            <F label="Columns">
              <Num value={c.columns} onChange={(v) => up({ columns: Math.max(1, Math.round(v ?? 3)) })} />
            </F>
            {c.gauges.map((g, i) => {
              const set = (p: Partial<GaugeDef>) => up({ gauges: c.gauges.map((x, k) => (k === i ? { ...x, ...p } : x)) });
              return (
                <div key={i} className="pane-editor">
                  <ChannelPickerButton value={g.channel} onChange={(v) => set({ channel: v, min: undefined, max: undefined })} />
                  <div className="row">
                    <select className="input" style={{ height: 24 }} value={g.style} onChange={(e) => set({ style: e.target.value as GaugeDef['style'] })}>
                      <option value="dial">Dial</option>
                      <option value="bar">Bar</option>
                      <option value="digital">Digital</option>
                    </select>
                    <Num value={g.min} placeholder="min" onChange={(v) => set({ min: v })} />
                    <Num value={g.max} placeholder="max" onChange={(v) => set({ max: v })} />
                    <button className="btn small icon" onClick={() => up({ gauges: c.gauges.filter((_, k) => k !== i) })}>
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
            <button className="btn small" onClick={(e) => openChannelPicker(e, (n) => up({ gauges: [...c.gauges, { channel: n, style: 'dial' }] }))}>
              + Add gauge
            </button>
          </G>
        </div>
      );
    case 'inputs':
      return (
        <div className="props-single">
          <G title="Driver inputs">
            <Check label="Show compare lap (second selected lap)" value={c.showCompare} onChange={(v) => up({ showCompare: v })} />
            <Check label="Throttle & brake" value={c.showPedals !== false} onChange={(v) => up({ showPedals: v })} />
            <Check label="Clutch" value={c.showClutch !== false} onChange={(v) => up({ showClutch: v })} />
            <Check label="Steering wheel" value={c.showSteering !== false} onChange={(v) => up({ showSteering: v })} />
            <Check label="Gear" value={c.showGear !== false} onChange={(v) => up({ showGear: v })} />
            <Check label="Speed" value={c.showSpeed !== false} onChange={(v) => up({ showSpeed: v })} />
            <Check label="RPM bar" value={c.showRpm !== false} onChange={(v) => up({ showRpm: v })} />
          </G>
          <InputChannelsForm c={c} />
        </div>
      );
    case 'tyres':
      return (
        <div className="props-single">
          <G title="Tyres & brakes">
            <F label="Values">
              <Select value={c.mode} options={[['cursor', 'At cursor'], ['mean', 'Lap mean'], ['max', 'Lap max']]} onChange={(v) => up({ mode: v })} />
            </F>
            <Check label="Caption under the tyres" value={c.showCaption !== false} onChange={(v) => up({ showCaption: v })} />
          </G>
          <G title="Information shown for each tyre">
            {TYRE_FIELDS.map((f) => {
              const cur = c.fields ?? TYRE_FIELDS.filter((x) => x.default).map((x) => x.key);
              return (
                <Check
                  key={f.key}
                  label={f.label}
                  value={cur.includes(f.key)}
                  onChange={(v) => up({ fields: v ? TYRE_FIELDS.map((x) => x.key).filter((k) => k === f.key || cur.includes(k)) : cur.filter((k) => k !== f.key) })}
                />
              );
            })}
            <button className="btn small" disabled={!c.fields} onClick={() => up({ fields: undefined })}>
              Reset to defaults
            </button>
          </G>
        </div>
      );
    case 'details':
      return (
        <div className="props-single">
          <G title="Session & setup">
            <F label="Tab">
              <Select value={c.tab} options={[['info', 'Session'], ['setup', 'Car setup'], ['notes', 'Notes']]} onChange={(v) => up({ tab: v })} />
            </F>
            <Check label="Setup: differences only" value={c.diffOnly} onChange={(v) => up({ diffOnly: v })} />
          </G>
        </div>
      );
    case 'fft':
      return (
        <div className="props-single">
          <G title="Frequency analysis">
            <F label="Channel">
              <ChannelPickerButton value={c.channel} onChange={(v) => up({ channel: v })} />
            </F>
            <F label="Max frequency (Hz)">
              <Num value={c.maxHz} onChange={(v) => up({ maxHz: Math.max(0.5, v ?? 25) })} />
            </F>
            <Check label="Log scale" value={c.logScale} onChange={(v) => up({ logScale: v })} />
            <Check label="Only zoomed range" value={c.useZoom} onChange={(v) => up({ useZoom: v })} />
          </G>
        </div>
      );
  }
}

export function PropertiesModal() {
  const activeId = useStore((s) => s.activeComponentId);
  const sheet = useStore((s) => activeSheet(s));
  const c = activeId ? sheet?.components[activeId] : undefined;
  const close = () => setUi({ properties: false });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement)?.closest('.popover') && close();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const comps = Object.values(sheet?.components ?? {});
  const meta = c ? COMPONENT_CATALOG.find((x) => x.type === c.type) : undefined;
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal props-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ flex: '0 0 auto' }}>Properties</h2>
          <select
            className="input"
            style={{ width: 320 }}
            value={c?.id ?? ''}
            onChange={(e) => useStore.setState({ activeComponentId: e.target.value || null })}
            title="Component on this worksheet"
          >
            <option value="">Choose a component…</option>
            {comps.map((x) => (
              <option key={x.id} value={x.id}>
                {COMPONENT_CATALOG.find((m) => m.type === x.type)?.icon} {x.title || defaultTitle(x)}
              </option>
            ))}
          </select>
          {c && (
            <input
              className="input"
              style={{ width: 260 }}
              placeholder={`Title: ${defaultTitle(c)}`}
              value={c.title ?? ''}
              onChange={(e) => updateComponent(c.id, { title: e.target.value || undefined }, 'Rename component')}
            />
          )}
          <span className="grow" />
          {c && (
            <button
              className="btn"
              onClick={() => {
                removeComponentById(c.id);
              }}
            >
              Remove component
            </button>
          )}
          <button className="btn icon ghost" onClick={close} title="Close (Esc)">
            ✕
          </button>
        </div>
        {c ? (
          <>
            {meta && (
              <div className="muted" style={{ padding: '8px 16px 0', fontSize: 12 }}>
                {meta.icon} <b style={{ color: 'var(--text-2)' }}>{meta.label}</b> — {meta.description}
              </div>
            )}
            <ComponentForm c={c} />
          </>
        ) : (
          <div className="props-single">
            <div className="muted" style={{ marginBottom: 10 }}>
              Choose a component above (or right-click any component → <b>Properties…</b>). Or add a new one to this worksheet:
            </div>
            <div className="cards" style={{ padding: 0 }}>
              {COMPONENT_CATALOG.map((it) => (
                <div key={it.type} className="card" onClick={() => addComponent(it.type)}>
                  <div className="t">
                    {it.icon} {it.label}
                  </div>
                  <div className="s">{it.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="modal-foot">
          <span className="muted grow" style={{ fontSize: 12 }}>
            Changes apply immediately · Ctrl/⌘+Z undoes
          </span>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Docked side panel (Ctrl/⌘+I) showing the same properties as the pop-out, for the selected component. */
export function InspectorPanel() {
  const activeId = useStore((s) => s.activeComponentId);
  const sheet = useStore((s) => activeSheet(s));
  const c = activeId ? sheet?.components[activeId] : undefined;
  if (!c)
    return (
      <div className="insp-body">
        <div className="muted" style={{ fontSize: 12 }}>
          Click a component to edit its properties here, or right-click it → <b>Properties…</b> for the large pop-out. Add components to this worksheet:
        </div>
        {COMPONENT_CATALOG.map((it) => (
          <button key={it.type} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => addComponent(it.type)}>
            <span style={{ width: 18, textAlign: 'center' }}>{it.icon}</span>
            {it.label}
          </button>
        ))}
      </div>
    );
  const meta = COMPONENT_CATALOG.find((x) => x.type === c.type);
  return (
    <div className="insp-panel">
      <div className="insp-body" style={{ paddingBottom: 0 }}>
        <div className="row">
          <span style={{ fontSize: 16 }}>{meta?.icon}</span>
          <b className="grow">{meta?.label}</b>
          <button className="btn small" title="Open in the large pop-out" onClick={() => setUi({ properties: true })}>
            ⤢ Pop out
          </button>
          <button className="btn small" onClick={() => removeComponentById(c.id)}>
            Remove
          </button>
        </div>
        <input className="input" placeholder={defaultTitle(c)} value={c.title ?? ''} onChange={(e) => updateComponent(c.id, { title: e.target.value || undefined }, 'Rename component')} />
      </div>
      <ComponentForm c={c} />
    </div>
  );
}
