// Session details, car setup (side-by-side with differences highlighted when several sessions are
// loaded) and free-text notes saved per session file.

import { formatDateTime, formatDuration, formatGameClock, formatLapTime, prettyCar, prettyTeam, prettyTrack } from '../core/format';
import { fastestLap, theoreticalBest } from '../core/session';
import { zoneForVenue } from '../core/timezones';
import { pt } from '../core/bridge';
import { setNote, updateComponent, useStore } from '../state/store';
import type { DetailsConfig } from '../state/workspace';
import type { Session } from '../core/types';

function InfoTable({ s }: { s: Session }) {
  const settings = useStore((st) => st.settings);
  const m = s.meta;
  const fl = fastestLap(s);
  const ideal = theoreticalBest(s);
  const tz = zoneForVenue(m.venue, settings.trackZones, settings.gameClock);
  const tr = prettyTrack(m.venue);
  const rows: [string, React.ReactNode][] = [
    ['Track', `${tr.track}${tr.layout ? ` — ${tr.layout}` : ''}`],
    ['Car', prettyCar(m.vehicle)],
    ['Livery / team', prettyTeam(m.details['Team']?.value) || '—'],
    ['Driver', m.driver || '—'],
    ['Saved', formatDateTime(m.savedAt, true)],
    ['In-game time', m.gameTimeUtc ? `${formatGameClock(m.gameTimeUtc, tz, true)} (${tz === 'UTC' ? 'UTC' : tz.split('/').pop()?.replace('_', ' ')})` : '—'],
    ['Duration', formatDuration(s.duration)],
    ['Laps', `${s.laps.length} (${s.laps.filter((l) => l.complete).length} complete, ${s.laps.filter((l) => l.invalid).length} invalid)`],
    ['Fastest lap', fl ? `${formatLapTime(fl.time)} (lap ${fl.number}${fl.invalid ? ', invalid' : ''})` : '—'],
    ['Ideal lap', ideal ? formatLapTime(ideal.time) : '—'],
    ['Track length', s.trackLength ? `${(s.trackLength / 1000).toFixed(3)} km` : '—'],
    ['Sample rate', `${s.baseRate} Hz (channels at ${[...new Set([...s.channels.values()].filter((c) => !c.isMath).map((c) => c.rate))].sort((a, b) => b - a).join(' / ')} Hz)`],
    ['Channels', `${[...s.channels.values()].filter((c) => !c.isMath && !c.isDerived).length} logged, ${[...s.channels.values()].filter((c) => c.isMath).length} math`],
    ['Format', m.format],
    [
      'File',
      <span key="f">
        {s.fileName}{' '}
        <button className="btn ghost small" onClick={() => pt().showItemInFolder(s.path)}>
          Show in folder
        </button>
      </span>,
    ],
  ];
  const details = Object.entries(m.details).filter(([k]) => !['Team'].includes(k));
  return (
    <>
      <div className="details-kv">
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <div className="k">{k}</div>
            <div className="v">{v}</div>
          </div>
        ))}
      </div>
      {details.length > 0 && (
        <>
          <div className="section-title">Vehicle & venue details</div>
          <div className="details-kv">
            {details.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <div className="k">{k}</div>
                <div className="v num">
                  {v.value} {v.unit}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function DetailsView({ config }: { config: DetailsConfig }) {
  const sessions = useStore((s) => s.sessions);
  const notes = useStore((s) => s.notes);
  if (!sessions.length) return <div className="empty-state">Open a session to see its details and setup.</div>;
  const tab = config.tab;
  const keys = [...new Set(sessions.flatMap((s) => Object.keys(s.meta.setup)))].sort((a, b) => a.localeCompare(b));
  const differs = (k: string) => new Set(sessions.map((s) => s.meta.setup[k]?.value ?? '')).size > 1;
  const shownKeys = config.diffOnly && sessions.length > 1 ? keys.filter(differs) : keys;
  return (
    <div className="html-panel">
      <div className="subtabs">
        <div className="seg">
          {(['info', 'setup', 'notes'] as const).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => updateComponent(config.id, { tab: t })}>
              {t === 'info' ? 'Session' : t === 'setup' ? 'Car setup' : 'Notes'}
            </button>
          ))}
        </div>
        <span className="grow" />
        {tab === 'setup' && sessions.length > 1 && (
          <label className="check">
            <input type="checkbox" checked={config.diffOnly} onChange={(e) => updateComponent(config.id, { diffOnly: e.target.checked })} />
            Differences only
          </label>
        )}
      </div>
      {tab === 'info' &&
        sessions.map((s) => (
          <div key={s.id}>
            {sessions.length > 1 && <div className="section-title">{s.fileName}</div>}
            <InfoTable s={s} />
          </div>
        ))}
      {tab === 'setup' &&
        (keys.length ? (
          <table className="grid">
            <thead>
              <tr>
                <th className="l">Parameter</th>
                {sessions.map((s) => (
                  <th key={s.id}>{sessions.length > 1 ? new Date(s.meta.savedAt ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Value'}</th>
                ))}
                <th className="l">Unit</th>
              </tr>
            </thead>
            <tbody>
              {shownKeys.map((k) => (
                <tr key={k} className={sessions.length > 1 && differs(k) ? 'diff' : ''}>
                  <td className="l">{k}</td>
                  {sessions.map((s) => (
                    <td key={s.id} className="num">
                      {s.meta.setup[k]?.value ?? '—'}
                    </td>
                  ))}
                  <td className="l muted">{sessions.map((s) => s.meta.setup[k]?.unit).find(Boolean) ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">This file has no setup block.</div>
        ))}
      {tab === 'notes' &&
        sessions.map((s) => (
          <div key={s.id} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Notes for {s.fileName} (saved automatically)
            </div>
            <textarea
              className="input"
              rows={10}
              placeholder="What did you change? How did the car feel? Balance, traction, braking stability…"
              value={notes[s.fileName] ?? ''}
              onChange={(e) => setNote(s.fileName, e.target.value)}
            />
          </div>
        ))}
    </div>
  );
}
