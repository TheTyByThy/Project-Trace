// The Track editor: one place for everything saved per track — where the corners are (on a clickable
// map and in a table), their ranges (detected from the driving, or exact), their speed buckets (auto,
// or set by hand), the corner detection settings, the custom splits and the map rotation / mirror.
// Opened from the top bar (Track), Analysis → Track Profile, and every "edit corners" link in the app.

import { useCallback, useEffect, useRef, useState } from 'react';
import { xToTime } from '../core/axis';
import { BUCKETS, bucketSegments, cornerWindows, suggestCorners, trackSegments, type BucketedSegment, type TrackCorner } from '../core/corners';
import { withAlpha } from '../core/colors';
import { formatValue, prettyTrack } from '../core/format';
import { crossingTime, lapDistAt, lapLabel } from '../core/session';
import { convertUnit } from '../core/units';
import { chartTheme, prepCanvas, useElementSize } from '../charts/canvas';
import { lapPath, makeProjector, positionAt } from '../charts/trackGeo';
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
  type SelectedLap,
  type TrackProfile,
} from '../state/store';
import { CornerSettingsEditor } from './CornerSettingsEditor';
import { promptText } from './overlays';

/** Bucket colours (same as the L / M / H tags in styles.css). */
const BUCKET_COLOR: Record<string, string> = { low: '#d95926', medium: '#c98500', high: '#d55181' };
/** Corners are drawn at least this far either side of the apex (m), even if their range is shorter. */
const MIN_HALF_M = 15;

export function openTrackEditor() {
  setUi({ trackProfile: true });
}

function NumberInput({ value, onCommit, width = 72 }: { value: number; onCommit: (v: number) => void; width?: number }) {
  const [s, setS] = useState(String(value));
  useEffect(() => setS(String(value)), [value]);
  const commit = () => {
    const v = Number(s);
    if (Number.isFinite(v)) onCommit(v);
    else setS(String(value));
  };
  return <input className="input num" style={{ width }} value={s} onChange={(e) => setS(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}

/** Optional number: empty = automatic (the placeholder shows the automatic value). */
function OptNumberInput({ value, auto, onCommit, width = 72 }: { value?: number; auto: number; onCommit: (v: number | undefined) => void; width?: number }) {
  const str = value == null ? '' : String(Math.round(value));
  const [s, setS] = useState(str);
  useEffect(() => setS(str), [str]);
  const commit = () => {
    const t = s.trim();
    if (t === '') return onCommit(undefined);
    const v = Number(t);
    if (Number.isFinite(v)) onCommit(v);
    else setS(str);
  };
  return (
    <input
      className={'input num' + (value == null ? ' auto' : '')}
      style={{ width }}
      value={s}
      placeholder={Number.isFinite(auto) ? `${Math.round(auto)}` : 'auto'}
      title={value == null ? 'Detected automatically — type a value to fix it' : 'Set by you — clear it to go back to automatic'}
      onChange={(e) => setS(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Map: the reference lap with every corner's range in its bucket colour. Click a corner to select
// it, click the track to move the selected corner's apex there, double-click to add a corner.
// ---------------------------------------------------------------------------------------------

function TrackEditorMap({
  lap: ref,
  prof,
  segs,
  selected,
  onSelect,
}: {
  lap: SelectedLap;
  prof: TrackProfile;
  segs: BucketedSegment[];
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geomRef = useRef<{ pts: Float64Array; dist: Float64Array; apex: { name: string; x: number; y: number }[] } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const venue = ref.session.meta.venue;
  const rotation = useStore((s) => s.workingRotation[venue] ?? s.settings.trackProfiles[venue]?.rotation ?? 0);
  const theme = useStore((s) => s.settings.theme);
  const cursor = useStore((s) => s.cursor);

  const draw = useCallback(() => {
    const { w, h } = size;
    const ctx = prepCanvas(canvasRef.current, w, h);
    if (!ctx) return;
    const T = chartTheme();
    ctx.font = T.font;
    ctx.textBaseline = 'middle';
    geomRef.current = null;
    const path = lapPath(ref.session, ref.lap);
    if (!path || path.t.length < 10) {
      ctx.fillStyle = T.text3;
      ctx.textAlign = 'center';
      ctx.fillText('No position channels in this session — use the table to edit corners', w / 2, h / 2);
      return;
    }
    const proj = makeProjector(rotation, prof.mirror);
    const n = path.t.length;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    const raw = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const [a, b] = proj(path.x[i], path.y[i]);
      raw[2 * i] = a;
      raw[2 * i + 1] = b;
      minX = Math.min(minX, a);
      maxX = Math.max(maxX, a);
      minY = Math.min(minY, b);
      maxY = Math.max(maxY, b);
    }
    const pad = 34;
    const sc = Math.min((w - 2 * pad) / Math.max(1, maxX - minX), (h - 2 * pad) / Math.max(1, maxY - minY));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const pts = new Float64Array(n * 2);
    const dist = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      pts[2 * i] = w / 2 + (raw[2 * i] - cx) * sc;
      pts[2 * i + 1] = h / 2 + (raw[2 * i + 1] - cy) * sc;
      dist[i] = lapDistAt(ref.lap, path.t[i]);
    }
    const stroke = (pred: (d: number) => boolean) => {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < n; i++) {
        if (!pred(dist[i])) {
          pen = false;
          continue;
        }
        if (!pen) ctx.moveTo(pts[2 * i], pts[2 * i + 1]);
        else ctx.lineTo(pts[2 * i], pts[2 * i + 1]);
        pen = true;
      }
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Track (straights) in grey, corner ranges in their bucket colour, the selected corner outlined.
    ctx.strokeStyle = T.road;
    ctx.lineWidth = 12;
    stroke(() => true);
    ctx.strokeStyle = withAlpha(T.text3, 0.5);
    ctx.lineWidth = 3;
    stroke(() => true);
    // Square ends and a minimum length, so every corner reads as a stretch of track (never a blob).
    ctx.lineCap = 'butt';
    const span = (g: BucketedSegment) => {
      const a = Math.min(g.entry, g.apex - MIN_HALF_M);
      const b = Math.max(g.exit, g.apex + MIN_HALF_M);
      return (d: number) => d >= a && d <= b;
    };
    for (const g of segs) {
      if (g.kind !== 'corner') continue;
      if (g.name === selected) {
        ctx.strokeStyle = T.cursor;
        ctx.lineWidth = 11;
        stroke(span(g));
      }
      ctx.strokeStyle = BUCKET_COLOR[g.bucket] ?? T.accent;
      ctx.lineWidth = 7;
      stroke(span(g));
    }
    ctx.lineCap = 'round';
    // Splits (green ticks) and the start / finish line.
    const at = (d: number) => {
      const t = d <= 0.5 ? ref.lap.start : crossingTime(ref.lap, d);
      if (!Number.isFinite(t)) return null;
      const [a, b] = proj(...positionAt(path, t));
      return [w / 2 + (a - cx) * sc, h / 2 + (b - cy) * sc] as [number, number];
    };
    const tag = (p: [number, number], text: string, color: string, bold = false) => {
      ctx.font = bold ? `600 ${T.font}` : T.font;
      const tw = ctx.measureText(text).width + 8;
      const dx = p[0] - w / 2;
      const dy = p[1] - h / 2;
      const dl = Math.hypot(dx, dy) || 1;
      const lx = p[0] + (dx / dl) * 18;
      const ly = p[1] + (dy / dl) * 18;
      ctx.fillStyle = withAlpha(T.surface2, 0.92);
      ctx.fillRect(lx - tw / 2, ly - 8, tw, 16);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(text, lx, ly);
      ctx.font = T.font;
    };
    const sf = at(0);
    if (sf) tag(sf, 'S/F', T.text, true);
    for (const sp of prof.sections) {
      const p = at(sp.dist);
      if (!p) continue;
      ctx.fillStyle = '#199e70';
      ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6);
      tag(p, sp.name, T.text2);
    }
    // Apexes with their names.
    const apex: { name: string; x: number; y: number }[] = [];
    for (const g of segs) {
      if (g.kind !== 'corner') continue;
      const p = at(g.apex);
      if (!p) continue;
      apex.push({ name: g.name, x: p[0], y: p[1] });
      ctx.beginPath();
      ctx.arc(p[0], p[1], g.name === selected ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = g.name === selected ? T.cursor : T.surface;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = BUCKET_COLOR[g.bucket] ?? T.accent;
      ctx.stroke();
      tag(p, g.name, g.name === selected ? T.text : T.text2, g.name === selected);
    }
    // The app's cursor and the hovered point.
    const st = useStore.getState();
    if (st.cursor != null) {
      const p = at(lapDistAt(ref.lap, xToTime(ref.lap, st.cursor, st.xMode)));
      if (p) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
        ctx.fillStyle = T.accent;
        ctx.fill();
      }
    }
    if (hover != null) {
      const p = at(hover);
      if (p) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
        ctx.strokeStyle = T.text;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    geomRef.current = { pts, dist, apex };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, ref, prof, segs, selected, rotation, theme, cursor, hover]);
  useEffect(draw, [draw]);

  /** Lap distance of the track point nearest the mouse (within 24 px), and any apex under it. */
  const pick = (e: React.MouseEvent) => {
    const g = geomRef.current;
    if (!g) return null;
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const near = g.apex.find((a) => Math.hypot(a.x - x, a.y - y) < 12);
    let best = Infinity;
    let bi = -1;
    for (let i = 0; i < g.dist.length; i++) {
      const d = (g.pts[2 * i] - x) ** 2 + (g.pts[2 * i + 1] - y) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return { apex: near?.name ?? null, dist: best < 24 * 24 && bi >= 0 ? Math.round(g.dist[bi]) : null };
  };

  const moveApex = (name: string, dist: number) =>
    setTrackProfile(venue, { corners: prof.corners.map((c) => (c.name === name ? { ...c, dist } : c)).sort((a, b) => a.dist - b.dist) }, 'Move corner');

  return (
    <div className="track-editor-map">
      <div ref={wrapRef} className="chart" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ cursor: hover != null ? 'pointer' : 'default' }}
          onMouseMove={(e) => setHover(pick(e)?.dist ?? null)}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const p = pick(e);
            if (!p) return;
            if (p.apex) onSelect(p.apex === selected ? null : p.apex);
            else if (selected && p.dist != null) moveApex(selected, p.dist);
          }}
          onDoubleClick={async (e) => {
            const p = pick(e);
            if (!p || p.dist == null || p.apex) return;
            const name = await promptText(`Corner name at ${p.dist} m`, `T${prof.corners.length + 1}`);
            if (name) {
              setTrackProfile(venue, { corners: [...prof.corners, { name, dist: p.dist }].sort((a, b) => a.dist - b.dist) }, 'Add corner');
              onSelect(name);
            }
          }}
        />
      </div>
      <div className="muted track-editor-hint">
        {hover != null ? <b style={{ color: 'var(--text)' }}>{hover} m · </b> : null}
        {selected
          ? `Click the track to move ${selected}'s apex there · click ${selected} again to deselect`
          : 'Click a corner to select it · double-click the track to add a corner'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

function TrackEditorBody() {
  const ref = refLap();
  const venue = ref?.session.meta.venue ?? '';
  useStore((s) => s.settings.trackProfiles[venue]);
  useStore((s) => s.workingRotation[venue]);
  useStore((s) => s.dataVersion);
  const cornerSettings = useStore((s) => s.settings.corners);
  const speedUnit = useStore((s) => s.settings.units.speed);
  const cursor = useStore((s) => s.cursor);
  const [selected, setSelected] = useState<string | null>(null);
  if (!ref || !venue) return <div className="empty-state">Open a session to edit its track.</div>;
  const prof = trackProfile(venue);
  const st = useStore.getState();
  const hasLap = ref.lap.index !== -1;
  const cursorDist = cursor != null && hasLap ? Math.round(lapDistAt(ref.lap, xToTime(ref.lap, cursor, st.xMode))) : null;
  const tr = prettyTrack(venue);
  const sc = convertUnit('kph', speedUnit) ?? { k: 1, b: 0 };

  const ctx = { session: ref.session, lap: ref.lap, settings: cornerSettings };
  const len = ref.session.trackLength;
  const corners = prof.corners.slice().sort((a, b) => a.dist - b.dist);
  // Effective ranges (exact where set), and what automatic detection would give (for the placeholders).
  const segs = hasLap ? bucketSegments(ctx, trackSegments(cornerWindows(corners, len, ctx), len)) : [];
  const auto = hasLap ? cornerWindows(corners.map((c) => ({ name: c.name, dist: c.dist })), len, ctx) : [];
  const segOf = (c: TrackCorner) => segs.find((g) => g.kind === 'corner' && g.name === c.name && g.apex === c.dist);
  const autoOf = (c: TrackCorner) => auto.find((w) => w.name === c.name && w.apex === c.dist);

  const setCorners = (next: TrackCorner[], label: string) => setTrackProfile(venue, { corners: next.slice().sort((a, b) => a.dist - b.dist) }, label);
  const patch = (c: TrackCorner, p: Partial<TrackCorner>, label: string) => setCorners(corners.map((x) => (x === c ? { ...x, ...p } : x)), label);
  const setSections = (next: { name: string; dist: number }[], label: string) => setTrackProfile(venue, { sections: next.slice().sort((a, b) => a.dist - b.dist) }, label);
  const rot = trackRotation(venue);
  const dirty = rotationDirty(venue);

  return (
    <div className="track-editor">
      <div className="track-editor-left">
        {hasLap ? (
          <TrackEditorMap lap={ref} prof={prof} segs={segs} selected={selected} onSelect={setSelected} />
        ) : (
          <div className="empty-state">Pick a single reference lap (not the whole session) to see the map and detected ranges.</div>
        )}
        <div className="insp-group">
          <h4>Map rotation &amp; mirror</h4>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <NumberInput value={Math.round(rot * 10) / 10} onCommit={(v) => setWorkingRotation(venue, v)} />
            <span className="muted">°</span>
            <button className="btn small" onClick={() => setWorkingRotation(venue, rot - 90)}>
              ⟲ 90°
            </button>
            <button className="btn small" onClick={() => setWorkingRotation(venue, rot + 90)}>
              ⟳ 90°
            </button>
            <button className="btn small primary" disabled={!dirty} onClick={() => saveRotation(venue)}>
              Save as track default
            </button>
            <button className="btn small" disabled={!dirty} onClick={() => resetRotation(venue)}>
              Reset ({Math.round(prof.rotation)}°)
            </button>
            {dirty && <span style={{ color: 'var(--warning)', fontSize: 11 }}>unsaved</span>}
            <label className="check">
              <input type="checkbox" checked={prof.mirror} onChange={(e) => setTrackProfile(venue, { mirror: e.target.checked }, 'Mirror track')} />
              Mirror
            </label>
          </div>
        </div>
      </div>

      <div className="track-editor-right">
        <div className="insp-group">
          <div className="row">
            <h4 className="grow">Corners ({corners.length})</h4>
            <button
              className="btn small"
              disabled={cursorDist == null}
              title={cursorDist == null ? 'Place the cursor on a lap first' : `Add a corner at ${cursorDist} m`}
              onClick={async () => {
                const name = await promptText(`Corner name at ${cursorDist} m`, `T${corners.length + 1}`);
                if (name) {
                  setCorners([...corners, { name, dist: cursorDist! }], 'Add corner');
                  setSelected(name);
                }
              }}
            >
              + Add at cursor{cursorDist != null ? ` (${cursorDist} m)` : ''}
            </button>
            {hasLap && (
              <button
                className="btn small ghost"
                title="Proposes corners at the speed minima of the reference lap"
                onClick={() => {
                  if (corners.length && !window.confirm('Replace your corners for this track with suggestions from the reference lap?')) return;
                  setCorners(suggestCorners(ref.session, ref.lap), 'Suggest corners');
                }}
              >
                Suggest from speed minima
              </button>
            )}
            {corners.length > 0 && (
              <button className="btn small ghost" onClick={() => window.confirm('Delete every corner for this track?') && setCorners([], 'Clear corners')}>
                Clear all
              </button>
            )}
          </div>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            <b>Start / End</b> are detected from the reference lap's driving (grey) — type a distance to fix one, clear it to go back to automatic.{' '}
            <b>Speed</b> is the bucket from the minimum speed (Auto) — pick Low / Medium / High to override it. Everything here is saved with the track.
          </div>
          {corners.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              No corners yet. Double-click the map, use <b>+ Add at cursor</b>, or <b>Suggest from speed minima</b>.
            </div>
          ) : (
            <table className="grid track-editor-table">
              <thead>
                <tr>
                  <th className="l">Name</th>
                  <th>Apex (m)</th>
                  <th>Start (m)</th>
                  <th>End (m)</th>
                  <th className="l">Speed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {corners.map((c, i) => {
                  const g = segOf(c);
                  const a = autoOf(c);
                  const autoB = g?.autoBucket && g.autoBucket !== 'straight' ? g.autoBucket : null;
                  const minSpeed = g && Number.isFinite(g.refMinSpeed) ? `${formatValue(g.refMinSpeed * sc.k + sc.b, 0)} ${speedUnit}` : '';
                  return (
                    <tr key={i + c.name} className={'click' + (selected === c.name ? ' sel' : '')} onClick={() => setSelected(c.name)}>
                      <td className="l">
                        {g && <span className={'bucket-chip ' + g.bucket}>{BUCKETS.find((b) => b.key === g.bucket)?.short}</span>}
                        <input
                          className="input"
                          style={{ width: 90 }}
                          defaultValue={c.name}
                          key={c.name}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== c.name) {
                              patch(c, { name: v }, 'Rename corner');
                              if (selected === c.name) setSelected(v);
                            }
                          }}
                        />
                      </td>
                      <td>
                        <NumberInput value={Math.round(c.dist)} onCommit={(v) => patch(c, { dist: v }, 'Move corner')} />
                      </td>
                      <td>
                        <OptNumberInput value={c.start} auto={a?.entry ?? NaN} onCommit={(v) => patch(c, { start: v }, 'Corner range')} />
                      </td>
                      <td>
                        <OptNumberInput value={c.end} auto={a?.exit ?? NaN} onCommit={(v) => patch(c, { end: v }, 'Corner range')} />
                      </td>
                      <td className="l">
                        <select
                          className={'input' + (c.bucket ? '' : ' auto')}
                          style={{ width: 186, height: 26 }}
                          value={c.bucket ?? ''}
                          title={c.bucket ? 'Set by you' : 'Automatic, from the minimum speed'}
                          onChange={(e) => patch(c, { bucket: (e.target.value || undefined) as TrackCorner['bucket'] }, 'Corner speed bucket')}
                        >
                          <option value="">
                            Auto{autoB ? ` (${BUCKETS.find((b) => b.key === autoB)?.label.split('-')[0]}${minSpeed ? `, ${minSpeed}` : ''})` : ''}
                          </option>
                          <option value="low">Low speed</option>
                          <option value="medium">Medium speed</option>
                          <option value="high">High speed</option>
                        </select>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn small"
                          disabled={cursorDist == null}
                          title="Move the apex to the cursor"
                          onClick={(e) => {
                            e.stopPropagation();
                            patch(c, { dist: cursorDist! }, 'Move corner');
                          }}
                        >
                          ⇢ cursor
                        </button>{' '}
                        <button
                          className="btn small icon"
                          title="Delete corner"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCorners(
                              corners.filter((x) => x !== c),
                              'Delete corner',
                            );
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="insp-group">
          <h4>Corner detection &amp; speed buckets (all tracks)</h4>
          <CornerSettingsEditor compact />
        </div>

        <div className="insp-group">
          <div className="row">
            <h4 className="grow">Splits ({prof.sections.length})</h4>
            <button
              className="btn small"
              disabled={cursorDist == null}
              onClick={async () => {
                const name = await promptText(`Split name at ${cursorDist} m`, `Split ${prof.sections.length + 1}`);
                if (name) setSections([...prof.sections, { name, dist: cursorDist! }], 'Add section');
              }}
            >
              + Add at cursor{cursorDist != null ? ` (${cursorDist} m)` : ''}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            Splits divide the lap into named parts for the Lap and Stint Reports' <i>Custom sections</i> columns.
          </div>
          {prof.sections.length > 0 && (
            <table className="grid track-editor-table">
              <thead>
                <tr>
                  <th className="l">Name</th>
                  <th>Distance (m)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {prof.sections.map((sp, i) => (
                  <tr key={i + sp.name}>
                    <td className="l">
                      <input
                        className="input"
                        style={{ width: 120 }}
                        defaultValue={sp.name}
                        key={sp.name}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== sp.name && setSections(prof.sections.map((x, k) => (k === i ? { ...x, name: e.target.value.trim() } : x)), 'Rename')}
                      />
                    </td>
                    <td>
                      <NumberInput value={Math.round(sp.dist)} onCommit={(v) => setSections(prof.sections.map((x, k) => (k === i ? { ...x, dist: v } : x)), 'Move')} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn small" disabled={cursorDist == null} onClick={() => setSections(prof.sections.map((x, k) => (k === i ? { ...x, dist: cursorDist! } : x)), 'Move')}>
                        ⇢ cursor
                      </button>{' '}
                      <button className="btn small icon" title="Delete" onClick={() => setSections(prof.sections.filter((_, k) => k !== i), 'Delete')}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="muted" style={{ fontSize: 11, padding: '0 2px 8px' }}>
          {tr.track} {tr.layout} — saved for “{venue}” and shared by every workspace. Ranges and speeds are measured on the reference lap ({lapLabel(ref.lap)}).
        </div>
      </div>
    </div>
  );
}

/** Compact pointer used in Properties panels: what's defined for the track, and a button to edit it. */
export function TrackEditorLink() {
  const ref = refLap();
  const venue = ref?.session.meta.venue ?? '';
  const prof = useStore((s) => s.settings.trackProfiles[venue]);
  const tr = prettyTrack(venue);
  return (
    <div className="insp-group">
      <h4>Track</h4>
      {venue ? (
        <div className="muted" style={{ fontSize: 12 }}>
          <b style={{ color: 'var(--text)' }}>{tr.track}</b> {tr.layout} · {prof?.corners?.length ?? 0} corners · {prof?.sections?.length ?? 0} splits
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12 }}>Open a session to edit its track.</div>
      )}
      <button className="btn" onClick={openTrackEditor}>
        Open the track editor (corners, ranges, speed buckets, splits, rotation)
      </button>
    </div>
  );
}

export function TrackProfileDialog() {
  const close = () => setUi({ trackProfile: false });
  const ref = refLap();
  const tr = prettyTrack(ref?.session.meta.venue ?? '');
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal track-editor-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            Track editor{ref ? ` — ${tr.track}` : ''} {tr.layout && <span className="muted" style={{ fontWeight: 400 }}>{tr.layout}</span>}
          </h2>
          <span className="grow" />
          <button className="btn icon ghost" onClick={close} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-body" style={{ padding: 0, minHeight: 0, flex: 1, display: 'flex' }}>
          <TrackEditorBody />
        </div>
        <div className="modal-foot">
          <span className="muted grow" style={{ fontSize: 12 }}>
            Changes are saved to the track immediately (Ctrl/⌘+Z to undo).
          </span>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
