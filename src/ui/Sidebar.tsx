// Left sidebar: loaded sessions & laps (reference/overlay selection) and the channel browser.

import { useMemo, useState } from 'react';
import { xToTime } from '../core/axis';
import { CATEGORIES } from '../core/channelMeta';
import { sampleAt } from '../core/channel';
import { lapColor } from '../core/colors';
import { formatDelta, formatLapTime, formatValue, prettyCar, prettyTrack } from '../core/format';
import { fastestLap } from '../core/session';
import { lapKey, type Session } from '../core/types';
import { pane } from '../state/components';
import {
  activeSheet,
  clearOverlays,
  closeSession,
  fastestAsReference,
  refLap,
  selectLap,
  selectWholeSession,
  setUi,
  updateComponent,
  updateSettings,
  useStore,
} from '../state/store';
import type { GraphConfig } from '../state/workspace';
import { channelDps, conv } from '../charts/data';
import { openChannelProps, openMenu } from './overlays';

function SessionCard({ s }: { s: Session }) {
  const lapSel = useStore((st) => st.laps);
  const refKey = useStore((st) => st.refKey);
  const theme = useStore((st) => st.settings.theme);
  const fl = fastestLap(s);
  const tr = prettyTrack(s.meta.venue);
  const wholeKey = lapKey({ sessionId: s.id, lapIndex: -1 });
  return (
    <div className="session-card">
      <div className="head">
        <div className="row">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="t" title={s.meta.venue}>
              {tr.track}
            </div>
            <div className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.fileName}>
              {prettyCar(s.meta.vehicle)} · {s.meta.driver}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {s.meta.savedAt ? new Date(s.meta.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}
            </div>
          </div>
          <button className="btn icon ghost" title="Close session" onClick={() => closeSession(s.id)}>
            ✕
          </button>
        </div>
      </div>
      {s.laps.map((lap) => {
        const key = lapKey({ sessionId: s.id, lapIndex: lap.index });
        const sel = lapSel.find((l) => l.key === key);
        const isRef = key === refKey;
        const isBest = fl === lap;
        return (
          <div
            key={lap.index}
            className={'lap-row' + (sel ? ' sel' : '')}
            onClick={(e) => selectLap(key, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'reference' : 'replace')}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu(e, [
                { label: 'Show only this lap', onClick: () => selectLap(key, 'replace') },
                { label: sel ? 'Remove overlay' : 'Add as overlay', onClick: () => selectLap(key, 'toggle') },
                { label: 'Set as reference', onClick: () => selectLap(key, 'reference') },
              ]);
            }}
            title="Click: show this lap · Ctrl/⌘+click: overlay · Shift+click: set as reference"
          >
            <span
              className="lap-check"
              style={sel ? { background: lapColor(sel.slot, theme), borderColor: lapColor(sel.slot, theme) } : undefined}
              onClick={(e) => {
                e.stopPropagation();
                selectLap(key, 'toggle');
              }}
            />
            <span
              className={'star' + (isRef ? ' on' : '')}
              title="Reference lap (variance is measured against it)"
              onClick={(e) => {
                e.stopPropagation();
                selectLap(key, 'reference');
              }}
            >
              {isRef ? '★' : '☆'}
            </span>
            <span>
              Lap {lap.number}{' '}
              {lap.kind === 'out' && <span className="tag">out</span>}
              {lap.kind === 'in' && <span className="tag">in</span>}
              {lap.kind === 'partial' && <span className="tag">part</span>}
              {lap.invalid && <span className="tag bad">inv</span>}
              {isBest && <span className="tag best">best</span>}
            </span>
            <span className="num" style={{ color: lap.complete ? 'var(--text)' : 'var(--text-3)', textDecoration: lap.invalid ? 'line-through' : undefined }}>
              {formatLapTime(lap.time)}
            </span>
            <span className="num muted" style={{ fontSize: 11, width: 52, textAlign: 'right' }}>
              {lap.complete && fl && !isBest ? formatDelta(lap.time - fl.time, 2) : ''}
            </span>
          </div>
        );
      })}
      <div className={'lap-row' + (lapSel.some((l) => l.key === wholeKey) ? ' sel' : '')} onClick={() => selectWholeSession(s.id)}>
        <span />
        <span />
        <span className="muted">Whole session</span>
        <span className="num muted">{formatLapTime(s.duration, 1)}</span>
        <span />
      </div>
    </div>
  );
}

function LapsPanel() {
  const sessions = useStore((s) => s.sessions);
  const loading = useStore((s) => s.loading);
  return (
    <div className="scroll">
      {!sessions.length && !loading.length && (
        <div className="empty-state" style={{ marginTop: 30 }}>
          <b>No session loaded</b>
          <div style={{ margin: '8px 0 12px' }}>Open a Telemetrick CSV export to begin.</div>
          <button className="btn primary" onClick={() => setUi({ browser: true })}>
            Open session browser
          </button>
        </div>
      )}
      {loading.map((l) => (
        <div key={l.path} className="session-card" style={{ padding: 10 }}>
          <div style={{ fontSize: 12, marginBottom: 6 }}>Loading {l.name}…</div>
          <div className="progress" style={{ width: '100%' }}>
            <div style={{ width: `${Math.round(l.progress * 100)}%` }} />
          </div>
        </div>
      ))}
      {sessions.map((s) => (
        <SessionCard key={s.id} s={s} />
      ))}
      {sessions.length > 0 && (
        <div className="row" style={{ padding: '4px 8px 12px', flexWrap: 'wrap' }}>
          <button className="btn small" onClick={fastestAsReference} title="F">
            Fastest lap
          </button>
          <button className="btn small" onClick={clearOverlays}>
            Clear overlays
          </button>
          <button className="btn small" onClick={() => setUi({ browser: true })} title="Add another session to compare">
            + Compare session
          </button>
        </div>
      )}
    </div>
  );
}

function addToGraph(name: string) {
  const sheet = activeSheet();
  if (!sheet) return;
  const activeId = useStore.getState().activeComponentId;
  const graphs = Object.values(sheet.components).filter((c): c is GraphConfig => c.type === 'graph');
  const target = graphs.find((g) => g.id === activeId) ?? graphs[0];
  if (target) updateComponent(target.id, { panes: [...target.panes, pane([name])] } as Partial<GraphConfig>);
}

function ChannelsPanel() {
  const sessions = useStore((s) => s.sessions);
  const hideConstant = useStore((s) => s.settings.hideConstant);
  useStore((s) => s.dataVersion);
  useStore((s) => s.cursor);
  useStore((s) => s.laps);
  useStore((s) => s.settings.units);
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const ref = refLap();
  const st = useStore.getState();
  const tRef = ref && st.cursor != null ? xToTime(ref.lap, st.cursor, st.xMode) : null;
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; constant: boolean; session: Session }[]>();
    const seen = new Set<string>();
    for (const s of sessions)
      for (const n of s.channelOrder) {
        if (seen.has(n)) continue;
        seen.add(n);
        const c = s.channels.get(n)!;
        if (hideConstant && c.constant) continue;
        if (q && !n.toLowerCase().includes(q.toLowerCase())) continue;
        const arr = map.get(c.category) ?? [];
        arr.push({ name: n, unit: c.unit, constant: c.constant, session: s });
        map.set(c.category, arr);
      }
    return CATEGORIES.filter((c) => map.has(c)).map((c) => ({ cat: c, items: map.get(c)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, q, hideConstant, st.dataVersion]);
  return (
    <>
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input className="input" placeholder="Search channels…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={hideConstant} onChange={(e) => updateSettings({ hideConstant: e.target.checked })} />
          Hide constant channels
        </label>
      </div>
      <div className="scroll">
        {!sessions.length && <div className="empty-state">Channels appear here once a session is open.</div>}
        {groups.map((g) => (
          <div key={g.cat} className="chan-group">
            <div className="gh" onClick={() => setCollapsed((c) => ({ ...c, [g.cat]: !c[g.cat] }))}>
              <span style={{ width: 10 }}>{collapsed[g.cat] && !q ? '▸' : '▾'}</span>
              {g.cat}
              <span className="muted" style={{ fontWeight: 400 }}>
                {g.items.length}
              </span>
            </div>
            {(!collapsed[g.cat] || q) &&
              g.items.map((it) => {
                const ch = (ref?.session ?? it.session).channels.get(it.name);
                let v = '';
                if (ch && tRef != null) {
                  const c = conv(ch);
                  v = formatValue(sampleAt(ch, tRef) * c.k + c.b, channelDps(ch));
                }
                const unit = ch ? conv(ch).unit : it.unit;
                return (
                  <div
                    key={it.name}
                    className={'chan-row' + (it.constant ? ' const' : '')}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-pt-channel', it.name);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDoubleClick={() => addToGraph(it.name)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(e, [
                        { header: it.name },
                        { label: 'Add to graph (new pane)', onClick: () => addToGraph(it.name) },
                        { label: 'Channel properties…', onClick: () => openChannelProps(it.name) },
                        { label: 'Copy name', onClick: () => navigator.clipboard.writeText(it.name) },
                      ]);
                    }}
                    title={`${it.name}${unit ? ` [${unit}]` : ''}${ch ? ` · ${ch.rate} Hz` : ''} — drag onto a component, double-click to add to the graph`}
                  >
                    <span className="swatch" style={{ width: 6, height: 6, borderRadius: 3, background: ch?.isMath ? 'var(--best)' : 'var(--text-3)' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                    <span className="v num">
                      {v} <span className="muted">{unit}</span>
                    </span>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </>
  );
}

export function Sidebar() {
  const tab = useStore((s) => s.ui.sidebarTab);
  return (
    <>
      <div className="panel-tabs">
        <button className={tab === 'laps' ? 'on' : ''} onClick={() => setUi({ sidebarTab: 'laps' })}>
          Sessions & laps
        </button>
        <button className={tab === 'channels' ? 'on' : ''} onClick={() => setUi({ sidebarTab: 'channels' })}>
          Channels
        </button>
      </div>
      {tab === 'laps' ? <LapsPanel /> : <ChannelsPanel />}
    </>
  );
}
