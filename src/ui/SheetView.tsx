// Worksheet: a resizable split-tree of component frames. Drag a frame's header onto another frame
// to dock it (edges split, centre swaps). Drag the gaps between frames to resize.

import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { COMPONENT_CATALOG } from '../state/components';
import type { DropZone } from '../state/layout';
import { activeSheet, addComponent, moveComponentTo, openProperties, removeComponentById, setSplitSizes, useStore } from '../state/store';
import type { ComponentConfig, LayoutNode, Worksheet } from '../state/workspace';
import { defaultTitle, VIEWS } from '../charts/registry';
import { keyHint } from '../shortcuts';
import { openMenu, useOverlay, type MenuItem } from './overlays';

class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    useStore.setState((s) => ({ errors: [...s.errors, `${this.props.label}: ${error.message}`] }));
    console.error(error);
  }
  render() {
    if (this.state.error)
      return (
        <div className="empty-state">
          <b>This component hit an error</b>
          <div style={{ marginTop: 6 }}>{this.state.error.message}</div>
          <button className="btn small" style={{ marginTop: 8 }} onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      );
    return this.props.children;
  }
}

function zoneFor(e: React.DragEvent, el: HTMLElement): DropZone {
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  const d = Math.min(x, 1 - x, y, 1 - y);
  if (d > 0.25) return 'center';
  if (d === x) return 'left';
  if (d === 1 - x) return 'right';
  if (d === y) return 'top';
  return 'bottom';
}

const ZONE_STYLE: Record<DropZone, React.CSSProperties> = {
  left: { left: 4, top: 4, bottom: 4, width: '45%' },
  right: { right: 4, top: 4, bottom: 4, width: '45%' },
  top: { left: 4, right: 4, top: 4, height: '45%' },
  bottom: { left: 4, right: 4, bottom: 4, height: '45%' },
  center: { left: '15%', right: '15%', top: '15%', bottom: '15%' },
};

function addMenu(e: React.MouseEvent, targetId: string | null) {
  openMenu(e, [
    { header: targetId ? 'Add beside this component' : 'Add component' },
    ...COMPONENT_CATALOG.map((it) => ({
      label: `${it.icon}  ${it.label}`,
      onClick: () => addComponent(it.type, targetId, 'right'),
    })),
  ]);
}

function ComponentFrame({ config, maximized, onMaximize }: { config: ComponentConfig; maximized: boolean; onMaximize: () => void }) {
  const active = useStore((s) => s.activeComponentId === config.id);
  const [zone, setZone] = useState<DropZone | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const View = VIEWS[config.type];
  const meta = COMPONENT_CATALOG.find((m) => m.type === config.type);
  // Items every component offers on right-click (appended to the component's own short menu).
  const frameItems = (): MenuItem[] => [
    { label: 'Properties…', shortcut: keyHint('open-properties'), onClick: () => openProperties(config.id) },
    { label: maximized ? 'Restore' : 'Maximise', shortcut: keyHint('maximise') ?? 'double-click header', onClick: onMaximize },
    { label: 'Remove component', onClick: () => removeComponentById(config.id) },
  ];
  return (
    <div
      ref={ref}
      className={'frame' + (active ? ' active' : '')}
      onMouseDownCapture={() => !active && useStore.setState({ activeComponentId: config.id })}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-pt-component')) return;
        e.preventDefault();
        setZone(zoneFor(e, ref.current!));
      }}
      onDragLeave={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setZone(null);
      }}
      onDrop={(e) => {
        const src = e.dataTransfer.getData('application/x-pt-component');
        const z = zone;
        setZone(null);
        if (src && z && src !== config.id) {
          e.preventDefault();
          moveComponentTo(src, config.id, z);
        }
      }}
    >
      <div
        className="frame-head"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-pt-component', config.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDoubleClick={onMaximize}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu(e, frameItems());
        }}
      >
        <span className="muted" style={{ fontSize: 12 }}>
          {meta?.icon}
        </span>
        <span className="title">{config.title || defaultTitle(config)}</span>
        <button className="btn icon ghost" title="Properties" onClick={() => openProperties(config.id)}>
          ⚙
        </button>
        <button className="btn icon ghost" title="Add component beside" onClick={(e) => addMenu(e, config.id)}>
          ＋
        </button>
        <button className="btn icon ghost" title={maximized ? 'Restore' : 'Maximise'} onClick={onMaximize}>
          {maximized ? '❐' : '□'}
        </button>
        <button className="btn icon ghost" title="Remove" onClick={() => removeComponentById(config.id)}>
          ✕
        </button>
      </div>
      <div
        className="frame-body"
        onContextMenu={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest('input, textarea, select')) return;
          e.preventDefault();
          // If the component opened its own menu for this click, append the common items to it.
          const m = useOverlay.getState().menu;
          if (m && m.x === e.clientX && m.y === e.clientY) useOverlay.setState({ menu: { ...m, items: [...m.items, { separator: true }, ...frameItems()] } });
          else openMenu(e, frameItems());
        }}
      >
        <ErrorBoundary label={config.type}>{View ? <View config={config} /> : null}</ErrorBoundary>
      </div>
      {zone && (
        <div className="drop-overlay">
          <div className="zone" style={ZONE_STYLE[zone]} />
        </div>
      )}
    </div>
  );
}

/** Distance (px) within which a divider snaps to line up with another divider. */
const SNAP_PX = 10;

function SplitView({ node, sheet, maximized, setMax }: { node: Extract<LayoutNode, { kind: 'split' }>; sheet: Worksheet; maximized: string | null; setMax: (id: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<number[] | null>(null);
  const sizes = live ?? node.sizes;
  const [snapped, setSnapped] = useState<number | null>(null);
  const startDrag = (i: number, e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current!;
    const handle = e.currentTarget as HTMLElement;
    const row = node.dir === 'row';
    const r = el.getBoundingClientRect();
    const total = row ? r.width : r.height;
    const start = row ? e.clientX : e.clientY;
    const base = node.sizes.slice();
    const sum = base.reduce((a, b) => a + b, 0) || 1;
    // Space shared by the children (the handles themselves don't grow).
    const handlePx = row ? handle.offsetWidth : handle.offsetHeight;
    const avail = Math.max(1, total - handlePx * (node.children.length - 1));
    const centre = (h: Element) => {
      const hr = h.getBoundingClientRect();
      return row ? hr.left + hr.width / 2 : hr.top + hr.height / 2;
    };
    const h0 = centre(handle);
    // Snap targets: dividers running the same way elsewhere on the sheet (e.g. the other column of a
    // 2×2 grid), but not ones inside this split, which move with it.
    const targets = [...document.querySelectorAll(`.split-handle[data-dir="${node.dir}"]`)].filter((h) => !el.contains(h)).map(centre);
    let latest = base;
    const move = (ev: PointerEvent) => {
      let px = (row ? ev.clientX : ev.clientY) - start;
      let snap = false;
      if (!ev.altKey) {
        const nearest = targets.reduce((best, t) => (Math.abs(t - (h0 + px)) < Math.abs(best - (h0 + px)) ? t : best), Infinity);
        if (Math.abs(nearest - (h0 + px)) <= SNAP_PX) {
          px = nearest - h0;
          snap = true;
        }
      }
      setSnapped(snap ? i : null);
      const d = (px / avail) * sum;
      const a = Math.max(0.06 * sum, base[i] + d);
      const b = Math.max(0.06 * sum, base[i] + base[i + 1] - a);
      latest = base.slice();
      latest[i] = a;
      latest[i + 1] = b;
      setLive(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSplitSizes(node.id, latest);
      setLive(null);
      setSnapped(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div ref={ref} className={`split ${node.dir === "row" ? "sp-row" : "sp-col"}`}>
      {node.children.map((c, i) => (
        <SplitChild key={c.id} grow={sizes[i]}>
          <NodeView node={c} sheet={sheet} maximized={maximized} setMax={setMax} />
          {i < node.children.length - 1 && (
            <div
              className={'split-handle' + (live ? ' dragging' : '') + (live && snapped === i ? ' snapped' : '')}
              data-dir={node.dir}
              title="Drag to resize · snaps to line up with other dividers (hold Alt/⌥ to move freely)"
              onPointerDown={(e) => startDrag(i, e)}
            />
          )}
        </SplitChild>
      ))}
    </div>
  );
}

function SplitChild({ grow, children }: { grow: number; children: ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  return (
    <>
      <div className="split-child" style={{ flex: `${grow} 1 0` }}>
        {arr[0]}
      </div>
      {arr[1]}
    </>
  );
}

function NodeView({ node, sheet, maximized, setMax }: { node: LayoutNode; sheet: Worksheet; maximized: string | null; setMax: (id: string | null) => void }) {
  if (node.kind === 'leaf') {
    const c = sheet.components[node.componentId];
    if (!c) return null;
    return <ComponentFrame config={c} maximized={false} onMaximize={() => setMax(c.id)} />;
  }
  return <SplitView node={node} sheet={sheet} maximized={maximized} setMax={setMax} />;
}

export function SheetView() {
  const sheet = useStore((s) => activeSheet(s));
  const [maximized, setMax] = useState<string | null>(null);
  // "Maximise / restore the selected component" shortcut.
  useEffect(() => {
    const h = () => setMax((m) => (m ? null : useStore.getState().activeComponentId));
    window.addEventListener('pt-maximise', h);
    return () => window.removeEventListener('pt-maximise', h);
  }, []);
  if (!sheet) return null;
  if (!sheet.layout)
    return (
      <div className="empty-state">
        <b>This worksheet is empty.</b>
        <div style={{ margin: '8px 0' }}>Add a component to get started.</div>
        <button className="btn primary" onClick={(e) => addMenu(e, null)}>
          + Add component
        </button>
      </div>
    );
  const maxC = maximized ? sheet.components[maximized] : undefined;
  if (maxC) return <ComponentFrame config={maxC} maximized onMaximize={() => setMax(null)} />;
  return <NodeView node={sheet.layout} sheet={sheet} maximized={maximized} setMax={setMax} />;
}

export { addMenu };
