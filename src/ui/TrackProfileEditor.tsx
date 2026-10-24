// Editor for everything saved per track: map rotation (working value + save / reset), mirror,
// user-defined corners and custom section splits. Used in the Properties pop-out and as its own
// dialog (Analysis → Track Profile).

import { useEffect, useState } from 'react';
import { xToTime } from '../core/axis';
import { suggestCorners } from '../core/corners';
import { prettyTrack } from '../core/format';
import { lapDistAt } from '../core/session';
import {
  refLap,
  resetRotation,
  rotationDirty,
  saveRotation,
  setTrackProfile,
  setUi,
  setWorkingRotation,
  trackProfile,
  trackRotation,
  useStore,
} from '../state/store';
import { promptText } from './overlays';

function NumberInput({ value, onCommit, width = 90 }: { value: number; onCommit: (v: number) => void; width?: number }) {
  const [s, setS] = useState(String(value));
  useEffect(() => setS(String(value)), [value]);
  const commit = () => {
    const v = Number(s);
    if (Number.isFinite(v)) onCommit(v);
    else setS(String(value));
  };
  return <input className="input num" style={{ width }} value={s} onChange={(e) => setS(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

export function TrackProfileEditor() {
  const ref = refLap();
  const venue = ref?.session.meta.venue ?? '';
  useStore((s) => s.settings.trackProfiles[venue]);
  useStore((s) => s.workingRotation[venue]);
  const cursor = useStore((s) => s.cursor);
  if (!ref || !venue) return <div className="muted">Open a session to edit its track profile.</div>;
  const prof = trackProfile(venue);
  const rot = trackRotation(venue);
  const dirty = rotationDirty(venue);
  const st = useStore.getState();
  const cursorDist = cursor != null && ref.lap.index !== -1 ? Math.round(lapDistAt(ref.lap, xToTime(ref.lap, cursor, st.xMode))) : null;
  const tr = prettyTrack(venue);

  const editList = (key: 'corners' | 'sections', label: string) => {
    const items = prof[key];
    const set = (next: { name: string; dist: number }[], what: string) => setTrackProfile(venue, { [key]: next.slice().sort((a, b) => a.dist - b.dist) }, what);
    return (
      <div className="insp-group">
        <div className="row">
          <h4 className="grow">
            {label} ({items.length})
          </h4>
          <button
            className="btn small"
            disabled={cursorDist == null}
            title={cursorDist == null ? 'Place the cursor on a lap first' : `Add at ${cursorDist} m`}
            onClick={async () => {
              const name = await promptText(`${key === 'corners' ? 'Corner' : 'Section split'} name at ${cursorDist} m`, key === 'corners' ? `T${items.length + 1}` : `Split ${items.length + 1}`);
              if (name) set([...items, { name, dist: cursorDist! }], key === 'corners' ? 'Add corner' : 'Add section');
            }}
          >
            + Add at cursor{cursorDist != null ? ` (${cursorDist} m)` : ''}
          </button>
        </div>
        {items.length === 0 && (
          <div className="muted" style={{ fontSize: 12 }}>
            {key === 'corners'
              ? 'No corners yet. Place the cursor at an apex and click “Add at cursor”, or right-click a graph or the track map.'
              : 'Section splits divide the lap into named parts for the Lap Report’s “Custom sections” columns.'}
          </div>
        )}
        {items.length > 0 && (
          <table className="grid">
            <thead>
              <tr>
                <th className="l">Name</th>
                <th>Distance (m)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c, i) => (
                <tr key={i + c.name}>
                  <td className="l">
                    <input
                      className="input"
                      defaultValue={c.name}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && set(items.map((x, k) => (k === i ? { ...x, name: e.target.value.trim() } : x)), 'Rename')}
                    />
                  </td>
                  <td>
                    <NumberInput value={Math.round(c.dist)} onCommit={(v) => set(items.map((x, k) => (k === i ? { ...x, dist: v } : x)), 'Move')} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn small" disabled={cursorDist == null} title="Move to the cursor position" onClick={() => set(items.map((x, k) => (k === i ? { ...x, dist: cursorDist! } : x)), 'Move')}>
                      ⇢ cursor
                    </button>{' '}
                    <button className="btn small icon" title="Delete" onClick={() => set(items.filter((_, k) => k !== i), 'Delete')}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {key === 'corners' && ref.lap.index !== -1 && (
            <button
              className="btn small ghost"
              title="Proposes corners at the speed minima of the reference lap. Only runs when you click it."
              onClick={() => {
                if (items.length && !window.confirm('Replace your current corners with suggestions from the reference lap?')) return;
                set(suggestCorners(ref.session, ref.lap), 'Suggest corners');
              }}
            >
              Suggest from speed minima
            </button>
          )}
          {items.length > 0 && (
            <button className="btn small ghost" onClick={() => window.confirm(`Delete all ${label.toLowerCase()} for this track?`) && set([], 'Clear')}>
              Clear all
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="insp-group">
        <h4>Track profile</h4>
        <div>
          <b>{tr.track}</b> <span className="muted">{tr.layout}</span>
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          Saved for “{venue}” and shared by every workspace.
        </div>
      </div>
      <div className="insp-group">
        <h4>Map rotation</h4>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <NumberInput value={Math.round(rot * 10) / 10} onCommit={(v) => setWorkingRotation(venue, v)} />
          <span className="muted">°</span>
          <button className="btn small" onClick={() => setWorkingRotation(venue, rot - 90)}>
            ⟲ 90°
          </button>
          <button className="btn small" onClick={() => setWorkingRotation(venue, rot + 90)}>
            ⟳ 90°
          </button>
        </div>
        <div className="row">
          <button className="btn small primary" disabled={!dirty} onClick={() => saveRotation(venue)}>
            Save as track default
          </button>
          <button className="btn small" disabled={!dirty} onClick={() => resetRotation(venue)}>
            Reset to saved ({Math.round(prof.rotation)}°)
          </button>
          {dirty && <span style={{ color: 'var(--warning)', fontSize: 11 }}>unsaved</span>}
        </div>
        <label className="check">
          <input type="checkbox" checked={prof.mirror} onChange={(e) => setTrackProfile(venue, { mirror: e.target.checked }, 'Mirror track')} />
          Mirror map
        </label>
        <div className="muted" style={{ fontSize: 11 }}>
          Tip: drag the ring of the dial in the corner of any track map or GPS track to rotate it.
        </div>
      </div>
      {editList('corners', 'Corners')}
      {editList('sections', 'Section splits')}
    </>
  );
}

export function TrackProfileDialog() {
  const close = () => setUi({ trackProfile: false });
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" style={{ width: 640, maxHeight: 'calc(100vh - 80px)' }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Track profile — corners, sections & rotation</h2>
          <button className="btn icon ghost" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body insp-body">
          <TrackProfileEditor />
        </div>
        <div className="modal-foot">
          <span className="muted grow" style={{ fontSize: 12 }}>
            Changes are saved immediately (Ctrl/⌘+Z to undo).
          </span>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
