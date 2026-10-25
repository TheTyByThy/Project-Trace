// Global overlay hosts: context menus, channel picker popovers, text prompts, channel properties.
// (Electron doesn't support window.prompt, so prompts are rendered in-app.)

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { groupByCategory } from '../core/channelMeta';
import { CATEGORICAL, WHITE } from '../core/colors';
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
  color: { x: number; y: number; value?: string; title?: string; allowAuto?: boolean; onPick: (c: string | undefined) => void } | null;
}

export const useOverlay = create<OverlayState>(() => ({ menu: null, picker: null, prompt: null, channelProps: null, color: null }));

// ---------------------------------------------------------------------------------------------
// Dismissing popovers: every menu, picker and dropdown closes on a click anywhere outside it and on Esc.
// (Not on window blur: the system colour picker behind "Custom…" takes focus while you choose.)
// ---------------------------------------------------------------------------------------------

/** The last outside left-press that closed a popover (so pressing its opener again doesn't reopen it). */
let lastDismiss = { t: 0, x: 0, y: 0 };
let openPopovers = 0;

/** True if this click is the same press that just closed a popover (its opener being clicked again). */
export function justDismissed(e: { clientX: number; clientY: number }) {
  return performance.now() - lastDismiss.t < 400 && Math.abs(e.clientX - lastDismiss.x) < 6 && Math.abs(e.clientY - lastDismiss.y) < 6;
}

/**
 * Close a popover on a press outside `ref` or on Escape. Presses are
 * caught in the capture phase, so dialogs that stop event propagation can't swallow them. While any
 * popover is open the macOS header stops being a window-drag area (see :root.popover-open in the CSS),
 * so pressing there closes it too.
 */
export function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    openPopovers++;
    document.documentElement.classList.add('popover-open');
    const onDown = (e: PointerEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      if (e.button === 0) lastDismiss = { t: performance.now(), x: e.clientX, y: e.clientY };
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    // Attach after the press that opened the popover has finished.
    const timer = setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      if (--openPopovers <= 0) {
        openPopovers = 0;
        document.documentElement.classList.remove('popover-open');
      }
    };
  }, [open, ref]);
}

/** Pop up a colour chooser (palette + custom picker + hex) at the mouse. */
export function openColorPicker(
  e: { clientX: number; clientY: number },
  value: string | undefined,
  onPick: (c: string | undefined) => void,
  opts: { title?: string; allowAuto?: boolean } = {},
) {
  if (justDismissed(e)) return;
  useOverlay.setState({ color: { x: e.clientX, y: e.clientY, value, onPick, ...opts } });
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Inline colour field: palette swatches, a custom colour picker and a hex input. */
export function ColorField({ value, onChange, allowAuto = false }: { value?: string; onChange: (c: string | undefined) => void; allowAuto?: boolean }) {
  const theme = useStore((s) => s.settings.theme);
  const [hex, setHex] = useState(value ?? '');
  useEffect(() => setHex(value ?? ''), [value]);
  return (
    <div className="color-field">
      <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
        {[WHITE[theme], ...CATEGORICAL[theme]].map((c) => (
          <span
            key={c}
            className="swatch big"
            style={{ background: c, outline: value?.toLowerCase() === c.toLowerCase() ? '2px solid var(--text)' : undefined }}
            onClick={() => onChange(c)}
            title={c}
          />
        ))}
        {allowAuto && (
          <button className={'btn small' + (!value ? ' active' : '')} onClick={() => onChange(undefined)}>
            Auto
          </button>
        )}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <label className="custom-color" title="Pick any colour">
          <input type="color" value={value && HEX_RE.test(value) ? value : '#3987e5'} onChange={(e) => onChange(e.target.value)} />
          <span>Custom…</span>
        </label>
        <input
          className="input mono"
          style={{ width: 96 }}
          placeholder="#rrggbb"
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            if (HEX_RE.test(e.target.value)) onChange(e.target.value);
          }}
        />
        {value && <span className="swatch big" style={{ background: value }} />}
      </div>
    </div>
  );
}

function ColorPickerHost() {
  const st = useOverlay((s) => s.color);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (st) setPos(clampToViewport(st.x, st.y, 300, 150));
  }, [st?.x, st?.y]);
  useDismiss(ref, !!st, () => useOverlay.setState({ color: null }));
  if (!st || !pos) return null;
  return (
    <div ref={ref} className="popover" style={{ ...pos, padding: 10, width: 300 }}>
      {st.title && <div className="section-title" style={{ padding: '0 0 6px' }}>{st.title}</div>}
      <ColorField
        value={st.value}
        allowAuto={st.allowAuto}
        onChange={(c) => {
          st.onPick(c);
          useOverlay.setState((s) => ({ color: s.color ? { ...s.color, value: c } : null }));
        }}
      />
    </div>
  );
}

export function openMenu(e: { clientX: number; clientY: number; button?: number }, items: MenuItem[]) {
  // A left-click on a menu's own button while it's open closes it (right-click opens a new menu).
  if (e.button !== 2 && justDismissed(e)) return;
  useOverlay.setState({ menu: { x: e.clientX, y: e.clientY, items } });
}

export function openChannelPicker(
  e: { clientX: number; clientY: number },
  onPick: (name: string) => void,
  extras?: { value: string; label: string }[],
  title?: string,
) {
  if (justDismissed(e)) return;
  useOverlay.setState({ picker: { x: e.clientX, y: e.clientY, onPick, extras, title } });
}

export function promptText(title: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => useOverlay.setState({ prompt: { title, value, resolve } }));
}

export function openChannelProps(name: string) {
  useOverlay.setState({ channelProps: name });
}

/** Give a channel a display name (empty = back to the logged name). */
export async function renameChannel(name: string) {
  const cur = activeWorkspace()?.channelProps[name]?.label ?? name;
  const next = await promptText(`Rename “${name}” (leave empty for the logged name)`, cur);
  if (next == null) return;
  const label = next.trim();
  setChannelProps(name, { label: label && label !== name ? label : undefined });
}

function clampToViewport(x: number, y: number, w: number, h: number) {
  return { left: Math.max(4, Math.min(x, window.innerWidth - w - 4)), top: Math.max(4, Math.min(y, window.innerHeight - h - 4)) };
}

function MenuHost() {
  const menu = useOverlay((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    const el = ref.current;
    if (menu && el) setPos(clampToViewport(menu.x, menu.y, el.offsetWidth, el.offsetHeight));
  }, [menu]);
  useDismiss(ref, !!menu, () => useOverlay.setState({ menu: null }));
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
  const props = useStore((s) => activeWorkspace(s)?.channelProps);
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
    const label = (n: string) => props?.[n]?.label || n;
    const ql = q.trim().toLowerCase();
    const list = [...seen.values()].filter(
      (c) => !ql || c.name.toLowerCase().includes(ql) || label(c.name).toLowerCase().includes(ql) || c.category.toLowerCase().includes(ql),
    );
    const byCat = new Map<string, { name: string; label: string; unit: string }[]>();
    for (const c of list) {
      const arr = byCat.get(c.category) ?? [];
      arr.push({ name: c.name, label: label(c.name), unit: c.unit });
      byCat.set(c.category, arr);
    }
    return groupByCategory(byCat);
  }, [sessions, q, props]);
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
                <span className="grow" title={it.label !== it.name ? `logged as ${it.name}` : undefined}>
                  {it.label}
                </span>
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
    if (picker) setPos(clampToViewport(picker.x, picker.y, 320, 440));
  }, [picker]);
  useDismiss(ref, !!picker, () => useOverlay.setState({ picker: null }));
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
  useStore((s) => activeWorkspace(s)?.channelProps);
  const label = extras?.find((e) => e.value === value)?.label ?? (value ? activeWorkspace()?.channelProps[value]?.label || value : value);
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
  const props = useStore((s) => (name ? activeWorkspace(s)?.channelProps[name] : undefined)) ?? {};
  if (!name) return null;
  const close = () => useOverlay.setState({ channelProps: null });
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className="modal" style={{ width: 400 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Channel properties — {props.label || name}</h2>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="field">
            Display name (shown everywhere instead of the logged name)
            <input
              className="input"
              key={name}
              defaultValue={props.label ?? ''}
              placeholder={name}
              onBlur={(e) => setChannelProps(name, { label: e.target.value.trim() && e.target.value.trim() !== name ? e.target.value.trim() : undefined })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <span className="muted" style={{ fontSize: 11 }}>
              Logged as <span className="mono">{name}</span> — graphs, math channels and saved layouts keep using that name.
            </span>
          </label>
          <div className="field">
            Colour (the reference lap uses it when showing channel colours)
            <ColorField value={props.color} allowAuto onChange={(c) => setChannelProps(name, { color: c })} />
          </div>
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
      <ColorPickerHost />
    </>
  );
}
