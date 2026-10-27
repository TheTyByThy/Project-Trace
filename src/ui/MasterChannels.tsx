// Settings → Master channels: the name everything uses, and the logged channels to fill it from (first found wins),
// with what each open session actually uses. Edits apply to the open sessions at once.

import { useMemo, useState } from 'react';
import { DEFAULT_CHANNEL_MASTERS, masterSources, type ChannelMaster } from '../core/channelMasters';
import { updateSettings, useStore } from '../state/store';

const splitSources = (text: string) =>
  text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** A text field that commits on blur / Enter (so the sessions are re-mapped once, not on every key). */
function CommitInput({ value, onCommit, placeholder, list }: { value: string; onCommit: (v: string) => void; placeholder?: string; list?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="input"
      style={{ width: '100%' }}
      value={draft ?? value}
      placeholder={placeholder}
      list={list}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft != null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function MasterChannelsPanel() {
  const masters = useStore((s) => s.settings.channelMasters);
  const sessions = useStore((s) => s.sessions);
  useStore((s) => s.dataVersion);
  const [filter, setFilter] = useState('');
  const save = (next: ChannelMaster[]) => updateSettings({ channelMasters: next });
  const edit = (i: number, patch: Partial<ChannelMaster>) => save(masters.map((m, k) => (k === i ? { ...m, ...patch } : m)));

  // Logged channel names in the open sessions (for suggestions and "add Ext_ channels").
  const logged = useMemo(() => {
    const names = new Set<string>();
    for (const s of sessions) for (const [n, ch] of s.channels) if (!ch.isMath && !ch.isDerived) names.add(n);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [sessions]);
  const covered = new Set(masters.flatMap((m) => [m.name, ...m.sources]));
  const uncoveredExt = logged.filter((n) => n.startsWith('Ext_') && !covered.has(n));

  const q = filter.trim().toLowerCase();
  const rows = masters.map((m, i) => ({ m, i })).filter(({ m }) => !q || `${m.name} ${m.sources.join(' ')} ${m.group ?? ''}`.toLowerCase().includes(q));
  const groups: string[] = [];
  for (const { m } of rows) if (!groups.includes(m.group || 'Custom')) groups.push(m.group || 'Custom');

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5, lineHeight: 1.5 }}>
        Workspaces, traces and math channels use the <b>master</b> name. Each session fills it from the <b>first source</b> in the list that its log has, so
        logs that name the same data differently (e.g. <code>Diff Entry</code> vs <code>Ext_Diff Entry</code>) all work with one workspace. Put another channel
        first to use it instead (e.g. <i>Throttle Pos</i> ← <code>Throttle Raw, Ext_Throttle Raw</code>). Changes apply to the open sessions straight away.
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <input className="input grow" placeholder="Filter master channels…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn" onClick={() => save([...masters, { name: '', sources: [], group: 'Custom' }])}>
          + Add master channel
        </button>
        {uncoveredExt.length > 0 && (
          <button
            className="btn"
            title={uncoveredExt.join(', ')}
            onClick={() =>
              save([
                ...masters,
                ...uncoveredExt.map((n) => ({
                  name: n.slice(4),
                  sources: [n.slice(4), n],
                  group: 'Custom',
                })),
              ])
            }
          >
            + Add {uncoveredExt.length} Ext_ channel
            {uncoveredExt.length > 1 ? 's' : ''} from open sessions
          </button>
        )}
        <button className="btn" onClick={() => window.confirm('Put the master channels back to the defaults?') && save(DEFAULT_CHANNEL_MASTERS)}>
          Restore defaults
        </button>
      </div>
      <datalist id="pt-logged-channels">
        {logged.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <table className="grid masters-table">
        <thead>
          <tr>
            <th className="l" style={{ width: '28%' }}>
              Master channel
            </th>
            <th className="l">Sources — first one found is used (comma-separated)</th>
            <th className="l" style={{ width: '26%' }}>
              {sessions.length ? 'Open sessions use' : 'Open sessions'}
            </th>
            <th style={{ width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => [
            <tr key={'g' + g} className="masters-group">
              <td colSpan={4}>{g}</td>
            </tr>,
            ...rows
              .filter(({ m }) => (m.group || 'Custom') === g)
              .map(({ m, i }) => (
                <tr key={i}>
                  <td>
                    <CommitInput value={m.name} placeholder="e.g. Throttle Pedal" list="pt-logged-channels" onCommit={(v) => edit(i, { name: v.trim() })} />
                  </td>
                  <td>
                    <CommitInput
                      value={m.sources.join(', ')}
                      placeholder="e.g. Throttle Pedal, Ext_Throttle Pedal"
                      onCommit={(v) => edit(i, { sources: splitSources(v) })}
                    />
                  </td>
                  <td className="l masters-used">
                    {sessions.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      sessions.map((s) => {
                        const src = masterSources(s)[m.name.trim()];
                        return (
                          <div key={s.id} title={s.fileName}>
                            <span className="muted">{s.meta.driver || s.fileName}: </span>
                            {src ? (
                              src === m.name.trim() ? (
                                <span>as logged</span>
                              ) : (
                                <span className="masters-mapped">{src}</span>
                              )
                            ) : (
                              <span className="muted">not logged</span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </td>
                  <td>
                    <button className="btn icon ghost small" title="Remove" onClick={() => save(masters.filter((_, k) => k !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              )),
          ])}
        </tbody>
      </table>
    </div>
  );
}
