// Formatting helpers: lap times, axis labels, values, track/car names, in-game clock.

export function formatLapTime(s: number | null | undefined, dps = 3): string {
  if (s == null || !Number.isFinite(s)) return '—';
  const neg = s < 0;
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  let sec = rest.toFixed(dps);
  if (Number(sec) >= 60) return (neg ? '-' : '') + formatLapTime(Math.round(s), dps);
  if (m > 0 && rest < 10) sec = '0' + sec;
  return (neg ? '-' : '') + (m > 0 ? `${m}:${sec}` : sec);
}

export function formatDelta(s: number | null | undefined, dps = 3): string {
  if (s == null || !Number.isFinite(s)) return '—';
  return (s >= 0 ? '+' : '−') + Math.abs(s).toFixed(dps);
}

export function formatDuration(s: number): string {
  if (!Number.isFinite(s)) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(sec).padStart(2, '0')}s`;
}

export function formatValue(v: number | null | undefined, dps = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return v.toExponential(2);
  return v.toFixed(dps);
}

/** Pick sensible decimal places for a channel from its range. */
export function autoDps(min: number, max: number, discrete = false): number {
  if (discrete) return 0;
  const span = Math.max(Math.abs(min), Math.abs(max), max - min);
  if (!Number.isFinite(span) || span === 0) return 2;
  if (span >= 500) return 0;
  if (span >= 50) return 1;
  if (span >= 1) return 2;
  return 3;
}

export function formatAxisTime(s: number, step: number): string {
  const neg = s < 0;
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  const sec = a - m * 60;
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const secStr = sec.toFixed(d);
  const body = m > 0 ? `${m}:${(sec < 10 ? '0' : '') + secStr}` : secStr;
  return (neg ? '-' : '') + body;
}

export function formatAxisDistance(m: number, step: number, unit: 'm' | 'km' | 'mi' = 'm'): string {
  if (unit === 'km') return (m / 1000).toFixed(step >= 1000 ? 0 : step >= 100 ? 1 : 2);
  if (unit === 'mi') return (m / 1609.344).toFixed(step >= 1609 ? 0 : 2);
  return m.toFixed(step >= 1 ? 0 : 1);
}

const ACRONYMS = new Set(['f1', 'f2', 'f3', 'f4', 'gp', 'gt', 'gt2', 'gt3', 'gt4', 'gte', 'lmp', 'lmp1', 'lmp2', 'lmh', 'lmdh', 'csp', 'vrc', 'rss', 'ks', 'dtm', 'wec', 'imsa', 'cota', 'usa', 'uk', 'll', 'fa', 'ac', 'acc', 'tcr', 'rs', 'gtr', 'ii', 'iii', 'iv', 'srf', 'urd', 'amg', 'bmw', 'f1t', 'lms', 'nsx']);

function titleWords(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** "singapore_2020-layout_f1_2026" → { track: "Singapore 2020", layout: "F1 2026" } */
export function prettyTrack(raw: string): { track: string; layout: string; full: string } {
  if (!raw) return { track: 'Unknown track', layout: '', full: 'Unknown track' };
  const dash = raw.indexOf('-');
  let t = dash >= 0 ? raw.slice(0, dash) : raw;
  let l = dash >= 0 ? raw.slice(dash + 1) : '';
  const stripPrefix = (s: string) => {
    const m = s.match(/^([a-z0-9]{2,3})_(.+)$/i);
    return m && m[2].length >= 3 ? m[2] : s;
  };
  t = stripPrefix(t);
  l = l.replace(/^layout_/i, '');
  const track = titleWords(t);
  const layout = titleWords(l);
  return { track, layout, full: layout ? `${track} · ${layout}` : track };
}

/** "vrc_formula_alpha_2026_csp" → "VRC Formula Alpha 2026 CSP" */
export function prettyCar(raw: string): string {
  if (!raw) return 'Unknown car';
  return titleWords(raw);
}

export function prettyTeam(raw: string | undefined): string {
  if (!raw) return '';
  return raw.replace(/[()]/g, '').replace(/_/g, ' ').trim();
}

export function formatDateTime(ms: number | null | undefined, withSeconds = false): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

export function relativeTime(ms: number | null | undefined): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = diff / 60000;
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.floor(min)} min ago`;
  const h = min / 60;
  if (h < 24) return `${Math.floor(h)} h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString();
}

/** Format an epoch-seconds in-game clock in a given IANA time zone ("UTC" for raw). */
export function formatGameClock(epochSec: number | null | undefined, timeZone: string, withDate = false): string {
  if (epochSec == null || !Number.isFinite(epochSec)) return '—';
  try {
    return new Date(epochSec * 1000).toLocaleString(undefined, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(withDate ? { day: '2-digit', month: 'short' } : {}),
    });
  } catch {
    return new Date(epochSec * 1000).toISOString().slice(11, 16);
  }
}

export function formatBytes(n: number): string {
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + ' GB';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(0) + ' KB';
  return n + ' B';
}
