// Rotation dial shown on the Track Map and GPS Track: drag the ring to spin the map (Shift snaps to
// 15°). Rotation is shared by every map of that track; "Save" stores it as the track's default and
// "Reset" restores the saved value.

import { useRef } from 'react';
import { resetRotation, rotationDirty, saveRotation, setWorkingRotation, trackRotation, useStore } from '../state/store';

export function RotationDial({ venue }: { venue: string }) {
  useStore((s) => s.workingRotation[venue]);
  useStore((s) => s.settings.trackProfiles[venue]?.rotation);
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ start: number; rot: number } | null>(null);
  if (!venue) return null;
  const rot = trackRotation(venue);
  const dirty = rotationDirty(venue);
  const angleOf = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return (Math.atan2(dx, -dy) * 180) / Math.PI; // clockwise from 12 o'clock
  };
  const S = 58;
  const R = 23;
  const knob = (rot * Math.PI) / 180;
  return (
    <div className="rot-dial" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <svg
        ref={ref}
        width={S}
        height={S}
        viewBox={`0 0 ${S} ${S}`}
        style={{ cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { start: angleOf(e), rot };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          let next = d.rot + (angleOf(e) - d.start);
          if (e.shiftKey) next = Math.round(next / 15) * 15;
          setWorkingRotation(venue, next);
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <title>Drag the ring to rotate the map (Shift = 15° steps)</title>
        <circle cx={S / 2} cy={S / 2} r={R + 4} className="rot-ring-bg" />
        <circle cx={S / 2} cy={S / 2} r={R} className="rot-ring" />
        {[0, 90, 180, 270].map((a) => (
          <line
            key={a}
            x1={S / 2 + Math.sin((a * Math.PI) / 180) * (R - 4)}
            y1={S / 2 - Math.cos((a * Math.PI) / 180) * (R - 4)}
            x2={S / 2 + Math.sin((a * Math.PI) / 180) * (R + 3)}
            y2={S / 2 - Math.cos((a * Math.PI) / 180) * (R + 3)}
            className="rot-tick"
          />
        ))}
        <circle cx={S / 2 + Math.sin(knob) * R} cy={S / 2 - Math.cos(knob) * R} r={5.5} className="rot-knob" />
        <text x={S / 2} y={S / 2 + 4} textAnchor="middle" className="rot-text">
          {Math.round(rot)}°
        </text>
      </svg>
      <div className="rot-buttons">
        <button className="btn small" disabled={!dirty} title="Save this rotation as the default for this track" onClick={() => saveRotation(venue)}>
          Save
        </button>
        <button className="btn small" disabled={!dirty} title="Restore the saved rotation" onClick={() => resetRotation(venue)}>
          Reset
        </button>
      </div>
      {dirty && <div className="rot-unsaved">unsaved</div>}
    </div>
  );
}
