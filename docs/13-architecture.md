# 13 · Architecture (for developers)

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron 41** | one codebase for Windows and macOS, native dialogs, packaging to .exe/.dmg |
| UI | **React 19 + TypeScript**, bundled by **Vite** | typed, fast builds |
| State | **Zustand** | tiny; supports imperative subscriptions for 60 fps cursor updates |
| Charts | **custom Canvas 2D renderers** | full control of MoTeC-style behaviour (panes, overlays, distance axis) and speed on millions of samples |
| Parsing | **Web Worker** with a byte-level parser | keeps the UI responsive while reading 80 MB files |
| Tests | **Vitest** | parser, math engine and `.ld` ↔ CSV cross-checks against real data |

There are no runtime dependencies beyond Electron itself; everything else is bundled.

## Source map

```
electron/
  main.cjs        window, app:// protocol (serves dist/), IPC: filesystem, dialogs,
                  settings/workspace/library persistence (per-file write queue), folder watching,
                  native menus (Workspace/Worksheet menus rebuilt from renderer state), automation
  preload.cjs     contextBridge → window.pt (the only way the UI touches the OS)
src/
  core/           framework-free logic
    types.ts        Session, Lap, ChannelInfo, ParsedFile…
    header.ts       header/metadata parsing shared by browser summaries and full parse
    csvParser.ts    byte-level multi-rate CSV parser (native-rate channels)
    ldParser.ts     MoTeC .ld reader + .ldx parser
    session.ts      laps (beacons → lap number → lap distance), validity, sectors, distance mapping
    channel.ts      sampling, interpolation, resampling helpers
    axis.ts         lap x-mapping (time/distance) with caches; time-variance computation
    math/           expression lexer/parser, 60-function library, vectorised evaluator
    corners.ts      user-defined corners → analysis windows + metrics; opt-in suggestions
    stats.ts        range stats, polynomial fits, nice ticks, FFT
    units.ts        unit conversions and display preferences
    colors.ts       validated categorical palettes, ramps
    format.ts, timezones.ts, channelMeta.ts, bridge.ts
  state/
    store.ts        app state + actions: sessions, lap selection & colours, cursor/zoom, workspaces
                    (read-only Starter + copy-on-write), undo/redo history, track profiles, library
    workspace.ts    workspace/worksheet/component types (plain JSON)
    layout.ts       split-tree operations (insert, move/dock, remove, resize)
    components.ts   component catalogue + defaults
    defaultWorkspace.ts, defaultMath.ts
    loader.ts       file → worker → Session; browser header summaries
  charts/         one file per component (GraphView, TrackMapView, GpsTrackView, ScatterView, …)
    canvas.ts       HiDPI canvas, theme colours, M4 decimating trace renderer
    data.ts         display units, display smoothing (cached moving average), lap windows
    trackGeo.ts     lap position paths + rotation/mirror projection (Track Map & GPS Track)
    RotationDial.tsx, BoxZoom.tsx (rectangle zoom layer for XY charts), axes.ts, registry.tsx
  ui/             app shell: Chrome (top bar, tabs, status), Sidebar, SheetView (layout, docking,
                  shared right-click items), PropertiesModal, TrackProfileEditor, SessionBrowser,
                  MathEditor, Dialogs, overlays (menus, channel/colour pickers, prompts)
  workers/parse.worker.ts
  shortcuts.ts    bindable shortcut actions, default keys, key-combo matching (user overrides in settings)
  actions.ts      shortcut/menu action handlers, command palette, CSV export
```

## Data flow

```
file ──► main: fs.readFile ──► renderer ──► Worker: parseTelemetryCsv / parseLd
                                                 │  (ArrayBuffers transferred, zero-copy)
                                                 ▼
                     buildSession(): channels (native rate) + derived Distance
                                     laps (beacons / Lap Number / Lap Distance) + validity
                                     sectors (Last Sector Time reconstruction) + lap distance maps
                                                 │
                     applyMathChannels(): dependency-ordered, vectorised evaluation
                                                 ▼
                                   zustand store (sessions, dataVersion++)
                                                 │
            components read selected laps → lapSeries(lap, channel, mode) → canvas
```

### Native-rate channels
Each channel is stored on a uniform grid `t = t0 + i / rate` at its logged rate (150/30/10/1 Hz for Telemetrick). `lapSeries()` maps a lap's sample range to x-positions (time-in-lap or lap distance) and caches the result per lap, rate and mode, so overlays of channels at different rates line up correctly.

### Rendering
Charts use two stacked canvases:
- **base**: grid and traces, redrawn when data, laps, zoom, size or theme change;
- **overlay**: cursor, measurement, legends with live values, drop targets. It is redrawn from an **imperative store subscription**, so moving the cursor never re-renders React.

Dense traces use M4 decimation (first/min/max/last per pixel column), so whole sessions draw in milliseconds.

### Laps & distance
Lap distance comes from the game's spline-based `Lap Distance` (unwrapped across the line and forced monotonic), so laps align by track position. Without it, distance is integrated from speed. Time variance samples both laps every 2 m and subtracts the time-at-distance.

### Undo / redo
Workspaces are updated immutably, so a history entry is just a snapshot of the `workspaces` array, the active workspace id and the track profiles. These share structure and cost almost nothing. Every structural edit calls `recordHistory(label)` before mutating; edits within 500 ms coalesce into one step (dragging a divider). Undo/redo swap snapshots, then save changed workspaces, delete removed ones (cancelling their pending saves), and recompute math if it changed. The Edit menu's Undo/Redo accelerators are routed to the renderer, which falls back to text undo inside inputs.

### The Starter workspace
`buildDefaultWorkspace()` generates the Starter on every launch with id `starter` and `locked: true`; it is never written to disk. `updateWorkspace()` on a locked workspace clones it into a new personal workspace, applies the edit there and switches to it (copy-on-write). View-only changes such as `activeSheet` are applied in memory without copying.

### Persistence
Personal workspaces are readable JSON files named after the workspace in `Documents/Project-Trace/Workspaces` (main keeps an id → file map; a rename moves the file; the folder is watched so dropped-in files appear). Built-in defaults are the code-generated Starter plus the files in `default-workspaces/` (shipped as an extra resource), loaded read-only with copy-on-write like the Starter. Track profiles work the same way: one `{ venue, …profile }` file per circuit in `Documents/Project-Trace/Tracks`, layered over the built-ins in `default-tracks/` (also an extra resource). The renderer writes only the venues whose profile object changed (a profile that's back to the built-in object deletes its file), and the watched folder only applies files that differ from what the app last wrote. Profiles that older versions kept in `settings.json` are moved to the folder once at start-up. Settings (including shortcut overrides), the worksheet library, notes and the session cache are JSON files in Electron's `userData` folder. The main process writes them atomically, through a per-file queue with unique temp names; the renderer debounces the saves.

## Security model
- `contextIsolation: true`, `nodeIntegration: false`.
- The renderer only reaches the OS through the explicit `window.pt` bridge.
- The UI is served from a custom privileged `app://` scheme with path-traversal checks and a strict CSP.
- External links open in the system browser.

## Testing & verification

```bash
npm test            # 20 tests: CSV parser, MoTeC CSV/generic CSV, laps/sectors, math engine,
                    #           .ld ↔ CSV equality (skipped if the .ld isn't on this machine)
npm run typecheck   # strict TypeScript
npm run screenshots # launches the real app headlessly, opens the sample session and saves
                    # a PNG of every worksheet + dialogs to screenshots-out/
```

Environment variables for `npm run screenshots`:
- `PT_SCREENSHOT_BROWSE=<folder>` — also capture the session browser at that folder;
- `PT_SCREENSHOT_OPEN=<file;file>` — open specific sessions instead of the sample.
- `PT_SCREENSHOT_WORKSPACE=<workspace .json>` — capture that workspace's sheets (it becomes the active workspace in the throwaway profile).

Screenshot runs use a throwaway profile and never touch your settings. At the end, the run also executes end-to-end checks (remove → undo → redo, delete worksheet → undo, editing the read-only Starter) and prints `[check] PASS/FAIL` lines.

`scripts/ensure-install.mjs` (used by both launchers) records the platform that installed `node_modules` and reinstalls if the folder was copied between Windows and macOS.

## Adding a component type

1. Add its config interface to `state/workspace.ts` and the `ComponentType` union.
2. Add defaults in `state/components.ts` (`createComponent`) and a catalogue entry.
3. Write the view in `charts/YourView.tsx`, using `useElementSize`, `prepCanvas` and `useStoreListener` for cursor-driven redraws.
4. Register it in `charts/registry.tsx` (`VIEWS` and `defaultTitle`).
5. Add its properties form to `ui/PropertiesModal.tsx` (`ComponentForm`).

## Adding a math function

Add an entry to `FUNCTIONS` in `core/math/functions.ts`. It needs a name, signature, doc, category, argument count and an `impl` over `number | Float64Array`. It appears in the editor's reference automatically.

## Packaging

`electron-builder` config lives in `package.json → build`:
- Windows: NSIS installer + zip;
- macOS: dmg + zip;
- `sample-data/` ships as an extra resource;
- the icon is `build/icon.png`, generated by `scripts/make-icon.mjs`.

CI: `.github/workflows/build.yml` builds both platforms on `workflow_dispatch` or `v*` tags and uploads the installers as artifacts.
