// Pure operations on a worksheet's split-tree layout.

import { uid, type LayoutNode } from './workspace';

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

export const leaf = (componentId: string): LayoutNode => ({ kind: 'leaf', id: uid('l'), componentId });
export const split = (dir: 'row' | 'col', children: LayoutNode[], sizes?: number[]): LayoutNode => ({
  kind: 'split',
  id: uid('s'),
  dir,
  children,
  sizes: sizes ?? children.map(() => 1 / children.length),
});

export function findLeafByComponent(node: LayoutNode | null, componentId: string): LayoutNode | null {
  if (!node) return null;
  if (node.kind === 'leaf') return node.componentId === componentId ? node : null;
  for (const c of node.children) {
    const f = findLeafByComponent(c, componentId);
    if (f) return f;
  }
  return null;
}

export function allComponentIds(node: LayoutNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.kind === 'leaf') out.push(node.componentId);
  else node.children.forEach((c) => allComponentIds(c, out));
  return out;
}

/** Remove the leaf holding componentId, collapsing single-child splits. */
export function removeComponent(node: LayoutNode | null, componentId: string): LayoutNode | null {
  if (!node) return null;
  if (node.kind === 'leaf') return node.componentId === componentId ? null : node;
  const kids: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const r = removeComponent(c, componentId);
    if (r) {
      kids.push(r);
      sizes.push(node.sizes[i]);
    }
  });
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...node, children: kids, sizes: sizes.map((s) => s / total) };
}

/** Insert a new component next to the leaf holding targetId (or at root if not found). */
export function insertComponent(node: LayoutNode | null, targetId: string | null, newId: string, zone: DropZone): LayoutNode {
  const fresh = leaf(newId);
  if (!node) return fresh;
  if (!targetId || !findLeafByComponent(node, targetId)) {
    // Add to the root: split right of everything.
    const dir = zone === 'top' || zone === 'bottom' ? 'col' : 'row';
    const before = zone === 'left' || zone === 'top';
    if (node.kind === 'split' && node.dir === dir) {
      const n = node.children.length + 1;
      const children = before ? [fresh, ...node.children] : [...node.children, fresh];
      const sizes = before ? [1 / n, ...node.sizes.map((s) => (s * (n - 1)) / n)] : [...node.sizes.map((s) => (s * (n - 1)) / n), 1 / n];
      return { ...node, children, sizes };
    }
    return split(dir, before ? [fresh, node] : [node, fresh], before ? [0.35, 0.65] : [0.65, 0.35]);
  }
  return insertAt(node, targetId, fresh, zone);
}

function insertAt(node: LayoutNode, targetId: string, fresh: LayoutNode, zone: DropZone): LayoutNode {
  if (node.kind === 'leaf') {
    if (node.componentId !== targetId) return node;
    if (zone === 'center') return { ...node, componentId: (fresh as { componentId: string }).componentId };
    const dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
    const before = zone === 'left' || zone === 'top';
    return split(dir, before ? [fresh, node] : [node, fresh]);
  }
  // If the target is a direct child and the split direction matches, insert as a sibling.
  const dir = zone === 'left' || zone === 'right' ? 'row' : 'col';
  const idx = node.children.findIndex((c) => c.kind === 'leaf' && c.componentId === targetId);
  if (idx >= 0 && zone !== 'center' && node.dir === dir) {
    const before = zone === 'left' || zone === 'top';
    const at = before ? idx : idx + 1;
    const half = node.sizes[idx] / 2;
    const sizes = node.sizes.slice();
    sizes[idx] = half;
    sizes.splice(at, 0, half);
    const children = node.children.slice();
    children.splice(at, 0, fresh);
    return { ...node, children, sizes };
  }
  return { ...node, children: node.children.map((c) => insertAt(c, targetId, fresh, zone)) };
}

/** Move an existing component to a drop zone of another component (swap on center). */
export function moveComponent(node: LayoutNode | null, srcId: string, targetId: string, zone: DropZone): LayoutNode | null {
  if (!node || srcId === targetId) return node;
  if (zone === 'center') return swapComponents(node, srcId, targetId);
  const without = removeComponent(node, srcId);
  return insertComponent(without, targetId, srcId, zone);
}

function swapComponents(node: LayoutNode, a: string, b: string): LayoutNode {
  if (node.kind === 'leaf') {
    if (node.componentId === a) return { ...node, componentId: b };
    if (node.componentId === b) return { ...node, componentId: a };
    return node;
  }
  return { ...node, children: node.children.map((c) => swapComponents(c, a, b)) };
}

export function setSizes(node: LayoutNode | null, splitId: string, sizes: number[]): LayoutNode | null {
  if (!node || node.kind === 'leaf') return node;
  if (node.id === splitId) return { ...node, sizes };
  return { ...node, children: node.children.map((c) => setSizes(c, splitId, sizes)!) };
}

/** Deep clone with fresh ids (used when duplicating worksheets). */
export function cloneLayout(node: LayoutNode | null, idMap: Record<string, string>): LayoutNode | null {
  if (!node) return null;
  if (node.kind === 'leaf') return { kind: 'leaf', id: uid('l'), componentId: idMap[node.componentId] ?? node.componentId };
  return { ...node, id: uid('s'), children: node.children.map((c) => cloneLayout(c, idMap)!) };
}
