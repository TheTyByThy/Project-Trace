// Carry a channel rename (e.g. a math channel given a new name) through a workspace, so graphs, other
// components, channel properties and math expressions that used the old name keep working.

import { tokenize } from '../core/math/parse';
import type { MathChannelDef } from '../core/math/evaluate';
import type { ComponentConfig, Workspace } from './workspace';

/** old name → new name */
export type RenameMap = Map<string, string>;

const to = (map: RenameMap, n: string) => map.get(n) ?? n;
const toOpt = (map: RenameMap, n: string | undefined) => (n == null ? n : to(map, n));

function renameInComponent(c: ComponentConfig, map: RenameMap): ComponentConfig {
  switch (c.type) {
    case 'graph':
      return { ...c, panes: c.panes.map((p) => ({ ...p, channels: p.channels.map((n) => to(map, n)), hidden: p.hidden?.map((n) => to(map, n)) })) };
    case 'scatter':
      return { ...c, x: to(map, c.x), y: to(map, c.y), color: c.color === 'lap' ? c.color : to(map, c.color), gate: toOpt(map, c.gate) };
    case 'histogram':
    case 'trend':
    case 'fft':
      return { ...c, channel: to(map, c.channel) };
    case 'mixture':
      return { ...c, x: to(map, c.x), y: to(map, c.y), z: c.z ? to(map, c.z) : c.z };
    case 'trackmap':
      return { ...c, colorBy: c.colorBy === 'lap' || c.colorBy === 'delta' ? c.colorBy : to(map, c.colorBy) };
    case 'channels':
      return { ...c, channels: c.channels.map((n) => to(map, n)) };
    case 'gauges':
      return { ...c, gauges: c.gauges.map((g) => ({ ...g, channel: to(map, g.channel) })) };
    case 'bars':
      return { ...c, rows: c.rows.map((r) => ({ ...r, channel: to(map, r.channel) })) };
    case 'inputs':
      return c.channels ? { ...c, channels: Object.fromEntries(Object.entries(c.channels).map(([k, v]) => [k, v && to(map, v)])) } : c;
    default:
      return c;
  }
}

const BARE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/**
 * Rewrite channel references in a math expression: quoted names ('Old Name') and bare identifiers
 * (OldName, but not function calls). A new name that isn't a valid bare identifier is written quoted.
 */
export function renameInExpression(expr: string, map: RenameMap): string {
  let toks;
  try {
    toks = tokenize(expr);
  } catch {
    // Unparseable (being edited): only rewrite exact quoted names.
    let out = expr;
    for (const [a, b] of map) out = out.split(`'${a}'`).join(`'${b}'`).split(`"${a}"`).join(`"${b}"`);
    return out;
  }
  const edits: { start: number; end: number; text: string }[] = [];
  toks.forEach((t, i) => {
    if (t.t === 'str' && map.has(String(t.v))) {
      const q = expr[t.pos];
      edits.push({ start: t.pos, end: t.pos + String(t.v).length + 2, text: `${q}${map.get(String(t.v))}${q}` });
    } else if (t.t === 'id' && map.has(String(t.v))) {
      const nx = toks[i + 1];
      if (nx && nx.t === 'op' && nx.v === '(') return; // a function call, not a channel
      const nn = map.get(String(t.v))!;
      edits.push({ start: t.pos, end: t.pos + String(t.v).length, text: BARE.test(nn) ? nn : `'${nn}'` });
    }
  });
  let out = expr;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** The workspace with every reference to a renamed channel updated. */
export function renameChannelsInWorkspace(ws: Workspace, map: RenameMap, math: MathChannelDef[] = ws.math): Workspace {
  if (!map.size) return { ...ws, math };
  const channelProps = { ...ws.channelProps };
  for (const [a, b] of map)
    if (channelProps[a] && !channelProps[b]) {
      channelProps[b] = channelProps[a];
      delete channelProps[a];
    }
  return {
    ...ws,
    math: math.map((d) => ({ ...d, expr: renameInExpression(d.expr, map) })),
    channelProps,
    worksheets: ws.worksheets.map((sh) => ({
      ...sh,
      components: Object.fromEntries(Object.entries(sh.components).map(([id, c]) => [id, renameInComponent(c, map)])),
    })),
  };
}
