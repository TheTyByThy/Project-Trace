// Keyboard shortcuts: the bindable actions, their default keys and key-combo helpers. Users can rebind
// any of these in Help → Keyboard Shortcuts; overrides are saved in settings.shortcuts.
//
// A combo is written like "Mod+Shift+O", "J", "F3" or "ArrowLeft". "Mod" is Ctrl on Windows and ⌘ on
// macOS. Letters are upper case; symbol keys (+ - [ ] ,) are written as typed, without Shift.

export interface ShortcutDef {
  id: string;
  label: string;
  group: 'General' | 'View' | 'Laps' | 'Cursor & zoom' | 'Worksheets';
  keys: string[];
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'open-browser', label: 'Session browser', group: 'General', keys: ['Mod+O'] },
  { id: 'open-files', label: 'Open telemetry files directly', group: 'General', keys: ['Mod+Shift+O'] },
  { id: 'palette', label: 'Command palette', group: 'General', keys: ['Mod+K'] },
  { id: 'math', label: 'Math channel editor', group: 'General', keys: ['Mod+M'] },
  { id: 'settings', label: 'Settings', group: 'General', keys: ['Mod+,'] },
  { id: 'export-csv', label: 'Export visible data to CSV', group: 'General', keys: ['Mod+E'] },
  { id: 'screenshot', label: 'Save screenshot', group: 'General', keys: ['Mod+Shift+S'] },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'General', keys: ['F1'] },
  { id: 'ws-save', label: 'Save workspace', group: 'General', keys: ['Mod+S'] },
  { id: 'toggle-inspector', label: 'Toggle Properties panel', group: 'View', keys: ['Mod+I'] },
  { id: 'toggle-sidebar', label: 'Toggle sidebar', group: 'View', keys: ['Mod+B'] },
  { id: 'toggle-x', label: 'Toggle time / distance x-axis', group: 'View', keys: ['D'] },
  { id: 'toggle-variance', label: 'Toggle time variance pane', group: 'View', keys: ['F3', 'V'] },
  { id: 'toggle-smoothing', label: 'Toggle trace smoothing', group: 'View', keys: ['S'] },
  { id: 'toggle-sectors', label: 'Toggle sector & split lines (all graphs and maps)', group: 'View', keys: ['Shift+S'] },
  { id: 'toggle-corners', label: 'Toggle corner lines (all graphs and maps)', group: 'View', keys: ['C'] },
  { id: 'toggle-ref-colors', label: 'Reference lap: channel colours ⇄ single lap colour', group: 'View', keys: ['J'] },
  { id: 'fastest-lap', label: 'Fastest lap as reference', group: 'Laps', keys: ['F'] },
  { id: 'prev-lap', label: 'Previous lap as reference', group: 'Laps', keys: ['ArrowUp', 'PageUp', '['] },
  { id: 'next-lap', label: 'Next lap as reference', group: 'Laps', keys: ['ArrowDown', 'PageDown', ']'] },
  { id: 'reset-view', label: 'Reset view (whole lap, clear measurement)', group: 'Cursor & zoom', keys: ['Escape', 'W', 'Home'] },
  { id: 'cursor-left', label: 'Move cursor left', group: 'Cursor & zoom', keys: ['ArrowLeft'] },
  { id: 'cursor-right', label: 'Move cursor right', group: 'Cursor & zoom', keys: ['ArrowRight'] },
  { id: 'cursor-left-big', label: 'Move cursor left (big step)', group: 'Cursor & zoom', keys: ['Shift+ArrowLeft'] },
  { id: 'cursor-right-big', label: 'Move cursor right (big step)', group: 'Cursor & zoom', keys: ['Shift+ArrowRight'] },
  { id: 'zoom-in', label: 'Zoom in around the cursor', group: 'Cursor & zoom', keys: ['+', '='] },
  { id: 'zoom-out', label: 'Zoom out', group: 'Cursor & zoom', keys: ['-', '_'] },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `sheet-${i + 1}`, label: `Go to worksheet ${i + 1}`, group: 'Worksheets' as const, keys: [String(i + 1)] })),
];

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'OS']);

/** The combo string for a key event, or null for a bare modifier press. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key = e.key;
  if (key === ' ') key = 'Space';
  const printable = key.length === 1;
  const letter = printable && /[a-z]/i.test(key);
  if (letter) key = key.toUpperCase();
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  // Shift already changes a symbol key's character ("=" → "+"), so it is only part of the combo for
  // letters and named keys.
  if (e.shiftKey && (letter || !printable)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Human-readable form of a combo for the current platform. */
export function formatCombo(combo: string, mac = navigator.platform.toLowerCase().includes('mac')): string {
  const names: Record<string, string> = {
    Mod: mac ? '⌘' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt',
    Shift: mac ? '⇧' : 'Shift',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
  };
  // Split on "+" separators but keep a literal "+" key.
  const parts = combo === '+' ? ['+'] : combo.endsWith('++') ? [...combo.slice(0, -2).split('+'), '+'] : combo.split('+');
  return parts.map((p) => names[p] ?? p).join(mac ? '' : ' + ');
}

/** Effective bindings: the user's overrides on top of the defaults. */
export function bindings(overrides: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of SHORTCUTS) out[d.id] = overrides[d.id] ?? d.keys;
  return out;
}

/** The action bound to a combo, if any. */
export function actionForCombo(combo: string, overrides: Record<string, string[]>): string | undefined {
  const b = bindings(overrides);
  return SHORTCUTS.find((d) => b[d.id].includes(combo))?.id;
}

/** First key of an action, formatted, for hints in menus and tooltips. */
export function shortcutHint(id: string, overrides: Record<string, string[]>): string | undefined {
  const k = bindings(overrides)[id]?.[0];
  return k ? formatCombo(k) : undefined;
}
