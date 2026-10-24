// Right-hand inspector: properties of the selected component.

import { useEffect, useState } from 'react';
import { RAMP_LABELS, type RampName } from '../core/colors';
import { COMPONENT_CATALOG, pane } from '../state/components';
import {
  activeSheet,
  addComponent,
  removeComponentById,
  selectedLaps,
  setTrackProfile,
  trackProfile,
  updateComponent,
  useStore,
} from '../state/store';
import type { ComponentConfig, GaugeDef, GraphConfig } from '../state/workspace';
import { defaultTitle } from '../charts/registry';
import { ChannelPickerButton, openChannelPicker } from './overlays';

function Num({ value, onChange, placeholder, step }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; step?: number }) {
  const [s, setS] = useState(value == null ? '' : String(value));
  useEffect(() => setS(value == null ? '' : String(value)), [value]);
  const commit = () => {
    const t = s.trim();
    onChange(t === '' ? undefined : Number.isFinite(Number(t)) ? Number(t) : value);
  };
  return (
    <input
      className="input num"
      value={s}
      step={step}
      placeholder={placeholder ?? 'auto'}
      onChange={(e) => setS(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
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

const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="field">
    {label}
    {children}
  </label>
);

const rampOptions = Object.entries(RAMP_LABELS) as [RampName, string][];

function GraphForm({ c, up }: { c: GraphConfig; up: (p: Partial<GraphConfig>) => void }) {
  const setPane = (i: number, patch: Partial<GraphConfig['panes'][number]>) => up({ panes: c.panes.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const move = (i: number, d: number) => {
    const panes = c.panes.slice();
    const j = i + d;
    if (j < 0 || j >= panes.length) return;
    [panes[i], panes[j]] = [panes[j], panes[i]];
    up({ panes });
  };
  return (
    <>
      <div className="insp-group">
        <h4>Panes (top to bottom)</h4>
        {c.panes.map((p, i) => (
          <div key={p.id} className="pane-editor">
            <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
              {p.channels.map((ch) => (
                <span key={ch} className="chip">
                  <span className="n">{ch}</span>
                  <button onClick={() => setPane(i, { channels: p.channels.filter((x) => x !== ch) })}>×</button>
                </span>
              ))}
              <button className="btn small ghost" onClick={(e) => openChannelPicker(e, (n) => !p.channels.includes(n) && setPane(i, { channels: [...p.channels, n] }))}>
                + channel
              </button>
            </div>
            <div className="row">
              <select className="input" style={{ height: 24, fontSize: 12 }} value={p.scale} onChange={(e) => setPane(i, { scale: e.target.value as 'auto' })}>
                <option value="auto">Scale: auto</option>
                <option value="shared">Scale: shared (tiled)</option>
                <option value="independent">Scale: independent (overlapped)</option>
              </select>
              <button className="btn small icon" title="Move up" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="btn small icon" title="Move down" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="btn small icon" title="Remove pane" onClick={() => up({ panes: c.panes.filter((_, k) => k !== i) })}>
                ×
              </button>
            </div>
            <div className="row">
              <span className="muted" style={{ fontSize: 11, width: 54 }}>
                Height
              </span>
              <input type="range" min={0.3} max={4} step={0.1} value={p.weight} onChange={(e) => setPane(i, { weight: Number(e.target.value) })} className="grow" />
            </div>
            {p.scale !== 'independent' && (
              <div className="row">
                <Num value={p.min} placeholder="min auto" onChange={(v) => setPane(i, { min: v })} />
                <Num value={p.max} placeholder="max auto" onChange={(v) => setPane(i, { max: v })} />
              </div>
            )}
          </div>
        ))}
        <button className="btn small" onClick={(e) => openChannelPicker(e, (n) => up({ panes: [...c.panes, pane([n])] }))}>
          + Add pane
        </button>
      </div>
      <div className="insp-group">
        <h4>Display</h4>
        <Check label="Time variance pane (F3)" value={c.showVariance} onChange={(v) => up({ showVariance: v })} />
        <Check label="Sector & section lines" value={c.showSectors} onChange={(v) => up({ showSectors: v })} />
        <Check label="Corner markers" value={c.showCorners} onChange={(v) => up({ showCorners: v })} />
        <F label="Y range">
          <Select value={c.yRange} options={[['full', 'Whole lap'], ['visible', 'Visible (zoomed) area']]} onChange={(v) => up({ yRange: v })} />
        </F>
      </div>
    </>
  );
}

function TrackSectionsEditor() {
  const ref = selectedLaps()[0];
  useStore((s) => s.settings.trackProfiles);
  if (!ref) return null;
  const venue = ref.session.meta.venue;
  const prof = trackProfile(venue);
  return (
    <div className="insp-group">
      <h4>Track profile — {venue || 'unknown'}</h4>
      <div className="row">
        <F label="Rotation °">
          <Num value={prof.rotation} onChange={(v) => setTrackProfile(venue, { rotation: v ?? 0 })} />
        </F>
        <div style={{ paddingTop: 16 }}>
          <Check label="Mirror" value={prof.mirror} onChange={(v) => setTrackProfile(venue, { mirror: v })} />
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11 }}>
        Custom sections (split points, metres from S/F). Add them from the track map's right-click menu at the cursor.
      </div>
      {prof.sections.map((s, i) => (
        <div key={i} className="row">
          <input
            className="input"
            defaultValue={s.name}
            onBlur={(e) => setTrackProfile(venue, { sections: prof.sections.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })}
          />
          <div style={{ width: 90 }}>
            <Num value={Math.round(s.dist)} onChange={(v) => setTrackProfile(venue, { sections: prof.sections.map((x, k) => (k === i ? { ...x, dist: v ?? x.dist } : x)).sort((a, b) => a.dist - b.dist) })} />
          </div>
          <button className="btn small icon" onClick={() => setTrackProfile(venue, { sections: prof.sections.filter((_, k) => k !== i) })}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function ComponentForm({ c }: { c: ComponentConfig }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const up = (p: any) => updateComponent(c.id, p);
  switch (c.type) {
    case 'graph':
      return <GraphForm c={c} up={up} />;
    case 'scatter':
      return (
        <div className="insp-group">
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
              <Select value={c.ramp} options={rampOptions} onChange={(v) => up({ ramp: v })} />
            </F>
          )}
          <F label="Gate (only plot where this channel ≠ 0)">
            <ChannelPickerButton value={c.gate ?? ''} placeholder="none" onChange={(v) => up({ gate: v === '__none' ? undefined : v })} extras={[{ value: '__none', label: 'No gate' }]} />
          </F>
          <F label="Curve fit">
            <Select value={c.fit} options={[['none', 'None'], ['linear', 'Linear'], ['poly2', 'Quadratic'], ['poly3', 'Cubic']]} onChange={(v) => up({ fit: v })} />
          </F>
          <Check label="X-interval averages" value={c.intervalAvg} onChange={(v) => up({ intervalAvg: v })} />
          {c.intervalAvg && (
            <F label="Intervals">
              <Num value={c.intervalCount} onChange={(v) => up({ intervalCount: Math.max(2, Math.round(v ?? 20)) })} />
            </F>
          )}
          <F label="Point size">
            <input type="range" min={1} max={6} step={0.5} value={c.pointSize} onChange={(e) => up({ pointSize: Number(e.target.value) })} />
          </F>
          <Check label="Equal aspect (G-G)" value={c.equalAspect} onChange={(v) => up({ equalAspect: v })} />
          <Check label="Only zoomed range" value={c.useZoom} onChange={(v) => up({ useZoom: v })} />
        </div>
      );
    case 'histogram':
      return (
        <div className="insp-group">
          <F label="Channel">
            <ChannelPickerButton value={c.channel} onChange={(v) => up({ channel: v, min: undefined, max: undefined })} />
          </F>
          <F label="Bins">
            <Num value={c.bins} onChange={(v) => up({ bins: Math.max(1, Math.round(v ?? 30)) })} />
          </F>
          <div className="row">
            <F label="Min">
              <Num value={c.min} onChange={(v) => up({ min: v })} />
            </F>
            <F label="Max">
              <Num value={c.max} onChange={(v) => up({ max: v })} />
            </F>
          </div>
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
        </div>
      );
    case 'mixture':
      return (
        <div className="insp-group">
          <F label="X axis">
            <ChannelPickerButton value={c.x} onChange={(v) => up({ x: v })} />
          </F>
          <F label="Y axis">
            <ChannelPickerButton value={c.y} onChange={(v) => up({ y: v })} />
          </F>
          <F label="Cell value">
            <ChannelPickerButton value={c.z} placeholder="% of time" onChange={(v) => up({ z: v === '__none' ? '' : v, mode: v === '__none' ? 'time' : c.mode === 'time' ? 'mean' : c.mode })} extras={[{ value: '__none', label: '% of time' }]} />
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
            <Select value={c.ramp} options={rampOptions.filter(([k]) => k !== 'diverging')} onChange={(v) => up({ ramp: v })} />
          </F>
          <Check label="Show cell values" value={c.showValues} onChange={(v) => up({ showValues: v })} />
          <Check label="Only zoomed range" value={c.useZoom} onChange={(v) => up({ useZoom: v })} />
        </div>
      );
    case 'trackmap':
      return (
        <>
          <div className="insp-group">
            <F label="Colour by">
              <ChannelPickerButton
                value={c.colorBy}
                onChange={(v) => up({ colorBy: v, ramp: v === 'delta' ? 'diverging' : c.ramp === 'diverging' ? 'blue' : c.ramp })}
                extras={[
                  { value: 'lap', label: 'Lap colours' },
                  { value: 'delta', label: 'Time gained / lost vs reference' },
                ]}
              />
            </F>
            {c.colorBy !== 'lap' && c.colorBy !== 'delta' && (
              <F label="Colour ramp">
                <Select value={c.ramp} options={rampOptions} onChange={(v) => up({ ramp: v })} />
              </F>
            )}
            <F label="Line width">
              <input type="range" min={1.5} max={10} step={0.5} value={c.lineWidth} onChange={(e) => up({ lineWidth: Number(e.target.value) })} />
            </F>
            <Check label="Sector & section markers" value={c.showSectors} onChange={(v) => up({ showSectors: v })} />
            <Check label="Corner labels" value={c.showCorners} onChange={(v) => up({ showCorners: v })} />
            <Check label="Highlight zoomed range" value={c.showZoom} onChange={(v) => up({ showZoom: v })} />
          </div>
          <TrackSectionsEditor />
        </>
      );
    case 'laps':
      return (
        <div className="insp-group">
          <F label="Split columns">
            <Select value={c.split} options={[['sectors', 'Game sectors'], ['sections', 'Custom sections'], ['none', 'None']]} onChange={(v) => up({ split: v })} />
          </F>
          <Check label="Max speed & fuel columns" value={c.showStats} onChange={(v) => up({ showStats: v })} />
        </div>
      );
    case 'channels':
      return (
        <div className="insp-group">
          <h4>Channels</h4>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {c.channels.map((ch) => (
              <span key={ch} className="chip">
                <span className="n">{ch}</span>
                <button onClick={() => up({ channels: c.channels.filter((x) => x !== ch) })}>×</button>
              </span>
            ))}
            <button className="btn small ghost" onClick={(e) => openChannelPicker(e, (n) => !c.channels.includes(n) && up({ channels: [...c.channels, n] }))}>
              + channel
            </button>
          </div>
          <h4>Statistics</h4>
          {(['min', 'max', 'mean', 'std', 'first', 'last'] as const).map((s) => (
            <Check key={s} label={s} value={c.stats.includes(s)} onChange={(v) => up({ stats: v ? [...c.stats, s] : c.stats.filter((x) => x !== s) })} />
          ))}
          <Check label="Only zoomed range" value={c.useZoom} onChange={(v) => up({ useZoom: v })} />
        </div>
      );
    case 'gauges':
      return (
        <div className="insp-group">
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
        </div>
      );
    case 'inputs':
      return (
        <div className="insp-group">
          <Check label="Show compare lap (second selected lap)" value={c.showCompare} onChange={(v) => up({ showCompare: v })} />
        </div>
      );
    case 'tyres':
      return (
        <div className="insp-group">
          <F label="Values">
            <Select value={c.mode} options={[['cursor', 'At cursor'], ['mean', 'Lap mean'], ['max', 'Lap max']]} onChange={(v) => up({ mode: v })} />
          </F>
        </div>
      );
    case 'details':
      return (
        <div className="insp-group">
          <F label="Tab">
            <Select value={c.tab} options={[['info', 'Session'], ['setup', 'Car setup'], ['notes', 'Notes']]} onChange={(v) => up({ tab: v })} />
          </F>
          <Check label="Setup: differences only" value={c.diffOnly} onChange={(v) => up({ diffOnly: v })} />
        </div>
      );
    case 'trend':
      return (
        <div className="insp-group">
          <F label="Channel">
            <ChannelPickerButton value={c.channel} placeholder="Lap time" onChange={(v) => up({ channel: v === '__lap' ? '' : v })} extras={[{ value: '__lap', label: 'Lap time' }]} />
          </F>
          {c.channel && (
            <F label="Statistic per lap">
              <Select
                value={c.stat}
                options={[['mean', 'Mean'], ['max', 'Max'], ['min', 'Min'], ['first', 'Start of lap'], ['last', 'End of lap'], ['delta', 'Change over lap']]}
                onChange={(v) => up({ stat: v })}
              />
            </F>
          )}
          <Check label="Valid laps only" value={c.validOnly} onChange={(v) => up({ validOnly: v })} />
        </div>
      );
    case 'corners':
      return (
        <div className="insp-group">
          <F label="Metric">
            <Select value={c.metric} options={[['minSpeed', 'Minimum speed'], ['entrySpeed', 'Entry speed'], ['exitSpeed', 'Exit speed'], ['time', 'Time through corner']]} onChange={(v) => up({ metric: v })} />
          </F>
        </div>
      );
    case 'fft':
      return (
        <div className="insp-group">
          <F label="Channel">
            <ChannelPickerButton value={c.channel} onChange={(v) => up({ channel: v })} />
          </F>
          <F label="Max frequency (Hz)">
            <Num value={c.maxHz} onChange={(v) => up({ maxHz: Math.max(0.5, v ?? 25) })} />
          </F>
          <Check label="Log scale" value={c.logScale} onChange={(v) => up({ logScale: v })} />
          <Check label="Only zoomed range" value={c.useZoom} onChange={(v) => up({ useZoom: v })} />
        </div>
      );
  }
}

export function Inspector() {
  const activeId = useStore((s) => s.activeComponentId);
  const sheet = useStore((s) => activeSheet(s));
  const c = activeId ? sheet?.components[activeId] : undefined;
  if (!c) {
    return (
      <div className="insp-body">
        <div className="muted" style={{ fontSize: 12 }}>
          Click a component's header to edit its properties here. Add components to this worksheet:
        </div>
        {COMPONENT_CATALOG.map((it) => (
          <button key={it.type} className="btn" style={{ justifyContent: 'flex-start', height: 'auto', padding: '6px 10px' }} onClick={() => addComponent(it.type)}>
            <span style={{ width: 18, textAlign: 'center' }}>{it.icon}</span>
            <span style={{ textAlign: 'left' }}>
              <div>{it.label}</div>
            </span>
          </button>
        ))}
      </div>
    );
  }
  const meta = COMPONENT_CATALOG.find((x) => x.type === c.type);
  return (
    <div className="insp-body">
      <div className="insp-group">
        <div className="row">
          <span style={{ fontSize: 16 }}>{meta?.icon}</span>
          <b className="grow">{meta?.label}</b>
          <button className="btn small" onClick={() => removeComponentById(c.id)}>
            Remove
          </button>
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {meta?.description}
        </div>
        <F label="Title">
          <input className="input" placeholder={defaultTitle(c)} value={c.title ?? ''} onChange={(e) => updateComponent(c.id, { title: e.target.value || undefined })} />
        </F>
      </div>
      <ComponentForm c={c} />
    </div>
  );
}
