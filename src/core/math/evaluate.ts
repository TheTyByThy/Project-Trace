// Vectorised evaluation of math expressions over a session, plus dependency-ordered evaluation
// of a workspace's whole math channel list.

import { makeChannelInfo, resample } from '../channel';
import { lapDistAt } from '../session';
import type { ChannelInfo, Session } from '../types';
import { convertUnit } from '../units';
import { BUILTIN_CONSTANTS, FUNCTION_MAP, isVec, map1, map2, type FnContext, type V } from './functions';
import { collectRefs, MathError, parseExpression, type Node } from './parse';

export interface MathChannelDef {
  id: string;
  name: string;
  expr: string;
  unit: string;
  dps?: number;
  color?: string;
  description?: string;
  enabled: boolean;
}

export interface MathConstant {
  name: string;
  value: number;
  unit?: string;
}

function findChannel(s: Session, name: string): ChannelInfo | undefined {
  const exact = s.channels.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [k, v] of s.channels) if (k.toLowerCase() === lower) return v;
  return undefined;
}

/** Resolve identifiers once so we can determine the evaluation grid (highest referenced rate). */
function referencedChannels(node: Node, s: Session, consts: Record<string, number>): ChannelInfo[] {
  const out: ChannelInfo[] = [];
  const walk = (n: Node) => {
    switch (n.type) {
      case 'chan': {
        const c = findChannel(s, n.name);
        if (!c) throw new MathError(`Unknown channel '${n.name}'`, n.pos);
        out.push(c);
        break;
      }
      case 'ident': {
        const lower = n.name.toLowerCase();
        if (n.name in consts || lower in BUILTIN_CONSTANTS) break;
        const c = findChannel(s, n.name);
        if (!c) throw new MathError(`Unknown name '${n.name}' — put channel names in quotes, e.g. 'Ground Speed'`, n.pos);
        out.push(c);
        break;
      }
      case 'call': {
        const f = FUNCTION_MAP.get(n.name);
        if (!f) throw new MathError(`Unknown function '${n.name}()'`, n.pos);
        if (n.args.length < f.minArgs || n.args.length > f.maxArgs)
          throw new MathError(
            `${f.name}() takes ${f.minArgs === f.maxArgs ? f.minArgs : `${f.minArgs}–${f.maxArgs}`} argument(s); got ${n.args.length}`,
            n.pos,
          );
        n.args.forEach(walk);
        break;
      }
      case 'unary':
        walk(n.arg);
        break;
      case 'binary':
        walk(n.left);
        walk(n.right);
        break;
      case 'ternary':
        walk(n.cond);
        walk(n.a);
        walk(n.b);
        break;
    }
  };
  walk(node);
  return out;
}

export interface EvalResult {
  data: Float64Array;
  rate: number;
  t0: number;
}

export function evaluateExpression(src: string, s: Session, constList: MathConstant[] = []): EvalResult {
  const consts: Record<string, number> = {};
  for (const c of constList) consts[c.name] = c.value;
  const ast = parseExpression(src);
  const refs = referencedChannels(ast, s, consts);
  const rate = refs.length ? Math.max(...refs.map((c) => c.rate)) : Math.min(s.baseRate, 50);
  const t0 = 0;
  const n = Math.max(1, Math.floor(s.duration * rate + 1e-9) + 1);

  const cache = new Map<string, Float64Array>();
  let lapIdx: Int32Array | null = null;
  let lapDist: Float64Array | null = null;
  const ctx: FnContext = {
    n,
    rate,
    t0,
    lapStarts: s.laps.map((l) => l.start),
    lapNumbers: s.laps.map((l) => l.number),
    lapIndex() {
      if (!lapIdx) {
        lapIdx = new Int32Array(n).fill(-1);
        for (const lap of s.laps) {
          const a = Math.max(0, Math.ceil((lap.start - t0) * rate - 1e-9));
          const b = Math.min(n - 1, Math.ceil((lap.end - t0) * rate - 1e-9) - 1);
          for (let i = a; i <= b; i++) lapIdx[i] = lap.index;
        }
        if (s.laps.length) for (let i = 0; i < n; i++) if (lapIdx[i] < 0) lapIdx[i] = s.laps[s.laps.length - 1].index;
      }
      return lapIdx;
    },
    lapDistance() {
      if (!lapDist) {
        const li = ctx.lapIndex();
        lapDist = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const lap = s.laps[li[i]];
          lapDist[i] = lap ? lapDistAt(lap, t0 + i / rate) : 0;
        }
      }
      return lapDist;
    },
  };

  const channelVec = (c: ChannelInfo, unit: string | undefined, pos: number): Float64Array => {
    const key = c.name + '|' + (unit ?? '');
    let v = cache.get(key);
    if (v) return v;
    v = resample(c, rate, n, t0);
    if (unit) {
      const conv = convertUnit(c.unit, unit);
      if (!conv) throw new MathError(`Cannot convert '${c.name}' from [${c.unit || 'no unit'}] to [${unit}]`, pos);
      for (let i = 0; i < n; i++) v[i] = v[i] * conv.k + conv.b;
    }
    cache.set(key, v);
    return v;
  };

  const ev = (node: Node): V => {
    switch (node.type) {
      case 'num':
        return node.value;
      case 'chan':
        return channelVec(findChannel(s, node.name)!, node.unit, node.pos);
      case 'ident': {
        if (node.name in consts) return consts[node.name];
        const b = BUILTIN_CONSTANTS[node.name.toLowerCase()];
        if (b && !findChannel(s, node.name)) return b.value;
        return channelVec(findChannel(s, node.name)!, node.unit, node.pos);
      }
      case 'unary': {
        const a = ev(node.arg);
        if (node.op === '-') return map1(a, (x) => -x);
        if (node.op === '!') return map1(a, (x) => (Number.isFinite(x) && x !== 0 ? 0 : 1));
        return a;
      }
      case 'ternary': {
        const c = ev(node.cond);
        const a = ev(node.a);
        const b = ev(node.b);
        return FUNCTION_MAP.get('choose')!.impl([c, a, b], ctx);
      }
      case 'binary': {
        const a = ev(node.left);
        const b = ev(node.right);
        switch (node.op) {
          case '+':
            return map2(a, b, (x, y) => x + y);
          case '-':
            return map2(a, b, (x, y) => x - y);
          case '*':
            return map2(a, b, (x, y) => x * y);
          case '/':
            return map2(a, b, (x, y) => x / y);
          case '%':
            return map2(a, b, (x, y) => x % y);
          case '^':
            return map2(a, b, Math.pow);
          case '<':
            return map2(a, b, (x, y) => (x < y ? 1 : 0));
          case '<=':
            return map2(a, b, (x, y) => (x <= y ? 1 : 0));
          case '>':
            return map2(a, b, (x, y) => (x > y ? 1 : 0));
          case '>=':
            return map2(a, b, (x, y) => (x >= y ? 1 : 0));
          case '==':
            return map2(a, b, (x, y) => (x === y ? 1 : 0));
          case '!=':
            return map2(a, b, (x, y) => (x !== y ? 1 : 0));
          case '&&':
            return map2(a, b, (x, y) => (x && y && Number.isFinite(x) && Number.isFinite(y) ? 1 : 0));
          case '||':
            return map2(a, b, (x, y) => ((Number.isFinite(x) && x) || (Number.isFinite(y) && y) ? 1 : 0));
        }
        throw new MathError(`Unknown operator ${node.op}`, node.pos);
      }
      case 'call': {
        const f = FUNCTION_MAP.get(node.name)!;
        const args = node.args.map(ev);
        try {
          return f.impl(args, ctx);
        } catch (e) {
          throw new MathError(`${f.name}(): ${(e as Error).message}`, node.pos);
        }
      }
    }
  };

  const out = ev(ast);
  const data = isVec(out) ? out : new Float64Array(n).fill(out);
  return { data, rate, t0 };
}

export interface MathRunResult {
  errors: Record<string, string>;
  computed: string[];
}

/** (Re)compute every enabled math channel on a session, in dependency order. */
export function applyMathChannels(s: Session, defs: MathChannelDef[], constants: MathConstant[]): MathRunResult {
  // Drop previous math channels.
  for (const [name, ch] of [...s.channels]) if (ch.isMath) s.channels.delete(name);
  s.channelOrder = s.channelOrder.filter((n) => s.channels.has(n));

  const errors: Record<string, string> = {};
  const computed: string[] = [];
  const enabled = defs.filter((d) => d.enabled && d.name.trim());
  const byName = new Map(enabled.map((d) => [d.name, d]));
  const deps = new Map<string, string[]>();
  for (const d of enabled) {
    try {
      deps.set(
        d.name,
        [...collectRefs(parseExpression(d.expr))].filter((r) => byName.has(r) && r !== d.name),
      );
    } catch (e) {
      errors[d.name] = (e as Error).message;
    }
  }
  // Topological order (DFS), reporting cycles.
  const state = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const visit = (name: string, stack: string[]): boolean => {
    const st = state.get(name) ?? 0;
    if (st === 2) return true;
    if (st === 1) {
      errors[name] = `Circular reference: ${[...stack, name].join(' → ')}`;
      return false;
    }
    state.set(name, 1);
    for (const dep of deps.get(name) ?? []) if (!visit(dep, [...stack, name])) {
      errors[name] ??= `Depends on '${dep}', which has an error`;
      state.set(name, 2);
      return false;
    }
    state.set(name, 2);
    order.push(name);
    return true;
  };
  for (const d of enabled) if (!errors[d.name]) visit(d.name, []);

  for (const name of order) {
    if (errors[name]) continue;
    const d = byName.get(name)!;
    if (s.channels.has(name) && !s.channels.get(name)!.isMath) {
      errors[name] = `A logged channel is already called '${name}' — pick another name`;
      continue;
    }
    try {
      const r = evaluateExpression(d.expr, s, constants);
      const f32 = new Float32Array(r.data.length);
      for (let i = 0; i < f32.length; i++) f32[i] = r.data[i];
      const ch = makeChannelInfo(name, d.unit, r.rate, r.t0, f32, { isMath: true });
      s.channels.set(name, ch);
      s.channelOrder.push(name);
      computed.push(name);
    } catch (e) {
      errors[name] = (e as Error).message;
    }
  }
  return { errors, computed };
}
