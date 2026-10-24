// Math expression lexer + parser (precedence climbing). Syntax follows MoTeC i2 conventions:
//   'Ground Speed' [m/s] * 2         quoted channel names, optional [unit] conversion
//   choose('Brake Pos' > 5, 1, 0)    functions
//   a and b, a or b, not a, a && b   logic;  == != < <= > >= comparisons;  ^ power
//   cond ? a : b                     ternary shorthand
// Bare identifiers resolve to constants, then to channels whose names have no spaces (e.g. Gear).

export type Node =
  | { type: 'num'; value: number; pos: number }
  | { type: 'chan'; name: string; unit?: string; pos: number }
  | { type: 'ident'; name: string; unit?: string; pos: number }
  | { type: 'call'; name: string; args: Node[]; pos: number }
  | { type: 'unary'; op: '-' | '+' | '!'; arg: Node; pos: number }
  | { type: 'binary'; op: string; left: Node; right: Node; pos: number }
  | { type: 'ternary'; cond: Node; a: Node; b: Node; pos: number };

export class MathError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
  }
}

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'unit'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'eof'; pos: number };

const OPS = ['&&', '||', '==', '!=', '<>', '<=', '>=', '**', '+', '-', '*', '/', '%', '^', '<', '>', '!', '(', ')', ',', '?', ':', '='];

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Comments: // to end of line, or # to end of line
    if ((c === '/' && src[i + 1] === '/') || c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/);
      if (m) {
        out.push({ t: 'num', v: Number(m[0]), pos: start });
        i += m[0].length;
        continue;
      }
    }
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      let s = '';
      while (i < src.length && src[i] !== q) s += src[i++];
      if (src[i] !== q) throw new MathError('Unterminated channel name — missing closing quote', start);
      i++;
      out.push({ t: 'str', v: s, pos: start });
      continue;
    }
    if (c === '[') {
      i++;
      let s = '';
      while (i < src.length && src[i] !== ']') s += src[i++];
      if (src[i] !== ']') throw new MathError('Missing closing ] for unit', start);
      i++;
      out.push({ t: 'unit', v: s.trim(), pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*/)!;
      out.push({ t: 'id', v: m[0], pos: start });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: 'op', v: op, pos: start });
      i += op.length;
      continue;
    }
    throw new MathError(`Unexpected character '${c}'`, start);
  }
  out.push({ t: 'eof', pos: src.length });
  return out;
}

const BINARY_PREC: Record<string, number> = {
  '||': 1,
  or: 1,
  '&&': 2,
  and: 2,
  '==': 3,
  '!=': 3,
  '<>': 3,
  '=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
  '^': 8,
  '**': 8,
};
const RIGHT_ASSOC = new Set(['^', '**']);

export function parseExpression(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v: string) => {
    const t = peek();
    return (t.t === 'op' && t.v === v) || (t.t === 'id' && t.v.toLowerCase() === v);
  };
  const expect = (v: string) => {
    if (!isOp(v)) {
      const t = peek();
      throw new MathError(`Expected '${v}'${t.t === 'eof' ? ' before end of expression' : ''}`, t.pos);
    }
    next();
  };

  function binOp(): string | null {
    const t = peek();
    if (t.t === 'op' && t.v in BINARY_PREC) return t.v;
    if (t.t === 'id' && (t.v.toLowerCase() === 'and' || t.v.toLowerCase() === 'or')) return t.v.toLowerCase();
    return null;
  }

  function parseTernary(): Node {
    const cond = parseBinary(0);
    if (isOp('?')) {
      const pos = peek().pos;
      next();
      const a = parseTernary();
      expect(':');
      const b = parseTernary();
      return { type: 'ternary', cond, a, b, pos };
    }
    return cond;
  }

  function parseBinary(minPrec: number): Node {
    let left = parseUnary();
    for (;;) {
      const op = binOp();
      if (!op) break;
      const prec = BINARY_PREC[op];
      if (prec < minPrec) break;
      const pos = peek().pos;
      next();
      const right = parseBinary(RIGHT_ASSOC.has(op) ? prec : prec + 1);
      const norm = op === 'and' ? '&&' : op === 'or' ? '||' : op === '<>' ? '!=' : op === '=' ? '==' : op === '**' ? '^' : op;
      left = { type: 'binary', op: norm, left, right, pos };
    }
    return left;
  }

  function parseUnary(): Node {
    const t = peek();
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) {
      next();
      // Unary minus binds looser than ^ so that -x^2 == -(x^2).
      const arg = parseUnary();
      return { type: 'unary', op: t.v as '-' | '+' | '!', arg, pos: t.pos };
    }
    if (t.t === 'id' && t.v.toLowerCase() === 'not') {
      next();
      return { type: 'unary', op: '!', arg: parseUnary(), pos: t.pos };
    }
    return parsePostfix();
  }

  function parsePostfix(): Node {
    const node = parsePrimary();
    if (peek().t === 'unit') {
      const u = next() as { t: 'unit'; v: string; pos: number };
      if (node.type === 'chan' || node.type === 'ident') return { ...node, unit: u.v };
      throw new MathError('Unit conversion [..] can only follow a channel name', u.pos);
    }
    return node;
  }

  function parsePrimary(): Node {
    const t = next();
    switch (t.t) {
      case 'num':
        return { type: 'num', value: t.v, pos: t.pos };
      case 'str':
        return { type: 'chan', name: t.v, pos: t.pos };
      case 'id': {
        const lower = t.v.toLowerCase();
        if (lower === 'true') return { type: 'num', value: 1, pos: t.pos };
        if (lower === 'false') return { type: 'num', value: 0, pos: t.pos };
        if (isOp('(')) {
          next();
          const args: Node[] = [];
          if (!isOp(')')) {
            for (;;) {
              args.push(parseTernary());
              if (isOp(',')) {
                next();
                continue;
              }
              break;
            }
          }
          expect(')');
          return { type: 'call', name: lower, args, pos: t.pos };
        }
        return { type: 'ident', name: t.v, pos: t.pos };
      }
      case 'op':
        if (t.v === '(') {
          const e = parseTernary();
          expect(')');
          return e;
        }
        throw new MathError(`Unexpected '${t.v}'`, t.pos);
      case 'unit':
        throw new MathError('Unexpected unit [..]', t.pos);
      case 'eof':
        throw new MathError('Unexpected end of expression', t.pos);
    }
  }

  const root = parseTernary();
  const rest = peek();
  if (rest.t === 'id' || rest.t === 'str' || rest.t === 'num')
    throw new MathError(
      `Unexpected '${rest.v}' — missing an operator? Channel names containing spaces must be quoted, e.g. 'Ground Speed'`,
      rest.pos,
    );
  if (rest.t !== 'eof') throw new MathError('Unexpected input after end of expression', rest.pos);
  return root;
}

/** Collect channel/identifier references (used for dependency ordering and the editor). */
export function collectRefs(node: Node, out = new Set<string>()): Set<string> {
  switch (node.type) {
    case 'chan':
    case 'ident':
      out.add(node.name);
      break;
    case 'call':
      node.args.forEach((a) => collectRefs(a, out));
      break;
    case 'unary':
      collectRefs(node.arg, out);
      break;
    case 'binary':
      collectRefs(node.left, out);
      collectRefs(node.right, out);
      break;
    case 'ternary':
      collectRefs(node.cond, out);
      collectRefs(node.a, out);
      collectRefs(node.b, out);
      break;
  }
  return out;
}
