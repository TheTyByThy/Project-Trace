// Global overlay hosts: context menus, channel picker popovers, text prompts, channel properties.
// (Electron doesn't support window.prompt, so prompts are rendered in-app.)

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { CATEGORIES } from '../core/channelMeta';
import { CATEGORICAL } from '../core/colors';
import { activeWorkspace, setChannelProps, useStore } from '../state/store';

export interface MenuItem {
  label?: string;
  onClick?: () => void;
  checked?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
  header?: string;
  swatches?: { color: string; onClick: () => void }[];
}

interface OverlayState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  picker: { x: number; y: number; onPick: (name: string) => void; extras?: { value: string; label: string }[]; title?: string } | null;
  prompt: { title: string; value: string; resolve: (v: string | null) => void } | null;
  channelProps: string | null;
}

export const useOverlay = create<OverlayState>(() => ({ menu: null, picker: null, prompt: null, channelProps: null }));

export function openMenu(e: { clientX: number; clientY: number }, items: MenuItem[]) {
  useOverlay.setState({ menu: { x: e.clientX, y: e.clientY, items } });
}

export function openChannelPicker(
  e: { clientX: number; clientY: number },
  onPick: (name: string) => void,
  extras?: { value: string; label: string }[],
  title?: string,
) {
  useOverlay.setState({ picker: { x: e.clientX, y: e.clientY, onPick, extras, title } });
}

export function promptText(title: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => useOverlay.setState({ prompt: { title, value, resolve } }));
}

export function openChannelProps(name: string) {
  useOverlay.setState({ channelProps: name });
}

function clampToViewport(x: number, y: number, w: number, h: number) {
  return { left: Math.max(4, Math.min(x, window.innerWidth - w - 4)), top: Math.max(4, Math.min(y, window.innerHeight - h - 4)) };
}

function MenuHost() {
  const menu = useOverlay((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!menu) return;
    const el = ref.current;
    if (el) setPos(clampToViewport(menu.x, menu.y, el.offsetWidth, el.offsetHeight));
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) useOverlay.setState({ menu: null });
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && useOverlay.setState({ menu: null });
    setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [menu]);
  if (!menu) return null;
  return (
    <div ref={ref} className="popover menu" style={{ left: pos.left || menu.x, top: pos.top || menu.y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) => {
        if (it.separator) return <div key={i} className="sep" />;
        if (it.header) return <div key={i} className="hdr">{it.header}</div>;
        if (it.swatches)
          return (
            <div key={i} className="row" style={{ padding: '4px 10px', gap: 6 }}>
              {it.swatches.map((s, j) => (
                <span
                  key={j}
                  className="swatch"
                  style={{ background: s.color, width: 16, height: 16, cursor: 'pointer' }}
                  onClick={() => {
                    s.onClick();
                    useOverlay.setState({ menu: null });
                  }}
                />
              ))}
            </div>
          );
        return (
          <div
            key={i}
            className={'mi' + (it.disabled ? ' disabled' : '')}
            onClick={() => {
              useOverlay.setState({ menu: null });
              it.onClick?.();
            }}
          >
            <span style={{ width: 14, textAlign: 'center', color: 'var(--accent)' }}>{it.checked ? '✓' : ''}</span>
            {it.label}
            {it.shortcut && <span className="k">{it.shortcut}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Searchable, grouped list of the channels available in the loaded sessions. */
export function ChannelList({
  onPick,
  extras,
  autoFocus = true,
  current,
}: {
  onPick: (name: string) => void;
  extras?: { value: string; label: string }[];
  autoFocus?: boolean;
  current?: string;
}) {
  const sessions = useStore((s) => s.sessions);
  useStore((s) => s.dataVersion);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const groups = useMemo(() => {
    const seen = new Map<string, { name: string; unit: string; category: string }>();
    for (const s of sessions)
      for (const n of s.channelOrder) {
        const c = s.channels.get(n);
        if (c && !seen.has(n)) seen.set(n, { name: n, unit: c.unit, category: c.category });
      }
    const ql = q.trim().toLowerCase();
    const list = [...seen.values()].filter((c) => !ql || c.name.toLowerCase().includes(ql) || c.category.toLowerCase().includes(ql));
    const out: { cat: string; items: { name: string; unit: string }[] }[] = [];
    for (const cat of CATEGORIES) {
      const items = list.filter((c) => c.category === cat);
      if (items.length) out.push({ cat, items });
    }
    return out;
  }, [sessions, q]);
  const extraItems = (extras ?? []).filter((e) => !q || e.label.toLowerCase().includes(q.toLowerCase()));
  const flat = [...extraItems.map((e) => e.value), ...groups.flatMap((g) => g.items.map((i) => i.name))];
  return (
    <div className="picker">
      <div style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
        <input
          className="input"
          autoFocus={autoFocus}
          placeholder={sessions.length ? 'Search channels…' : 'Open a session to list channels'}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHl(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setHl((h) => Math.min(flat.length - 1, h + 1));
            else if (e.key === 'ArrowUp') setHl((h) => Math.max(0, h - 1));
            else if (e.key === 'Enter' && flat[hl]) onPick(flat[hl]);
          }}
        />
      </div>
      <div className="list">
        {extraItems.length > 0 && (
          <>
            <div className="grp">Special</div>
            {extraItems.map((e) => (
              <div key={e.value} className={'opt' + (flat[hl] === e.value ? ' hl' : '')} onClick={() => onPick(e.value)}>
                {e.label}
              </div>
            ))}
          </>
        )}
        {groups.map((g) => (
          <div key={g.cat}>
            <div className="grp">{g.cat}</div>
            {g.items.map((it) => (
              <div
                key={it.name}
                className={'opt' + (flat[hl] === it.name ? ' hl' : '')}
                onClick={() => onPick(it.name)}
                style={current === it.name ? { color: 'var(--accent)' } : undefined}
              >
                <span className="grow">{it.name}</span>
                <span className="muted">{it.unit}</span>
              </div>
            ))}
          </div>
        ))}
        {!flat.length && <div className="muted" style={{ padding: 10 }}>No channels match.</div>}
      </div>
    </div>
  );
}

function PickerHost() {
  const picker = useOverlay((s) => s.picker);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!picker) return;
    setPos(clampToViewport(picker.x, picker.y, 320, 440));
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) useOverlay.setState({ picker: null });
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && useOverlay.setState({ picker: null });
    setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [picker]);
  if (!picker || !pos) return null;
  return (
    <div ref={ref} className="popover" style={pos}>
      {picker.title && <div className="section-title">{picker.title}</div>}
      <ChannelList
        extras={picker.extras}
        onPick={(n) => {
          useOverlay.setState({ picker: null });
          picker.onPick(n);
        }}
      />
    </div>
  );
}

/** Button that opens a channel picker — used throughout the inspector. */
export function ChannelPickerButton({
  value,
  onChange,
  extras,
  placeholder = 'Choose channel…',
}: {
  value: string;
  onChange: (v: string) => void;
  extras?: { value: string; label: string }[];
  placeholder?: string;
}) {
  const label = extras?.find((e) => e.value === value)?.label ?? value;
  return (
    <button className="picker-btn" onClick={(e) => openChannelPicker(e, onChange, extras)}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label || <span className="muted">{placeholder}</span>}</span>
      <span className="muted">▾</span>
    </button>
  );
}

function PromptHost() {
  const prompt = useOverlay((s) => s.prompt);
  const [v, setV] = useState('');
  useEffect(() => setV(prompt?.value ?? ''), [prompt]);
  if (!prompt) return null;
  const done = (val: string | null) => {
    prompt.resolve(val);
    useOverlay.setState({ prompt: null });
  };
  return (
    <div className="modal-back" onMouseDown={() => done(null)}>
      <div className="modal" style={{ width: 420 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{prompt.title}</h2>
        </div>
        <div className="modal-body">
          <input
            className="input"
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') done(v.trim() || null);
              if (e.key === 'Escape') done(null);
            }}
          />
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => done(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => done(v.trim() || null)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelPropsHost() {
  const name = useOverlay((s) => s.channelProps);
  const theme = useStore((s) => s.settings.theme);
  const props = useStore((s) => (name ? activeWorkspace(s)?.channelProps[name] : undefined)) ?? {};
  if (!name) return null;
  const close = () => useOverlay.setState({ channelProps: null });
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" style={{ width: 400 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Channel properties — {name}</h2>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">
            Colour
            <div className="row">
              {CATEGORICAL[theme].map((c) => (
                <span
                  key={c}
                  className="swatch"
                  style={{ background: c, width: 22, height: 22, cursor: 'pointer', outline: props.color === c ? '2px solid var(--text)' : undefined }}
                  onClick={() => setChannelProps(name, { color: c })}
                />
              ))}
              <input type="color" value={props.color ?? '#3987e5'} onChange={(e) => setChannelProps(name, { color: e.target.value })} />
              <button className="btn small" onClick={() => setChannelProps(name, { color: undefined })}>
                Auto
              </button>
            </div>
          </label>
          <div className="row">
            <label className="field grow">
              Fixed min (display units)
              <input className="input" defaultValue={props.min ?? ''} onBlur={(e) => setChannelProps(name, { min: num(e.target.value) })} />
            </label>
            <label className="field grow">
              Fixed max
              <input className="input" defaultValue={props.max ?? ''} onBlur={(e) => setChannelProps(name, { max: num(e.target.value) })} />
            </label>
          </div>
          <div className="row">
            <label className="field grow">
              Decimal places
              <input className="input" defaultValue={props.dps ?? ''} onBlur={(e) => setChannelProps(name, { dps: num(e.target.value) })} />
            </label>
            <label className="field grow">
              Display unit override
              <input className="input" placeholder="e.g. mph, bar, F" defaultValue={props.unit ?? ''} onBlur={(e) => setChannelProps(name, { unit: e.target.value.trim() || undefined })} />
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <button
            className="btn"
            onClick={() => {
              setChannelProps(name, null);
              close();
            }}
          >
            Reset all
          </button>
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function OverlayHosts() {
  return (
    <>
      <MenuHost />
      <PickerHost />
      <PromptHost />
      <ChannelPropsHost />
    </>
  );
}
