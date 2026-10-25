// Channel report: statistics of chosen channels for each selected lap (whole lap or zoomed range).

import { formatValue } from '../core/format';
import { lapHeaderTint, lapTint } from '../core/colors';
import { lapLabel } from '../core/session';
import { rangeStats } from '../core/stats';
import { selectedLaps, updateComponent, useStore } from '../state/store';
import type { ChannelReportConfig } from '../state/workspace';
import { openChannelPicker } from '../ui/overlays';
import { channelDps, conv, lapWindow } from './data';

const STAT_LABEL = { min: 'Min', max: 'Max', mean: 'Avg', std: 'Std', first: 'Start', last: 'End' } as const;

export function ChannelReportView({ config }: { config: ChannelReportConfig }) {
  useStore((s) => s.laps);
  useStore((s) => s.refKey);
  useStore((s) => s.dataVersion);
  useStore((s) => s.settings.units);
  const zoom = useStore((s) => (config.useZoom ? s.zoom : null));
  const xMode = useStore((s) => s.xMode);
  const laps = selectedLaps();

  if (!laps.length) return <div className="empty-state">Select a lap to see channel statistics.</div>;
  const remove = (n: string) => updateComponent(config.id, { channels: config.channels.filter((c) => c !== n) });

  return (
    <div
      className="html-panel"
      onDragOver={(e) => e.dataTransfer.types.includes('application/x-pt-channel') && (e.preventDefault(), e.stopPropagation())}
      onDrop={(e) => {
        const n = e.dataTransfer.getData('application/x-pt-channel');
        if (n && !config.channels.includes(n)) {
          e.preventDefault();
          e.stopPropagation();
          updateComponent(config.id, { channels: [...config.channels, n] });
        }
      }}
    >
      <table className="grid">
        <thead>
          <tr>
            <th className="l">Channel</th>
            {laps.map((l) =>
              config.stats.map((s, i) => (
                <th key={l.key + s} style={{ background: lapHeaderTint(l.color), color: 'var(--text)' }} title={lapLabel(l.lap)}>
                  {laps.length > 1 && i === 0 ? `L${l.lap.number} ` : ''}
                  {STAT_LABEL[s]}
                </th>
              )),
            )}
            <th style={{ width: 20 }}></th>
          </tr>
        </thead>
        <tbody>
          {config.channels.map((name) => {
            const first = laps.map((l) => l.session.channels.get(name)).find(Boolean);
            const unit = first ? conv(first).unit : '';
            return (
              <tr key={name}>
                <td className="l">
                  {name} {unit && <span className="muted">[{unit}]</span>}
                </td>
                {laps.map((l) => {
                  const ch = l.session.channels.get(name);
                  const bg = { background: lapTint(l.color) };
                  if (!ch)
                    return config.stats.map((s) => (
                      <td key={l.key + s} className="muted" style={bg}>
                        n/a
                      </td>
                    ));
                  const [ta, tb] = lapWindow(l.lap, config.useZoom, zoom, xMode);
                  const st = rangeStats(ch.data, Math.ceil((ta - ch.t0) * ch.rate), Math.floor((tb - ch.t0) * ch.rate));
                  const c = conv(ch);
                  const dps = channelDps(ch);
                  return config.stats.map((s) => (
                    <td key={l.key + s} className="num" style={bg}>
                      {formatValue(s === 'std' ? st.std * c.k : st[s] * c.k + c.b, dps)}
                    </td>
                  ));
                })}
                <td>
                  <button className="btn ghost small" title="Remove" onClick={() => remove(name)}>
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: 8 }} className="row">
        <button className="btn small" onClick={(e) => openChannelPicker(e, (n) => !config.channels.includes(n) && updateComponent(config.id, { channels: [...config.channels, n] }))}>
          + Add channel
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          {config.useZoom && zoom ? 'Zoomed range' : 'Whole lap'} · drag channels here from the sidebar
        </span>
      </div>
    </div>
  );
}
