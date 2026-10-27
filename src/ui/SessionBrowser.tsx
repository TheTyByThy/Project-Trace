// Session browser: point Project-Trace at your Telemetrick export folder, pick a track, pick
// sessions. Header-only reads make it fast; the folder is watched for new exports.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { baseName, dirName, pt, type DirFile, type DirListing } from '../core/bridge';
import { formatBytes, formatDateTime, formatDuration, formatGameClock, formatLapTime, prettyCar, prettyTeam, prettyTrack, relativeTime } from '../core/format';
import { COMMON_ZONES, guessTrackZone, zoneForVenue } from '../core/timezones';
import { summarizeFile, type SessionSummary } from '../state/loader';
import { closeSession, openFiles, setDefaultTelemetryFolder, setTelemetryFolders, setUi, telemetryFolders, updateSettings, useStore } from '../state/store';
import { openMenu, promptText } from './overlays';

type SortKey = 'savedAt' | 'track' | 'driver' | 'vehicle' | 'laps' | 'bestLap' | 'size';

const sep = (p: string) => (p.includes('\\') ? '\\' : '/');
const exportKey = (name: string) => name.replace(/\.(csv|txt|ld)$/i, '').toLowerCase();
const isLdName = (name: string) => /\.ld$/i.test(name);
/** Compare paths regardless of separator style, case and trailing slash (Windows accepts both). */
const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Telemetrick can write both a .csv and an .ld for one export: show one row, preferring the CSV. */
function preferredFiles(files: DirFile[]): (DirFile & { alsoLd?: boolean })[] {
  const byKey = new Map<string, DirFile & { alsoLd?: boolean }>();
  for (const f of files) {
    const k = exportKey(f.name);
    const cur = byKey.get(k);
    if (!cur) byKey.set(k, { ...f });
    else if (isLdName(cur.name) && !isLdName(f.name)) byKey.set(k, { ...f, alsoLd: true });
    else if (isLdName(f.name)) cur.alsoLd = true;
  }
  return [...byKey.values()];
}

export function SessionBrowser() {
  const settings = useStore((s) => s.settings);
  const appInfo = useStore((s) => s.appInfo);
  const loaded = useStore((s) => s.sessions);
  const hasSessions = loaded.length > 0;
  const loadedPaths = new Set(loaded.map((s) => normPath(s.path)));
  // Double-click / quick actions add to what's open (or replace it), per the user's choice.
  const quickMode: 'add' | 'replace' = hasSessions ? settings.browserOpenMode : 'replace';
  const root = settings.telemetryRoot;
  const initial = () => {
    const last = settings.lastBrowsePath;
    if (last && root && normPath(last).startsWith(normPath(root))) {
      // Land one level above the last track so the track list is the first thing you see.
      return normPath(last) === normPath(root) ? root : dirName(last);
    }
    return root;
  };
  const [path, setPath] = useState<string>(initial);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [summaries, setSummaries] = useState<Record<string, SessionSummary>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'savedAt', dir: -1 });
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (dir: string) => {
    if (!dir) return;
    setLoading(true);
    const l = await pt().listDir(dir);
    setListing(l);
    setLoading(false);
    pt().watchDir(dir);
    // Summaries stream in (newest first so the top of the table fills immediately).
    const files = preferredFiles(l.files).sort((a, b) => b.mtime - a.mtime);
    for (const f of files) {
      summarizeFile(f).then((s) => setSummaries((prev) => (prev[f.path] === s ? prev : { ...prev, [f.path]: s })));
    }
  }, []);

  useEffect(() => {
    load(path);
    setFocus(null);
  }, [path, load]);
  useEffect(() => pt().onDirChanged((d) => d === path && load(path)), [path, load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hasSessions && setUi({ browser: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasSessions]);
  // Allow automation to point the browser somewhere specific.
  useEffect(() => {
    const h = (e: Event) => setPath((e as CustomEvent<string>).detail);
    window.addEventListener('pt-browse', h);
    return () => window.removeEventListener('pt-browse', h);
  }, []);

  const telFolders = telemetryFolders(settings);
  const chooseRoot = async () => {
    const p = await pt().chooseFolder(root || undefined);
    if (p) {
      setDefaultTelemetryFolder(p);
      updateSettings({ lastBrowsePath: p });
      setPath(p);
    }
  };
  const addFolder = async () => {
    const p = await pt().chooseFolder(path || root || undefined);
    if (!p) return;
    if (telFolders.some((f) => normPath(f.path) === normPath(p))) return setPath(p);
    const name = await promptText('Name this telemetry folder', baseName(p) || p);
    if (!name) return;
    setTelemetryFolders([...telFolders, { name, path: p }]);
    setPath(p);
  };
  const folderMenu = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    const f = telFolders[i];
    const set = (next: typeof telFolders) => setTelemetryFolders(next);
    openMenu(e, [
      { header: f.name },
      {
        label: 'Rename…',
        onClick: async () => {
          const n = await promptText('Rename telemetry folder', f.name);
          if (n) set(telFolders.map((x, k) => (k === i ? { ...x, name: n } : x)));
        },
      },
      {
        label: 'Change folder…',
        onClick: async () => {
          const p = await pt().chooseFolder(f.path);
          if (p) {
            set(telFolders.map((x, k) => (k === i ? { ...x, path: p } : x)));
            setPath(p);
          }
        },
      },
      { label: 'Make default', disabled: i === 0, onClick: () => set([f, ...telFolders.filter((_, k) => k !== i)]) },
      { label: 'Show in Finder / Explorer', onClick: () => pt().showItemInFolder(f.path) },
      { separator: true },
      { label: 'Remove shortcut', onClick: () => set(telFolders.filter((_, k) => k !== i)) },
    ]);
  };

  const rows = useMemo(() => {
    if (!listing) return [];
    const list = preferredFiles(listing.files).map((f) => summaries[f.path] ?? ({ path: f.path, fileName: f.name, size: f.size, mtime: f.mtime, ok: false } as SessionSummary));
    const q = filter.trim().toLowerCase();
    const filtered = q ? list.filter((r) => `${r.fileName} ${r.driver} ${r.vehicle} ${r.venue}`.toLowerCase().includes(q)) : list;
    const val = (r: SessionSummary): number | string => {
      switch (sort.key) {
        case 'savedAt':
          return r.savedAt ?? r.mtime;
        case 'track':
          return r.venue ? prettyTrack(r.venue).full.toLowerCase() : '';
        case 'driver':
          return r.driver ?? '';
        case 'vehicle':
          return r.vehicle ?? '';
        case 'laps':
          return r.completeLaps ?? 0;
        case 'bestLap':
          return r.bestLap ?? Infinity;
        case 'size':
          return r.size;
      }
    };
    return filtered.sort((a, b) => {
      const x = val(a),
        y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [listing, summaries, sort, filter]);

  const trackSort = settings.trackSort;
  const folders = useMemo(() => {
    if (!listing) return [];
    const q = filter.trim().toLowerCase();
    const label = (name: string) => prettyTrack(name).full.toLowerCase();
    const list = listing.folders.filter((f) => !q || f.name.toLowerCase().includes(q) || label(f.name).includes(q));
    switch (trackSort) {
      case 'name':
        return list.sort((a, b) => label(a.name).localeCompare(label(b.name)));
      case 'sessions':
        return list.sort((a, b) => b.csvCount - a.csvCount || label(a.name).localeCompare(label(b.name)));
      case 'oldest':
        return list.sort((a, b) => a.latestMtime - b.latestMtime);
      default:
        return list.sort((a, b) => b.latestMtime - a.latestMtime);
    }
  }, [listing, trackSort, filter]);
  const lastTrack = settings.lastBrowsePath;
  const fastestInFolder = useMemo(() => {
    let best: SessionSummary | null = null;
    for (const r of rows) if (r.bestLap != null && (!best || r.bestLap < (best.bestLap ?? Infinity))) best = r;
    return best;
  }, [rows]);

  // Breadcrumbs within whichever telemetry folder contains the current path (the deepest match).
  const crumbs: { label: string; path: string }[] = [];
  if (path) {
    const home = telFolders
      .filter((f) => normPath(path).startsWith(normPath(f.path)))
      .sort((a, b) => b.path.length - a.path.length)[0];
    const crumbRoot = home?.path ?? '';
    if (home) {
      const root = crumbRoot;
      crumbs.push({ label: home.name || baseName(root) || root, path: root });
      crumbs.push({ label: baseName(root) || root, path: root });
      let acc = root.replace(/[\\/]$/, '');
      for (const p of path.slice(root.length).split(/[\\/]/).filter(Boolean)) {
        acc = acc + sep(path) + p;
        crumbs.push({ label: p, path: acc });
      }
    } else crumbs.push({ label: baseName(path) || path, path });
  }

  const open = (paths: string[], mode: 'replace' | 'add' = quickMode) => {
    if (!paths.length) return;
    openFiles(paths, mode);
    setSelected([]);
  };
  // The selection is a basket that survives folder changes, so sessions from different tracks,
  // drivers or stints can be opened together. Plain clicks only replace this folder's picks.
  const inThisFolder = (p: string) => normPath(dirName(p)) === normPath(path);
  const toggleSel = (p: string, e: React.MouseEvent) => {
    setFocus(p);
    if (e.ctrlKey || e.metaKey) setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
    else if (e.shiftKey && selected.some(inThisFolder)) {
      const here = selected.filter(inThisFolder);
      const idx = rows.findIndex((r) => r.path === here[here.length - 1]);
      const j = rows.findIndex((r) => r.path === p);
      const [a, c] = idx < j ? [idx, j] : [j, idx];
      setSelected((s) => [...s.filter((x) => !inThisFolder(x)), ...rows.slice(a, c + 1).map((r) => r.path)]);
    } else setSelected((s) => [...s.filter((x) => !inThisFolder(x)), p]);
  };
  const folderCount = new Set(selected.map((p) => normPath(dirName(p)))).size;
  const focused = focus ? summaries[focus] : null;
  const venue = focused?.venue || rows.find((r) => r.venue)?.venue || '';
  const tz = zoneForVenue(venue, settings.trackZones, settings.gameClock);

  const sortHead = (key: SortKey, label: string, cls = '') => (
    <th className={cls} style={{ cursor: 'pointer' }} onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'savedAt' ? -1 : 1 }))}>
      {label}
      {sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
    </th>
  );

  const welcome = !root;
  return (
    <div className="modal-back" onMouseDown={() => hasSessions && setUi({ browser: false })}>
      <div className="modal browser" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Session Browser</h2>
          <input className="input" style={{ width: 240 }} placeholder="Filter sessions…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button
            className="btn"
            onClick={async () => {
              const files = await pt().chooseFiles(path || root || undefined);
              if (files.length) open(files);
            }}
          >
            Open files…
          </button>
          {hasSessions && (
            <div className="row" style={{ gap: 6 }} title="What double-click, Recent and Open files… do while sessions are open">
              <span className="muted" style={{ fontSize: 12 }}>
                Double-click:
              </span>
              <div className="seg">
                <button className={settings.browserOpenMode === 'add' ? 'on' : ''} onClick={() => updateSettings({ browserOpenMode: 'add' })}>
                  Add to open
                </button>
                <button className={settings.browserOpenMode === 'replace' ? 'on' : ''} onClick={() => updateSettings({ browserOpenMode: 'replace' })}>
                  Replace
                </button>
              </div>
            </div>
          )}
          {hasSessions && (
            <button className="btn icon ghost" onClick={() => setUi({ browser: false })} title="Close (Esc)">
              ✕
            </button>
          )}
        </div>
        <div className="browser-grid">
          <div className="browser-side">
            {hasSessions && (
              <>
                <div className="section-title">Open now ({loaded.length})</div>
                {loaded.map((s) => (
                  <div key={s.id} className="item row" style={{ gap: 6 }} title={s.path}>
                    <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.meta.driver || 'Unknown'} <span className="muted">· {prettyTrack(s.meta.venue).track} · {formatDateTime(s.meta.savedAt)}</span>
                    </span>
                    <button className="btn icon ghost small" title="Close this session" onClick={() => closeSession(s.id)}>
                      ✕
                    </button>
                  </div>
                ))}
              </>
            )}
            <div className="section-title">Telemetry folders</div>
            {telFolders.map((f, i) => (
              <div
                key={f.path + i}
                className={'item' + (normPath(path).startsWith(normPath(f.path)) ? ' on' : '')}
                title={`${f.path}${i === 0 ? ' (default)' : ''} — right-click to rename, change or remove`}
                onClick={() => setPath(f.path)}
                onContextMenu={(e) => folderMenu(e, i)}
              >
                🏁 {f.name}
                {i === 0 && telFolders.length > 1 && <span className="muted"> · default</span>}
              </div>
            ))}
            {!telFolders.length && (
              <div className="item muted" onClick={chooseRoot}>
                Not set
              </div>
            )}
            <div style={{ padding: '4px 14px' }}>
              <button className="btn small" onClick={telFolders.length ? addFolder : chooseRoot}>
                {telFolders.length ? '+ Add folder…' : 'Choose folder…'}
              </button>
            </div>
            {appInfo?.sampleDataDir && (
              <>
                <div className="section-title">Sample data</div>
                <div className="item" onClick={() => setPath(appInfo.sampleDataDir)}>
                  📦 Bundled sample session
                </div>
              </>
            )}
            {settings.recent.length > 0 && (
              <>
                <div className="section-title">Recent sessions</div>
                {settings.recent.slice(0, 12).map((p) => {
                  const name = baseName(p);
                  const m = name.match(/^(\d{2})(\d{2})(\d{4})-(\d{2})(\d{2})/);
                  const track = prettyTrack(baseName(dirName(p))).track;
                  return (
                    <div key={p} className="item" title={p} onClick={() => open([p])}>
                      {track}
                      <span className="muted"> · {m ? `${m[1]}/${m[2]} ${m[4]}:${m[5]}` : name}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>
          <div className="browser-main">
            {welcome ? (
              <div className="welcome">
                <h1>Welcome to Project-Trace</h1>
                <div className="dim">
                  Point Project-Trace at the folder where Telemetrick saves your Assetto Corsa exports. You can choose the top-level <b>exported</b> folder, a driver
                  folder, or a single car folder — you'll then pick a track and a session.
                </div>
                <div className="code-path">Documents\Assetto Corsa\apps\telemetrick\exported\&lt;Driver&gt;\&lt;car&gt;\&lt;track&gt;\*.csv</div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button className="btn primary" onClick={chooseRoot}>
                    Choose telemetry folder…
                  </button>
                  {appInfo?.defaultTelemetryRoot && (
                    <button
                      className="btn"
                      onClick={() => {
                        setDefaultTelemetryFolder(appInfo.defaultTelemetryRoot);
                        setPath(appInfo.defaultTelemetryRoot);
                      }}
                    >
                      Use detected folder
                    </button>
                  )}
                  {appInfo?.sampleDataDir && (
                    <button className="btn" onClick={() => setPath(appInfo.sampleDataDir)}>
                      Browse the sample session
                    </button>
                  )}
                </div>
                {appInfo?.defaultTelemetryRoot && <div className="code-path">{appInfo.defaultTelemetryRoot}</div>}
              </div>
            ) : null}
            {!welcome || path ? (
              <>
                <div className="crumbs">
                  {crumbs.map((c, i) => (
                    <span key={c.path} className="row" style={{ gap: 4 }}>
                      {i > 0 && <span className="muted">›</span>}
                      <span className={'c' + (i === crumbs.length - 1 ? ' last' : '')} onClick={() => setPath(c.path)}>
                        {i === crumbs.length - 1 && listing?.files.length ? prettyTrack(c.label).full : c.label}
                      </span>
                    </span>
                  ))}
                  <span className="grow" />
                  {loading && <span className="muted">Reading…</span>}
                  {listing && listing.files.length > 0 && (
                    <span className="muted" title="New exports appear automatically">
                      ● watching for new exports
                    </span>
                  )}
                </div>
                {listing?.error && <div className="err" style={{ padding: 16 }}>Could not read folder: {listing.error}</div>}
                <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                  <div className="scroll">
                    {(folders.length > 0 || (listing?.folders.length ?? 0) > 0) && (
                      <>
                        <div className="row" style={{ padding: '12px 16px 0' }}>
                          <span className="section-title" style={{ padding: 0 }}>
                            {listing!.files.length > 0 ? 'Folders' : `${folders.length} folder${folders.length === 1 ? '' : 's'}`}
                          </span>
                          <span className="grow" />
                          <span className="muted" style={{ fontSize: 12 }}>
                            Sort:
                          </span>
                          <div className="seg">
                            {(
                              [
                                ['recent', 'Last driven'],
                                ['name', 'Name A–Z'],
                                ['sessions', 'Most sessions'],
                                ['oldest', 'Oldest first'],
                              ] as const
                            ).map(([k, l]) => (
                              <button key={k} className={trackSort === k ? 'on' : ''} onClick={() => updateSettings({ trackSort: k })}>
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="cards">
                          {folders.map((f) => {
                            const isTrack = f.csvCount > 0;
                            const tr = prettyTrack(f.name);
                            const isLast = lastTrack && normPath(lastTrack) === normPath(f.path);
                            return (
                              <div key={f.path} className="card" onClick={() => setPath(f.path)} style={isLast ? { borderColor: 'var(--accent)' } : undefined}>
                                <div className="t">{isTrack ? tr.track : f.subCount > 0 && /_/.test(f.name) ? prettyCar(f.name) : f.name}</div>
                                {isTrack && tr.layout && <div className="s">{tr.layout}</div>}
                                <div className="s">
                                  {isTrack ? `${f.csvCount} session${f.csvCount === 1 ? '' : 's'}` : `${f.subCount} folder${f.subCount === 1 ? '' : 's'}`}
                                  {f.latestMtime ? ` · ${relativeTime(f.latestMtime)}` : ''}
                                  {isLast ? ' · last opened' : ''}
                                </div>
                                <div className="raw">{f.name}</div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {listing && listing.files.length > 0 && (
                      <table className="grid">
                        <thead>
                          <tr>
                            <th style={{ width: 28 }}></th>
                            {sortHead('savedAt', 'Saved', 'l')}
                            {sortHead('track', 'Track', 'l')}
                            {sortHead('driver', 'Driver', 'l')}
                            {sortHead('vehicle', 'Car', 'l')}
                            {sortHead('laps', 'Laps')}
                            {sortHead('bestLap', 'Best lap')}
                            <th>Air / track</th>
                            {sortHead('size', 'Size')}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => {
                            const sel = selected.includes(r.path);
                            const isFastest = fastestInFolder === r;
                            return (
                              <tr
                                key={r.path}
                                className={'click' + (sel ? ' sel' : '')}
                                onClick={(e) => toggleSel(r.path, e)}
                                onDoubleClick={() => open([r.path])}
                              >
                                <td>
                                  <input type="checkbox" checked={sel} onChange={() => {}} onClick={(e) => (e.stopPropagation(), setSelected((s) => (s.includes(r.path) ? s.filter((x) => x !== r.path) : [...s, r.path])), setFocus(r.path))} />
                                </td>
                                <td className="l">
                                  <div>{formatDateTime(r.savedAt ?? r.mtime)}</div>
                                  <div className="muted" style={{ fontSize: 11 }}>
                                    {relativeTime(r.savedAt ?? r.mtime)}{' '}
                                    {loadedPaths.has(normPath(r.path)) && <span className="tag best">open</span>}{' '}
                                    <span className="tag" title={isLdName(r.fileName) ? 'MoTeC .ld log (with .ldx laps)' : 'CSV export'}>
                                      {isLdName(r.fileName) ? 'ld' : 'csv'}
                                    </span>
                                  </div>
                                </td>
                                <td className="l" title={r.venue}>
                                  {r.venue ? prettyTrack(r.venue).track : ''}
                                  {r.venue && prettyTrack(r.venue).layout && (
                                    <div className="muted" style={{ fontSize: 11 }}>
                                      {prettyTrack(r.venue).layout}
                                    </div>
                                  )}
                                </td>
                                <td className="l">{r.driver || (r.ok ? '—' : <span className="muted">{r.error ? 'unreadable' : '…'}</span>)}</td>
                                <td className="l" title={r.vehicle}>
                                  {r.vehicle ? prettyCar(r.vehicle) : ''}
                                  {r.team && (
                                    <div className="muted" style={{ fontSize: 11 }}>
                                      {prettyTeam(r.team)}
                                    </div>
                                  )}
                                </td>
                                <td className="num">{r.ok ? `${r.completeLaps} / ${r.lapCount}` : ''}</td>
                                <td className={'num' + (isFastest ? ' best' : '')}>
                                  {r.bestLap != null ? formatLapTime(r.bestLap) : r.ok ? '—' : ''}
                                  {r.bestLapNumber != null && <span className="muted"> L{r.bestLapNumber}</span>}
                                </td>
                                <td className="num">{r.airTemp != null ? `${r.airTemp.toFixed(0)}° / ${r.roadTemp?.toFixed(0) ?? '—'}°` : ''}</td>
                                <td className="num muted">{formatBytes(r.size)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    {listing && !listing.files.length && !folders.length && !listing.error && (
                      <div className="empty-state">This folder has no CSV files or sub-folders.</div>
                    )}
                  </div>
                  {focused && focused.ok && (
                    <div style={{ width: 300, borderLeft: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
                      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{prettyTrack(focused.venue).track}</div>
                        <div className="dim">{prettyTrack(focused.venue).layout}</div>
                        <div>
                          {prettyCar(focused.vehicle)}
                          <div className="muted" style={{ fontSize: 12 }}>
                            {prettyTeam(focused.team)}
                          </div>
                        </div>
                        <div className="details-kv" style={{ padding: 0, gridTemplateColumns: '90px 1fr' }}>
                          <div className="k">Driver</div>
                          <div>{focused.driver}</div>
                          <div className="k">Saved</div>
                          <div>{formatDateTime(focused.savedAt, true)}</div>
                          <div className="k">In-game</div>
                          <div>
                            {formatGameClock(focused.gameTimeUtc, tz, true)}
                            <div className="muted" style={{ fontSize: 11 }}>
                              UTC {formatGameClock(focused.gameTimeUtc, 'UTC')}
                            </div>
                          </div>
                          <div className="k">Duration</div>
                          <div>{formatDuration(focused.duration)}</div>
                          <div className="k">Weather</div>
                          <div>
                            {focused.sky || '—'}
                            {focused.airTemp != null && ` · air ${focused.airTemp.toFixed(0)}°C · track ${focused.roadTemp?.toFixed(0)}°C`}
                          </div>
                          <div className="k">Fuel</div>
                          <div>{focused.fuelStart != null ? `${focused.fuelStart.toFixed(1)} l at start` : '—'}</div>
                        </div>
                        <label className="field">
                          In-game clock time zone for this track
                          <select
                            className="input"
                            value={settings.trackZones[focused.venue] ?? ''}
                            onChange={(e) => {
                              const z = { ...settings.trackZones };
                              if (e.target.value) z[focused.venue] = e.target.value;
                              else delete z[focused.venue];
                              updateSettings({ trackZones: z });
                            }}
                          >
                            <option value="">Auto ({guessTrackZone(focused.venue) ?? 'UTC'})</option>
                            {COMMON_ZONES.map((zn) => (
                              <option key={zn} value={zn}>
                                {zn}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="section-title" style={{ padding: '6px 0 0' }}>
                          Lap times
                        </div>
                        <table className="grid">
                          <tbody>
                            {focused.lapTimes.map((t, i) => (
                              <tr key={i}>
                                <td className="l">
                                  Lap {i + 1}
                                  {i === 0 && focused.completeLaps < focused.lapTimes.length ? <span className="tag" style={{ marginLeft: 6 }}>out</span> : ''}
                                </td>
                                <td className={'num' + (focused.bestLapNumber === i + 1 ? ' best' : '')}>{formatLapTime(t)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
                          <button className="btn primary" onClick={() => open([focused.path], 'replace')}>
                            Open
                          </button>
                          {hasSessions && (
                            <button className="btn" onClick={() => open([focused.path], 'add')}>
                              Add to comparison
                            </button>
                          )}
                          <button className="btn ghost" onClick={() => pt().showItemInFolder(focused.path)}>
                            Show file
                          </button>
                        </div>
                        <div className="muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                          {focused.fileName}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted grow" style={{ fontSize: 12 }}>
            {selected.length
              ? `${selected.length} session${selected.length === 1 ? '' : 's'} selected${folderCount > 1 ? ` from ${folderCount} folders` : ''} — selections are kept while you browse other tracks or drivers`
              : 'Tick sessions in any folders (they stay selected as you browse), then open them together to compare · double-click opens one'}
          </span>
          {selected.length > 0 && (
            <button className="btn ghost" onClick={() => setSelected([])}>
              Clear selection
            </button>
          )}
          {hasSessions ? (
            <>
              <button className="btn" disabled={!selected.length} onClick={() => open(selected, 'replace')}>
                Replace open sessions{selected.length > 1 ? ` with ${selected.length}` : ''}
              </button>
              <button className="btn primary" disabled={!selected.length} onClick={() => open(selected, 'add')}>
                Add {selected.length > 1 ? `${selected.length} sessions` : ''} to open
              </button>
            </>
          ) : (
            <button className="btn primary" disabled={!selected.length} onClick={() => open(selected, 'replace')}>
              Open {selected.length > 1 ? `${selected.length} sessions` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
