// Sliders for how corner ranges are found and how corners are bucketed by speed. The settings are
// global (every track); shown in the track editor.

import { DEFAULT_CORNER_SETTINGS } from '../core/corners';
import { convertUnit } from '../core/units';
import { setCornerSettings, useStore } from '../state/store';

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="field slider-field">
      <span className="row" style={{ gap: 6 }}>
        <span className="grow">{label}</span>
        <span className="num" style={{ color: 'var(--text)' }}>
          {Math.round(value * 10) / 10} {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function CornerSettingsEditor({ compact = false }: { compact?: boolean }) {
  const c = useStore((s) => s.settings.corners);
  const speedUnit = useStore((s) => s.settings.units.speed);
  // Thresholds are stored in kph and shown in the user's speed unit.
  const k = convertUnit('kph', speedUnit) ?? { k: 1, b: 0 };
  const show = (kph: number) => kph * k.k + k.b;
  const store = (v: number) => (v - k.b) / k.k;
  const maxSpeed = show(350);
  const step = speedUnit === 'm/s' ? 1 : 5;
  return (
    <div className={compact ? 'corner-settings compact' : 'corner-settings'}>
      <div className="corner-settings-group">
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
          <b>Corner range</b> — from where you leave full throttle (lift or brake) before the apex to where you're back at full throttle after it, measured on the
          reference lap. Corners given an exact Start / End in the table keep it.
        </div>
        <Slider label="Before the lift / braking point" value={c.before} min={0} max={150} step={5} unit="m" onChange={(v) => setCornerSettings({ before: v })} />
        <Slider label="After full throttle again" value={c.after} min={0} max={150} step={5} unit="m" onChange={(v) => setCornerSettings({ after: v })} />
        <Slider label="Full throttle at" value={c.fullThrottle} min={80} max={100} step={1} unit="%" onChange={(v) => setCornerSettings({ fullThrottle: v })} />
      </div>
      <div className="corner-settings-group">
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
          <b>Speed buckets</b> — by each corner's minimum speed on the reference lap.
        </div>
        <Slider
          label="Low speed below"
          value={Math.round(show(c.lowMax))}
          min={Math.round(show(30))}
          max={Math.round(maxSpeed)}
          step={step}
          unit={speedUnit}
          onChange={(v) => setCornerSettings({ lowMax: Math.min(store(v), c.highMin) })}
        />
        <Slider
          label="High speed from"
          value={Math.round(show(c.highMin))}
          min={Math.round(show(30))}
          max={Math.round(maxSpeed)}
          step={step}
          unit={speedUnit}
          onChange={(v) => setCornerSettings({ highMin: Math.max(store(v), c.lowMax) })}
        />
        <div className="muted" style={{ fontSize: 11 }}>
          Medium speed is in between ({Math.round(show(c.lowMax))}–{Math.round(show(c.highMin))} {speedUnit}).
        </div>
      </div>
      <button className="btn small ghost" onClick={() => setCornerSettings(DEFAULT_CORNER_SETTINGS)}>
        Reset to defaults
      </button>
    </div>
  );
}
