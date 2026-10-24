// Math channel editor: MoTeC-style expressions with live validation, preview, a function
// reference and click-to-insert channels. Edits are drafts until you press Apply.

import { useEffect, useMemo, useRef, useState } from 'react';
import { evaluateExpression, type MathChannelDef, type MathConstant } from '../core/math/evaluate';
import { BUILTIN_CONSTANTS, FUNCTIONS } from '../core/math/functions';
import { MathError } from '../core/math/parse';
import { rangeStats } from '../core/stats';
import { formatValue } from '../core/format';
import { uid } from '../state/workspace';
import { DEFAULT_MATH_CHANNELS } from '../state/defaultMath';
import { activeWorkspace, refLap, setMathChannels, setUi, toast, useStore } from '../state/store';
import { ChannelList } from './overlays';
import { chartTheme, prepCanvas } from '../charts/canvas';

interface Preview {
  ok: boolean;
  msg: string;
  pos?: number;
  data?: Float64Array;
  rate?: number;
  i0?: number;
  i1?: number;
}

function Sparkline({ p }: { p: Preview }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const w = ref.current?.parentElement?.clientWidth ?? 400;
    const h = 90;
    const ctx = prepCanvas(ref.current, w, h);
    if (!ctx || !p.data || p.i0 == null || p.i1 == null) return;
    const T = chartTheme();
    const st = rangeStats(p.data, p.i0, p.i1);
    const lo = st.min,
      hi = st.max === st.min ? st.min + 1 : st.max;
    ctx.strokeStyle = T.grid;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const n = p.i1 - p.i0;
    const step = Math.max(1, Math.floor(n / (w * 2)));
    let pen = false;
    for (let i = p.i0; i <= p.i1; i += step) {
      const v = p.data[i];
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const x = ((i - p.i0) / Math.max(1, n)) * (w - 4) + 2;
      const y = h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
      if (!pen) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }, [p]);
  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: 90 }} />;
}

export function MathEditor() {
  const ws = useStore((s) => activeWorkspace(s));
  const sessions = useStore((s) => s.sessions);
  const mathErrors = useStore((s) => s.mathErrors);
  const [defs, setDefs] = useState<MathChannelDef[]>(() => structuredClone(ws.math));
  const [consts, setConsts] = useState<MathConstant[]>(() => structuredClone(ws.constants));
  const [selId, setSelId] = useState<string | null>(defs[0]?.id ?? null);
  const [tab, setTab] = useState<'channels' | 'constants'>('channels');
  const [refTab, setRefTab] = useState<'functions' | 'channels'>('functions');
  const [fq, setFq] = useState('');
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const exprRef = useRef<HTMLTextAreaElement>(null);
  const sel = defs.find((d) => d.id === selId);
  const session = refLap()?.session ?? sessions[0];
  const errs = session ? mathErrors[session.id] ?? {} : {};

  const patch = (p: Partial<MathChannelDef>) => {
    setDefs((ds) => ds.map((d) => (d.id === selId ? { ...d, ...p } : d)));
    setDirty(true);
  };

  // Live preview of the selected expression against the reference session.
  useEffect(() => {
    if (!sel || !session) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      try {
        // Make other draft math channels visible to the preview by name if already computed.
        const r = evaluateExpression(sel.expr, session, consts);
        const lap = refLap()?.lap ?? session.laps[0];
        const i0 = lap ? Math.max(0, Math.floor(lap.start * r.rate)) : 0;
        const i1 = lap ? Math.min(r.data.length - 1, Math.floor(lap.end * r.rate)) : r.data.length - 1;
        const st = rangeStats(r.data, i0, i1);
        const d = sel.dps ?? 2;
        setPreview({
          ok: true,
          msg: `OK · ${r.rate} Hz · on the reference lap: min ${formatValue(st.min, d)}  avg ${formatValue(st.mean, d)}  max ${formatValue(st.max, d)} ${sel.unit}`,
          data: r.data,
          rate: r.rate,
          i0,
          i1,
        });
      } catch (e) {
        setPreview({ ok: false, msg: (e as Error).message, pos: e instanceof MathError ? e.pos : undefined });
      }
    }, 220);
    return () => clearTimeout(t);
  }, [sel?.expr, sel?.unit, sel?.dps, session, consts, sel]);

  const insert = (text: string) => {
    const ta = exprRef.current;
    if (!ta || !sel) return;
    const a = ta.selectionStart ?? sel.expr.length;
    const b = ta.selectionEnd ?? a;
    const next = sel.expr.slice(0, a) + text + sel.expr.slice(b);
    patch({ expr: next });
    requestAnimationFrame(() => {
      ta.focus();
      const caret = a + text.length - (text.endsWith('()') ? 1 : 0);
      ta.setSelectionRange(caret, caret);
    });
  };

  const apply = () => {
    const names = defs.map((d) => d.name.trim());
    const dup = names.find((n, i) => n && names.indexOf(n) !== i);
    if (dup) {
      toast(`Two math channels are called "${dup}"`, 'error');
      return;
    }
    setMathChannels(defs, consts);
    setDirty(false);
    toast('Math channels applied', 'success', 2000);
  };

  const close = () => {
    if (dirty && !window.confirm('Discard unapplied math channel changes?')) return;
    setUi({ math: false });
  };

  const fns = useMemo(() => {
    const q = fq.toLowerCase();
    return FUNCTIONS.filter((f) => !q || f.name.includes(q) || f.doc.toLowerCase().includes(q));
  }, [fq]);

  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal math-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Math channels — {ws.name}</h2>
          <div className="seg">
            <button className={tab === 'channels' ? 'on' : ''} onClick={() => setTab('channels')}>
              Channels ({defs.length})
            </button>
            <button className={tab === 'constants' ? 'on' : ''} onClick={() => setTab('constants')}>
              Constants ({consts.length})
            </button>
          </div>
        </div>
        {tab === 'channels' ? (
          <div className="math-grid">
            <div className="math-list">
              <div className="row" style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
                <button
                  className="btn small primary"
                  onClick={() => {
                    const d: MathChannelDef = { id: uid('m'), name: `Math ${defs.length + 1}`, expr: "'Ground Speed' [m/s]", unit: 'm/s', dps: 2, enabled: true };
                    setDefs([...defs, d]);
                    setSelId(d.id);
                    setDirty(true);
                  }}
                >
                  + New
                </button>
                <button
                  className="btn small"
                  disabled={!sel}
                  onClick={() => {
                    if (!sel) return;
                    const d = { ...sel, id: uid('m'), name: sel.name + ' copy' };
                    setDefs([...defs, d]);
                    setSelId(d.id);
                    setDirty(true);
                  }}
                >
                  Duplicate
                </button>
                <button
                  className="btn small"
                  disabled={!sel}
                  onClick={() => {
                    setDefs(defs.filter((d) => d.id !== selId));
                    setSelId(defs.find((d) => d.id !== selId)?.id ?? null);
                    setDirty(true);
                  }}
                >
                  Delete
                </button>
              </div>
              {defs.map((d) => {
                const e = errs[d.name];
                const missing = e && /Unknown (channel|name)/.test(e);
                return (
                  <div key={d.id} className={'math-item' + (d.id === selId ? ' sel' : '')} onClick={() => setSelId(d.id)}>
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) => {
                        setDefs(defs.map((x) => (x.id === d.id ? { ...x, enabled: ev.target.checked } : x)));
                        setDirty(true);
                      }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                    <span title={e ?? ''} style={{ fontSize: 11, color: !d.enabled ? 'var(--text-3)' : e ? (missing ? 'var(--text-3)' : 'var(--loss)') : 'var(--good)' }}>
                      {!d.enabled ? 'off' : e ? (missing ? 'n/a' : 'error') : session ? '✓' : ''}
                    </span>
                  </div>
                );
              })}
              <div style={{ padding: 8 }}>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    const have = new Set(defs.map((d) => d.name));
                    const add = DEFAULT_MATH_CHANNELS.filter((d) => !have.has(d.name)).map((d) => ({ ...d, id: uid('m') }));
                    setDefs([...defs, ...add]);
                    setDirty(true);
                    toast(add.length ? `Added ${add.length} default channels` : 'All default channels are already present', 'info', 2500);
                  }}
                >
                  Add missing defaults
                </button>
              </div>
            </div>
            <div style={{ padding: 16, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sel ? (
                <>
                  <div className="row">
                    <label className="field grow">
                      Name
                      <input className="input" value={sel.name} onChange={(e) => patch({ name: e.target.value })} />
                    </label>
                    <label className="field" style={{ width: 110 }}>
                      Unit
                      <input className="input" value={sel.unit} onChange={(e) => patch({ unit: e.target.value })} placeholder="e.g. kph" />
                    </label>
                    <label className="field" style={{ width: 90 }}>
                      Decimals
                      <input className="input" type="number" min={0} max={6} value={sel.dps ?? 2} onChange={(e) => patch({ dps: Number(e.target.value) })} />
                    </label>
                  </div>
                  <label className="field">
                    Expression
                    <textarea
                      ref={exprRef}
                      className="input expr"
                      spellCheck={false}
                      value={sel.expr}
                      onChange={(e) => patch({ expr: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          apply();
                        }
                      }}
                    />
                  </label>
                  {preview && (
                    <div className={preview.ok ? 'ok' : 'err'}>
                      {preview.ok ? '✓ ' : '✗ '}
                      {preview.msg}
                      {!preview.ok && preview.pos != null && (
                        <pre className="mono" style={{ margin: '6px 0 0', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                          {sel.expr}
                          {'\n'}
                          {' '.repeat(Math.min(preview.pos, sel.expr.length)) + '^'}
                        </pre>
                      )}
                    </div>
                  )}
                  {!session && <div className="muted">Open a session to preview results.</div>}
                  {preview?.ok && preview.data && <Sparkline p={preview} />}
                  <label className="field">
                    Description
                    <input className="input" value={sel.description ?? ''} onChange={(e) => patch({ description: e.target.value })} />
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={sel.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
                    Enabled
                  </label>
                  <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                    <b>Syntax:</b> channel names in quotes — <span className="mono">'Ground Speed'</span>; optional unit conversion —{' '}
                    <span className="mono">'Ground Speed' [m/s]</span>; operators <span className="mono">+ − * / % ^</span>, comparisons{' '}
                    <span className="mono">{'< <= > >= == !='}</span>, logic <span className="mono">and or not</span> (or <span className="mono">{'&& || !'}</span>), ternary{' '}
                    <span className="mono">cond ? a : b</span>. Math channels can use other math channels. Ctrl/⌘+Enter applies.
                  </div>
                </>
              ) : (
                <div className="empty-state">Select or create a math channel.</div>
              )}
            </div>
            <div className="math-ref">
              <div className="panel-tabs">
                <button className={refTab === 'functions' ? 'on' : ''} onClick={() => setRefTab('functions')}>
                  Functions
                </button>
                <button className={refTab === 'channels' ? 'on' : ''} onClick={() => setRefTab('channels')}>
                  Channels
                </button>
              </div>
              {refTab === 'functions' ? (
                <>
                  <div style={{ padding: 8 }}>
                    <input className="input" placeholder="Search functions…" value={fq} onChange={(e) => setFq(e.target.value)} />
                  </div>
                  <div className="scroll">
                    {fns.map((f) => (
                      <div key={f.name} className="fn-item" onClick={() => insert(f.minArgs === 0 ? `${f.name}()` : `${f.name}(`)} title="Click to insert">
                        <div className="sig">{f.sig}</div>
                        <div className="doc">{f.doc}</div>
                      </div>
                    ))}
                    <div className="section-title">Constants</div>
                    {Object.entries(BUILTIN_CONSTANTS).map(([k, v]) => (
                      <div key={k} className="fn-item" onClick={() => insert(k)}>
                        <div className="sig">{k}</div>
                        <div className="doc">{v.doc}</div>
                      </div>
                    ))}
                    {consts.map((c) => (
                      <div key={c.name} className="fn-item" onClick={() => insert(c.name)}>
                        <div className="sig">{c.name}</div>
                        <div className="doc">
                          {c.value} {c.unit}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <ChannelList autoFocus={false} onPick={(n) => insert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n}'`)} />
              )}
            </div>
          </div>
        ) : (
          <div className="modal-body" style={{ flex: 1 }}>
            <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
              Constants can be used by name in any expression — handy for car parameters (e.g. <span className="mono">SteeringRatio</span>,{' '}
              <span className="mono">Wheelbase</span>).
            </div>
            <table className="grid" style={{ maxWidth: 640 }}>
              <thead>
                <tr>
                  <th className="l">Name</th>
                  <th className="l">Value</th>
                  <th className="l">Unit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {consts.map((c, i) => (
                  <tr key={i}>
                    <td className="l">
                      <input
                        className="input"
                        value={c.name}
                        onChange={(e) => {
                          setConsts(consts.map((x, k) => (k === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '') } : x)));
                          setDirty(true);
                        }}
                      />
                    </td>
                    <td className="l">
                      <input
                        className="input num"
                        value={String(c.value)}
                        onChange={(e) => {
                          setConsts(consts.map((x, k) => (k === i ? { ...x, value: Number(e.target.value) || 0 } : x)));
                          setDirty(true);
                        }}
                      />
                    </td>
                    <td className="l">
                      <input
                        className="input"
                        value={c.unit ?? ''}
                        onChange={(e) => {
                          setConsts(consts.map((x, k) => (k === i ? { ...x, unit: e.target.value } : x)));
                          setDirty(true);
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn small icon"
                        onClick={() => {
                          setConsts(consts.filter((_, k) => k !== i));
                          setDirty(true);
                        }}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn small"
              style={{ marginTop: 10 }}
              onClick={() => {
                setConsts([...consts, { name: `K${consts.length + 1}`, value: 1, unit: '' }]);
                setDirty(true);
              }}
            >
              + Add constant
            </button>
          </div>
        )}
        <div className="modal-foot">
          <span className="muted grow" style={{ fontSize: 12 }}>
            {dirty ? 'Unapplied changes' : 'All changes applied'} · math channels are saved in the workspace and recomputed for every open session
          </span>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button className="btn primary" disabled={!dirty} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
