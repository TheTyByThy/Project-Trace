// Math function library. Every function operates on whole sample vectors (Float64Array) or scalars.
// The `doc` entries feed the Math Channel editor's function reference.

export type V = number | Float64Array;

export interface FnContext {
  n: number;
  rate: number;
  t0: number;
  /** Lap index for each sample (-1 when outside any lap). */
  lapIndex(): Int32Array;
  /** Lap start time for each lap index. */
  lapStarts: number[];
  lapNumbers: number[];
  /** Lap distance at each sample. */
  lapDistance(): Float64Array;
}

export interface FnDef {
  name: string;
  sig: string;
  doc: string;
  category: 'Arithmetic' | 'Trigonometry' | 'Logic' | 'Signal' | 'Statistics' | 'Lap' | 'Validity';
  minArgs: number;
  maxArgs: number;
  impl: (args: V[], ctx: FnContext) => V;
}

export const isVec = (v: V): v is Float64Array => typeof v !== 'number';

export function toVec(v: V, n: number): Float64Array {
  if (isVec(v)) return v;
  const o = new Float64Array(n);
  o.fill(v);
  return o;
}

export function map1(a: V, f: (x: number) => number): V {
  if (!isVec(a)) return f(a);
  const o = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = f(a[i]);
  return o;
}

export function map2(a: V, b: V, f: (x: number, y: number) => number): V {
  if (!isVec(a) && !isVec(b)) return f(a, b);
  const n = isVec(a) ? a.length : (b as Float64Array).length;
  const o = new Float64Array(n);
  if (isVec(a) && isVec(b)) for (let i = 0; i < n; i++) o[i] = f(a[i], b[i]);
  else if (isVec(a)) for (let i = 0; i < n; i++) o[i] = f(a[i], b as number);
  else for (let i = 0; i < n; i++) o[i] = f(a as number, (b as Float64Array)[i]);
  return o;
}

function map3(a: V, b: V, c: V, f: (x: number, y: number, z: number) => number, n: number): V {
  if (!isVec(a) && !isVec(b) && !isVec(c)) return f(a, b, c);
  const A = toVec(a, n),
    B = toVec(b, n),
    C = toVec(c, n);
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) o[i] = f(A[i], B[i], C[i]);
  return o;
}

const scalar = (v: V, what: string): number => {
  if (isVec(v)) throw new Error(`${what} must be a constant number`);
  return v;
};

function movingAverage(x: Float64Array, win: number): Float64Array {
  const n = x.length;
  const half = Math.max(0, Math.floor(win / 2));
  if (half === 0) return x.slice();
  const pre = new Float64Array(n + 1);
  const cnt = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = x[i];
    const ok = Number.isFinite(v);
    pre[i + 1] = pre[i] + (ok ? v : 0);
    cnt[i + 1] = cnt[i] + (ok ? 1 : 0);
  }
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const c = cnt[b] - cnt[a];
    o[i] = c > 0 ? (pre[b] - pre[a]) / c : NaN;
  }
  return o;
}

function lowpass(x: Float64Array, hz: number, rate: number): Float64Array {
  const dt = 1 / rate;
  const rc = 1 / (2 * Math.PI * Math.max(1e-6, hz));
  const a = dt / (rc + dt);
  const n = x.length;
  const f = new Float64Array(n);
  let y = x[0];
  for (let i = 0; i < n; i++) {
    y = y + a * (x[i] - y);
    f[i] = y;
  }
  // Backward pass → zero phase lag.
  y = f[n - 1];
  for (let i = n - 1; i >= 0; i--) {
    y = y + a * (f[i] - y);
    f[i] = y;
  }
  return f;
}

function perLap(x: Float64Array, ctx: FnContext, reduce: (vals: Float64Array, a: number, b: number) => number): Float64Array {
  const li = ctx.lapIndex();
  const n = x.length;
  const o = new Float64Array(n);
  let a = 0;
  while (a < n) {
    let b = a;
    while (b < n && li[b] === li[a]) b++;
    const v = reduce(x, a, b);
    for (let i = a; i < b; i++) o[i] = v;
    a = b;
  }
  return o;
}

const reducers = {
  mean: (x: Float64Array, a: number, b: number) => {
    let s = 0,
      c = 0;
    for (let i = a; i < b; i++) if (Number.isFinite(x[i])) (s += x[i]), c++;
    return c ? s / c : NaN;
  },
  min: (x: Float64Array, a: number, b: number) => {
    let m = Infinity;
    for (let i = a; i < b; i++) if (x[i] < m) m = x[i];
    return Number.isFinite(m) ? m : NaN;
  },
  max: (x: Float64Array, a: number, b: number) => {
    let m = -Infinity;
    for (let i = a; i < b; i++) if (x[i] > m) m = x[i];
    return Number.isFinite(m) ? m : NaN;
  },
  sum: (x: Float64Array, a: number, b: number) => {
    let s = 0;
    for (let i = a; i < b; i++) if (Number.isFinite(x[i])) s += x[i];
    return s;
  },
  std: (x: Float64Array, a: number, b: number) => {
    let s = 0,
      s2 = 0,
      c = 0;
    for (let i = a; i < b; i++)
      if (Number.isFinite(x[i])) {
        s += x[i];
        s2 += x[i] * x[i];
        c++;
      }
    if (c < 2) return 0;
    const m = s / c;
    return Math.sqrt(Math.max(0, s2 / c - m * m));
  },
};

const statFn = (name: string, r: keyof typeof reducers, doc: string): FnDef => ({
  name,
  sig: `${name}(x)`,
  doc,
  category: 'Statistics',
  minArgs: 1,
  maxArgs: 1,
  impl: ([x], ctx) => (isVec(x) ? perLap(x, ctx, reducers[r]) : x),
});

const sessionFn = (name: string, r: keyof typeof reducers, doc: string): FnDef => ({
  name,
  sig: `${name}(x)`,
  doc,
  category: 'Statistics',
  minArgs: 1,
  maxArgs: 1,
  impl: ([x]) => (isVec(x) ? reducers[r](x, 0, x.length) : x),
});

const m1 = (name: string, f: (x: number) => number, doc: string, category: FnDef['category'] = 'Arithmetic'): FnDef => ({
  name,
  sig: `${name}(x)`,
  doc,
  category,
  minArgs: 1,
  maxArgs: 1,
  impl: ([x]) => map1(x, f),
});

const truthy = (x: number) => (Number.isFinite(x) && x !== 0 ? 1 : 0);

export const FUNCTIONS: FnDef[] = [
  // Arithmetic
  m1('abs', Math.abs, 'Absolute value.'),
  m1('sqrt', Math.sqrt, 'Square root.'),
  m1('sqr', (x) => x * x, 'Square (x²). MoTeC-compatible name.'),
  m1('exp', Math.exp, 'e raised to the power x.'),
  m1('ln', Math.log, 'Natural logarithm.'),
  m1('log', Math.log, 'Natural logarithm (alias of ln).'),
  m1('log10', Math.log10, 'Base-10 logarithm.'),
  m1('floor', Math.floor, 'Round down to an integer.'),
  m1('ceil', Math.ceil, 'Round up to an integer.'),
  m1('int', Math.trunc, 'Integer part (truncate toward zero).'),
  m1('frac', (x) => x - Math.trunc(x), 'Fractional part.'),
  m1('sgn', Math.sign, 'Sign: -1, 0 or 1. MoTeC-compatible name.'),
  m1('sign', Math.sign, 'Sign: -1, 0 or 1.'),
  {
    name: 'round',
    sig: 'round(x, dps?)',
    doc: 'Round to the nearest integer, or to dps decimal places.',
    category: 'Arithmetic',
    minArgs: 1,
    maxArgs: 2,
    impl: ([x, d]) => {
      const p = Math.pow(10, d == null ? 0 : scalar(d, 'dps'));
      return map1(x, (v) => Math.round(v * p) / p);
    },
  },
  {
    name: 'pow',
    sig: 'pow(x, y)',
    doc: 'x raised to the power y (same as x ^ y).',
    category: 'Arithmetic',
    minArgs: 2,
    maxArgs: 2,
    impl: ([a, b]) => map2(a, b, Math.pow),
  },
  {
    name: 'mod',
    sig: 'mod(x, y)',
    doc: 'Remainder of x / y (same as x % y).',
    category: 'Arithmetic',
    minArgs: 2,
    maxArgs: 2,
    impl: ([a, b]) => map2(a, b, (x, y) => x % y),
  },
  {
    name: 'hypot',
    sig: 'hypot(x, y)',
    doc: 'sqrt(x² + y²) — e.g. combined G from lateral and longitudinal.',
    category: 'Arithmetic',
    minArgs: 2,
    maxArgs: 2,
    impl: ([a, b]) => map2(a, b, Math.hypot),
  },
  {
    name: 'min',
    sig: 'min(a, b, ...)',
    doc: 'Smallest of the arguments, sample by sample.',
    category: 'Arithmetic',
    minArgs: 2,
    maxArgs: 16,
    impl: (args) => args.reduce((acc, v) => map2(acc, v, Math.min)),
  },
  {
    name: 'max',
    sig: 'max(a, b, ...)',
    doc: 'Largest of the arguments, sample by sample.',
    category: 'Arithmetic',
    minArgs: 2,
    maxArgs: 16,
    impl: (args) => args.reduce((acc, v) => map2(acc, v, Math.max)),
  },
  {
    name: 'clamp',
    sig: 'clamp(x, lo, hi)',
    doc: 'Limit x to the range [lo, hi].',
    category: 'Arithmetic',
    minArgs: 3,
    maxArgs: 3,
    impl: ([x, lo, hi], ctx) => map3(x, lo, hi, (v, a, b) => Math.min(b, Math.max(a, v)), ctx.n),
  },
  {
    name: 'limit',
    sig: 'limit(x, lo, hi)',
    doc: 'Alias of clamp.',
    category: 'Arithmetic',
    minArgs: 3,
    maxArgs: 3,
    impl: ([x, lo, hi], ctx) => map3(x, lo, hi, (v, a, b) => Math.min(b, Math.max(a, v)), ctx.n),
  },
  // Trig
  m1('sin', Math.sin, 'Sine (radians).', 'Trigonometry'),
  m1('cos', Math.cos, 'Cosine (radians).', 'Trigonometry'),
  m1('tan', Math.tan, 'Tangent (radians).', 'Trigonometry'),
  m1('asin', Math.asin, 'Arc sine → radians.', 'Trigonometry'),
  m1('acos', Math.acos, 'Arc cosine → radians.', 'Trigonometry'),
  m1('atan', Math.atan, 'Arc tangent → radians.', 'Trigonometry'),
  m1('rad', (x) => (x * Math.PI) / 180, 'Degrees → radians.', 'Trigonometry'),
  m1('deg', (x) => (x * 180) / Math.PI, 'Radians → degrees.', 'Trigonometry'),
  m1('deg2rad', (x) => (x * Math.PI) / 180, 'Degrees → radians.', 'Trigonometry'),
  m1('rad2deg', (x) => (x * 180) / Math.PI, 'Radians → degrees.', 'Trigonometry'),
  {
    name: 'atan2',
    sig: 'atan2(y, x)',
    doc: 'Angle of the vector (x, y) in radians.',
    category: 'Trigonometry',
    minArgs: 2,
    maxArgs: 2,
    impl: ([y, x]) => map2(y, x, Math.atan2),
  },
  // Logic
  {
    name: 'choose',
    sig: 'choose(cond, a, b)',
    doc: 'a where cond is true (non-zero), otherwise b. MoTeC-compatible.',
    category: 'Logic',
    minArgs: 3,
    maxArgs: 3,
    impl: ([c, a, b], ctx) => map3(c, a, b, (x, y, z) => (truthy(x) ? y : z), ctx.n),
  },
  {
    name: 'if',
    sig: 'if(cond, a, b)',
    doc: 'Alias of choose.',
    category: 'Logic',
    minArgs: 3,
    maxArgs: 3,
    impl: ([c, a, b], ctx) => map3(c, a, b, (x, y, z) => (truthy(x) ? y : z), ctx.n),
  },
  {
    name: 'between',
    sig: 'between(x, lo, hi)',
    doc: '1 where lo ≤ x ≤ hi, else 0.',
    category: 'Logic',
    minArgs: 3,
    maxArgs: 3,
    impl: ([x, lo, hi], ctx) => map3(x, lo, hi, (v, a, b) => (v >= a && v <= b ? 1 : 0), ctx.n),
  },
  // Validity
  {
    name: 'invalid',
    sig: 'invalid()',
    doc: 'An invalid (gap) value. Graphs leave gaps; statistics skip it.',
    category: 'Validity',
    minArgs: 0,
    maxArgs: 0,
    impl: () => NaN,
  },
  m1('isvalid', (x) => (Number.isFinite(x) ? 1 : 0), '1 where x is a valid number, else 0.', 'Validity'),
  {
    name: 'gate',
    sig: 'gate(x, cond)',
    doc: 'x where cond is true, otherwise invalid. Great for scatter plots and histograms of "only while braking" etc.',
    category: 'Validity',
    minArgs: 2,
    maxArgs: 2,
    impl: ([x, c]) => map2(x, c, (v, k) => (truthy(k) ? v : NaN)),
  },
  {
    name: 'hold',
    sig: 'hold(x)',
    doc: 'Replace invalid samples with the last valid value.',
    category: 'Validity',
    minArgs: 1,
    maxArgs: 1,
    impl: ([x]) => {
      if (!isVec(x)) return x;
      const o = x.slice();
      let last = NaN;
      for (let i = 0; i < o.length; i++) {
        if (Number.isFinite(o[i])) last = o[i];
        else o[i] = last;
      }
      return o;
    },
  },
  // Signal processing
  {
    name: 'derivative',
    sig: 'derivative(x)',
    doc: 'Rate of change per second (central difference). e.g. derivative(\'Damper Travel FL\') → damper velocity in mm/s.',
    category: 'Signal',
    minArgs: 1,
    maxArgs: 1,
    impl: ([x], ctx) => {
      if (!isVec(x)) return 0;
      const n = x.length;
      const o = new Float64Array(n);
      if (n < 2) return o;
      const r = ctx.rate;
      o[0] = (x[1] - x[0]) * r;
      o[n - 1] = (x[n - 1] - x[n - 2]) * r;
      for (let i = 1; i < n - 1; i++) o[i] = ((x[i + 1] - x[i - 1]) * r) / 2;
      return o;
    },
  },
  {
    name: 'integrate',
    sig: 'integrate(x, cond?)',
    doc: 'Running integral of x over time (x·dt). With cond, only accumulates while cond is true (MoTeC-compatible).',
    category: 'Signal',
    minArgs: 1,
    maxArgs: 2,
    impl: ([x, c], ctx) => {
      const X = toVec(x, ctx.n);
      const C = c == null ? null : toVec(c, ctx.n);
      const o = new Float64Array(ctx.n);
      const dt = 1 / ctx.rate;
      let acc = 0;
      for (let i = 0; i < ctx.n; i++) {
        if ((!C || truthy(C[i])) && Number.isFinite(X[i])) acc += X[i] * dt;
        o[i] = acc;
      }
      return o;
    },
  },
  {
    name: 'integrate_lap',
    sig: 'integrate_lap(x, cond?)',
    doc: 'Like integrate, but resets to zero at the start of every lap.',
    category: 'Signal',
    minArgs: 1,
    maxArgs: 2,
    impl: ([x, c], ctx) => {
      const X = toVec(x, ctx.n);
      const C = c == null ? null : toVec(c, ctx.n);
      const li = ctx.lapIndex();
      const o = new Float64Array(ctx.n);
      const dt = 1 / ctx.rate;
      let acc = 0;
      for (let i = 0; i < ctx.n; i++) {
        if (i > 0 && li[i] !== li[i - 1]) acc = 0;
        if ((!C || truthy(C[i])) && Number.isFinite(X[i])) acc += X[i] * dt;
        o[i] = acc;
      }
      return o;
    },
  },
  {
    name: 'smooth',
    sig: 'smooth(x, seconds)',
    doc: 'Centred moving average over a window of the given length in seconds.',
    category: 'Signal',
    minArgs: 2,
    maxArgs: 2,
    impl: ([x, s], ctx) => (isVec(x) ? movingAverage(x, Math.round(scalar(s, 'window') * ctx.rate)) : x),
  },
  {
    name: 'lowpass',
    sig: 'lowpass(x, hz)',
    doc: 'Zero-phase first-order low-pass filter with the given cut-off frequency.',
    category: 'Signal',
    minArgs: 2,
    maxArgs: 2,
    impl: ([x, f], ctx) => (isVec(x) ? lowpass(x, scalar(f, 'cut-off'), ctx.rate) : x),
  },
  {
    name: 'highpass',
    sig: 'highpass(x, hz)',
    doc: 'x minus its low-pass — keeps content above the cut-off frequency.',
    category: 'Signal',
    minArgs: 2,
    maxArgs: 2,
    impl: ([x, f], ctx) => {
      if (!isVec(x)) return 0;
      const lp = lowpass(x, scalar(f, 'cut-off'), ctx.rate);
      const o = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) o[i] = x[i] - lp[i];
      return o;
    },
  },
  {
    name: 'shift',
    sig: 'shift(x, seconds)',
    doc: 'Delay x by the given time (negative values advance it).',
    category: 'Signal',
    minArgs: 2,
    maxArgs: 2,
    impl: ([x, s], ctx) => {
      if (!isVec(x)) return x;
      const k = Math.round(scalar(s, 'shift') * ctx.rate);
      const n = x.length;
      const o = new Float64Array(n);
      for (let i = 0; i < n; i++) o[i] = x[Math.min(n - 1, Math.max(0, i - k))];
      return o;
    },
  },
  {
    name: 'delta',
    sig: 'delta(x)',
    doc: 'Change from the previous sample (x[i] − x[i−1]).',
    category: 'Signal',
    minArgs: 1,
    maxArgs: 1,
    impl: ([x]) => {
      if (!isVec(x)) return 0;
      const o = new Float64Array(x.length);
      for (let i = 1; i < x.length; i++) o[i] = x[i] - x[i - 1];
      return o;
    },
  },
  {
    name: 'prev',
    sig: 'prev(x)',
    doc: 'Value at the previous sample.',
    category: 'Signal',
    minArgs: 1,
    maxArgs: 1,
    impl: ([x]) => {
      if (!isVec(x)) return x;
      const o = new Float64Array(x.length);
      o[0] = x[0];
      for (let i = 1; i < x.length; i++) o[i] = x[i - 1];
      return o;
    },
  },
  // Statistics
  statFn('stat_mean', 'mean', 'Mean of x over each lap (constant within the lap). MoTeC-compatible.'),
  statFn('stat_min', 'min', 'Minimum of x over each lap.'),
  statFn('stat_max', 'max', 'Maximum of x over each lap.'),
  statFn('stat_std', 'std', 'Standard deviation of x over each lap.'),
  statFn('stat_sum', 'sum', 'Sum of x over each lap.'),
  sessionFn('session_mean', 'mean', 'Mean of x over the whole session (a single number).'),
  sessionFn('session_min', 'min', 'Minimum of x over the whole session.'),
  sessionFn('session_max', 'max', 'Maximum of x over the whole session.'),
  // Lap
  {
    name: 'time',
    sig: 'time()',
    doc: 'Session time in seconds.',
    category: 'Lap',
    minArgs: 0,
    maxArgs: 0,
    impl: (_a, ctx) => {
      const o = new Float64Array(ctx.n);
      for (let i = 0; i < ctx.n; i++) o[i] = ctx.t0 + i / ctx.rate;
      return o;
    },
  },
  {
    name: 'lap_time',
    sig: 'lap_time()',
    doc: 'Time since the start of the current lap, in seconds.',
    category: 'Lap',
    minArgs: 0,
    maxArgs: 0,
    impl: (_a, ctx) => {
      const li = ctx.lapIndex();
      const o = new Float64Array(ctx.n);
      for (let i = 0; i < ctx.n; i++) o[i] = ctx.t0 + i / ctx.rate - (li[i] >= 0 ? ctx.lapStarts[li[i]] : 0);
      return o;
    },
  },
  {
    name: 'lap_number',
    sig: 'lap_number()',
    doc: 'Current lap number (1 = out lap, MoTeC convention).',
    category: 'Lap',
    minArgs: 0,
    maxArgs: 0,
    impl: (_a, ctx) => {
      const li = ctx.lapIndex();
      const o = new Float64Array(ctx.n);
      for (let i = 0; i < ctx.n; i++) o[i] = li[i] >= 0 ? ctx.lapNumbers[li[i]] : 0;
      return o;
    },
  },
  {
    name: 'lap_distance',
    sig: 'lap_distance()',
    doc: 'Distance from the start/finish line in metres.',
    category: 'Lap',
    minArgs: 0,
    maxArgs: 0,
    impl: (_a, ctx) => ctx.lapDistance().slice(),
  },
];

export const FUNCTION_MAP = new Map(FUNCTIONS.map((f) => [f.name, f]));

export const BUILTIN_CONSTANTS: Record<string, { value: number; doc: string }> = {
  pi: { value: Math.PI, doc: 'π = 3.14159…' },
  e: { value: Math.E, doc: "Euler's number 2.71828…" },
  g: { value: 9.80665, doc: 'Standard gravity, m/s²' },
};
