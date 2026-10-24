<p align="center"><img src="docs/images/icon.png" width="96" alt="Project-Trace logo"></p>

<h1 align="center">Project-Trace</h1>

<p align="center"><b>MoTeC-style telemetry analysis for Assetto Corsa, built for Telemetrick CSV exports.</b><br>
Runs on <b>Windows</b> and <b>macOS</b>. Free, offline, no account.</p>

![Overview worksheet](docs/images/overview.png)

Project-Trace is a desktop data-analysis tool modelled on MoTeC i2 Pro. Point it at your Telemetrick export folder, pick a track, pick a session, and you get MoTeC's core tools:

- time/distance graphs with lap overlays and time variance
- track maps from car coordinates
- scatter plots, histograms and mixture maps
- math channels
- reports and gauges
- fully customisable workspaces

It reads the CSV files Telemetrick writes, and also opens Telemetrick's MoTeC `.ld` logs, so your whole history is usable, not just recent CSV exports.

---

## Contents

- [Quick start](#quick-start)
- [What you can do](#what-you-can-do): a tour of every feature
- [The default workspace](#the-default-workspace)
- [Documentation](#documentation): detailed guides per feature
- [Building installers](#building-installers-exe--dmg)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

---

## Quick start

### 1. Install Node.js (one time)

Download the **LTS** version from <https://nodejs.org> and install it with the default options. This is the only prerequisite on both Windows and macOS.

### 2. Launch Project-Trace

| Windows | macOS |
|---|---|
| Double-click **`Start Project-Trace (Windows).bat`** | Double-click **`Start Project-Trace (macOS).command`**. The first time, *right-click → Open* to get past Gatekeeper. If macOS says it isn't executable, run `bash start-mac.sh` in Terminal from this folder. |

The first launch installs everything automatically (about a minute, needs internet). After that it starts in a few seconds.

> Developers can also use `npm install` then `npm start` (or `npm run dev` for hot reload).

### 3. Point it at your telemetry

On first launch the **Session Browser** opens. Click **Choose telemetry folder…** and pick any level of Telemetrick's export tree:

```
Documents\Assetto Corsa\apps\telemetrick\exported\           ← all drivers
    Lewis Hamilton\                                          ← one driver
        vrc_formula_alpha_2026_csp\                          ← one car  (recommended)
            singapore_2020-layout_f1_2026\                   ← tracks: the sessions live here
                24102026-152530-…-singapore_2020-layout_f1_2026.csv
```

If Telemetrick's default folder exists, Project-Trace detects it and offers **Use detected folder**. Click a track card, then double-click a session to open it. Project-Trace remembers where you were, so next time you land straight on your track list.

No telemetry yet? Click **Bundled sample session** to explore a 6-lap Singapore run in the Formula Alpha 2026.

---

## What you can do

### Session browser: find the right run fast
![Session browser — tracks](docs/images/session-browser-tracks.png)

- **Track cards**, most recently driven first, with prettified names (`singapore_2020-layout_f1_2026` → **Singapore 2020 · F1 2026**), session counts and "last driven" times.
- **Session table** for each track, showing:
  - when the file was **saved**;
  - the **in-game time of day**, converted to the circuit's local time zone;
  - driver, car and livery;
  - complete laps and **best lap** (with lap number);
  - **best valid lap** (once a session has been opened);
  - duration, air/track temperature and file size.
- A **details pane** with every lap time, the weather, starting fuel and a per-track time-zone override.
- **Live folder watching**: new exports appear automatically while you drive.
- Select several sessions to open them **overlaid for comparison**, or drag CSV files straight onto the window.

→ [Session browser guide](docs/02-session-browser.md)

### Time / distance graphs: the heart of MoTeC
![Zoom and range measurement](docs/images/zoom-measure.png)

- Stacked **panes** that share the x-axis. Channels with the same unit share a scale ("tiled"); switch any pane to independent scales ("overlapped").
- **Lap overlays** in stable, colour-blind-safe colours with dash patterns. The **reference lap** (★) is drawn on top.
- **Time variance** pane (F3): where you gain and lose time against the reference.
- **Time ⇄ Distance** x-axis (D). Laps align on track position using the game's lap distance.
- Click for the **cursor** (live values in every legend), drag to **zoom**, Shift-drag to **measure** a range (min / avg / max / Δ for every channel), scroll to zoom, right-drag to pan.
- **Sector lines**, custom **section** markers and auto-detected **corner** markers.
- **Drag channels** from the sidebar onto any pane, drag pane borders to resize, and right-click for every option.

→ [Graph guide](docs/04-time-distance-graph.md)

### Track map: built from your car's coordinates
![Driver worksheet with gain/loss track map](docs/images/driver.png)

- Drawn from `Car Coord X/Y`, or projected from GPS latitude/longitude in other CSVs.
- **Colour by any channel** (speed, throttle, brake, gear, elevation…), **by lap**, or by **time gained/lost** against the reference.
- **Corners detected automatically** (T1, T2…) and renameable. S/F, sector and custom section markers.
- Cursor dots for every overlaid lap. **Click the map to jump the cursor there.** Zoom, pan, rotate and mirror (saved per track).
- Highlights the zoomed range of the graphs.

→ [Track map guide](docs/05-track-map.md)

### XY charts
| Scatter (with fits) | Histograms & mixture maps |
|---|---|
| ![Aero](docs/images/aero.png) | ![Suspension](docs/images/suspension.png) |

- **Scatter / XY plots**: any channel against any other. Colour by lap or by a third channel. Linear/quadratic/cubic **fits with R²**, MoTeC-style **X-interval averages**, a **gate** channel ("only while braking"), and an equal-aspect **G-G diagram** with friction circles.
- **Histograms**: % of time per bin for every lap, with **zone breakdowns** (e.g. damper velocity fast/slow bump/rebound).
- **Mixture maps**: 2-D histograms (RPM × throttle) showing % of time or the mean/min/max of a third channel.
- **FFT**: frequency spectrum for ride and damper analysis.
- **Lap trend**: any statistic per lap across the session (lap time, tyre temperature, fuel…).

→ [XY charts guide](docs/06-xy-charts.md)

### Math channels, just like MoTeC
![Math editor](docs/images/math-editor.png)

- MoTeC-compatible syntax: `'Ground Speed' [m/s]`, `choose(cond, a, b)`, `derivative()`, `integrate(x, cond)`, `smooth()`, `stat_mean()`, `sgn()`, `sqr()`… **60 functions** in all.
- Live validation (the error position is highlighted), a preview sparkline with min/avg/max on the reference lap, a click-to-insert function reference and channel list, and user **constants**.
- **30 ready-made channels**: combined G, damper velocities, tyre temperature average and spread, rake, aero balance, coasting, throttle/brake overlap, lock-ups, wheelspin, fuel per lap…
- Math channels can use other math channels. They're saved in the workspace and recomputed for every open session.

→ [Math channel guide](docs/07-math-channels.md)

### Laps, sectors & reports
![Lap analysis](docs/images/lap-analysis.png)

- **Exact lap times** from the export's beacons, and **exact sector times** reconstructed from the game's sector timer, with sector split points located on track.
- **Out, in, partial and invalid laps** flagged (from AC's `Lap Invalidated`). Fastest valid lap is chosen automatically.
- **Lap report**: lap and sector times, purple session-best sectors, the **ideal lap**, Δ to best, max speed and fuel used.
- **Custom sections**: drop split points anywhere on the track map and get section times for every lap.
- **Channel report** (min/max/avg/std per lap), **corner report** (min, entry and exit speed or time per corner, with deltas to the reference; click a corner to zoom to it).

→ [Laps & reports guide](docs/08-laps-sectors-reports.md)

### Instruments
| Tyres & brakes | Gauges, mixture map, histogram |
|---|---|
| ![Tyres](docs/images/tyres.png) | ![Engine](docs/images/engine-ers.png) |

- **Tyres & brakes**: a four-corner panel with inner/middle/outer and core temperatures, pressures, brake disc temperature, load and slip, at the cursor or as lap mean/max.
- **Driver inputs**: pedal bars, a rotating steering wheel, gear, speed and RPM, with a ghost of the compare lap.
- **Gauges**: dial, bar and digital gauges driven by the cursor.
- **Session & setup**: every session detail, the **full car setup sheet** (side by side with differences highlighted when comparing sessions) and **notes** saved per session.

→ [Instruments guide](docs/09-instruments.md)

### Custom workspaces, worksheets & layouts
- A **workspace** holds **worksheets** (tabs); each worksheet is a free layout of **components**.
- Add any of 14 component types and **drag headers to dock** them anywhere (edges split, centre swaps). Drag gaps to resize, double-click to maximise.
- Rename, duplicate, reorder and delete worksheets. Create, duplicate, **export and import** workspaces to share with friends.
- Every change saves automatically.

→ [Workspaces guide](docs/03-workspaces-and-layout.md)

### Quality of life
- **Command palette** (Ctrl/⌘ + K) and a full set of [keyboard shortcuts](docs/10-keyboard-and-mouse.md).
- **Units**: km/h · mph · m/s, °C · °F, psi · bar · kPa, metres · km · miles.
- **Dark and light themes** with colour-blind-validated palettes.
- **Export** the visible range to CSV (Ctrl/⌘ + E) and save **screenshots** (Ctrl/⌘ + Shift + S).
- **Opens MoTeC `.ld` logs** (Telemetrick writes one beside every export) as well as MoTeC CSV and generic CSV.
- **Multi-session comparison**: overlay laps from different files, compare setups, and see trends per session.

---

## The default workspace

Project-Trace ships with a **Formula — Default** workspace with nine worksheets:

| Worksheet | What's on it |
|---|---|
| **Overview** | Speed, throttle/brake, gear, steering, RPM + variance · speed-coloured track map · lap times |
| **Driver** | Inputs + steering rate + coasting/overlap · **gain/loss track map** · driver inputs · G-G diagram · corner report |
| **Tyres** | Tyre temperatures, pressures, slip angle/ratio, load · tyres & brakes panel · temperature by lap · tyre summary |
| **Brakes** | Speed, brake, brake temps, lock-up/wheelspin, decel · brake-pressure track map · brake vs decel scatter · brake temp report |
| **Suspension** | Ride heights, damper travel, roll, pitch, rake · four damper-velocity histograms · ride-frequency FFT |
| **Aero** | Downforce F/R, drag, aero balance, ride heights · downforce-vs-speed (quadratic fit) · balance vs front ride height |
| **Engine & ERS** | RPM, gear, KERS charge/deploy, boost, power · gauges · RPM × throttle mixture map · gear usage |
| **Lap Analysis** | Lap report · lap-time trend · lap statistics · corner report |
| **Session & Setup** | Session details / full setup / notes · elevation-coloured track map · fuel by lap |

Make it your own: everything is editable, and **▦ Workspace → New from default template** always gives you a fresh copy.

---

## Documentation

| Guide | |
|---|---|
| [01 · Getting started](docs/01-getting-started.md) | Installation on Windows/macOS, first run, opening sessions |
| [02 · Session browser](docs/02-session-browser.md) | Folders, the session table, in-game time zones, comparison |
| [03 · Workspaces & layout](docs/03-workspaces-and-layout.md) | Workspaces, worksheets, components, docking, sharing |
| [04 · Time/distance graph](docs/04-time-distance-graph.md) | Panes, scales, overlays, variance, cursor, zoom, measure |
| [05 · Track map](docs/05-track-map.md) | Colouring, gain/loss, corners, sections, rotation |
| [06 · XY charts](docs/06-xy-charts.md) | Scatter, histogram, mixture map, FFT, lap trend |
| [07 · Math channels](docs/07-math-channels.md) | Syntax, every function, constants, the default library |
| [08 · Laps, sectors & reports](docs/08-laps-sectors-reports.md) | Lap detection, validity, sectors, ideal lap, reports |
| [09 · Instruments](docs/09-instruments.md) | Gauges, driver inputs, tyres & brakes, session & setup |
| [10 · Keyboard & mouse](docs/10-keyboard-and-mouse.md) | Every shortcut |
| [11 · Supported file formats](docs/11-file-formats.md) | Telemetrick CSV, MoTeC .ld/.ldx, MoTeC CSV, generic CSV |
| [12 · Settings & data](docs/12-settings-and-data.md) | Units, themes, where settings and workspaces are stored |
| [13 · Architecture (developers)](docs/13-architecture.md) | Code structure, data flow, tests, adding components |

---

## Building installers (.exe / .dmg)

Running from source is all most people need. To produce a standalone app that doesn't need Node.js:

```bash
npm install
npm run dist:win    # on Windows → release/Project-Trace Setup 1.0.0.exe + portable .zip
npm run dist:mac    # on a Mac   → release/Project-Trace-1.0.0.dmg + .zip
```

macOS installers must be built on a Mac. The included GitHub Actions workflow (`.github/workflows/build.yml`) builds both automatically: push the repo to GitHub, open **Actions → Build installers → Run workflow**, and download the installers from the run's artifacts. Builds are unsigned, so on macOS right-click → **Open** the first time.

---

## Project layout

```
Project-Trace/
├─ Start Project-Trace (Windows).bat   ← double-click launchers
├─ Start Project-Trace (macOS).command
├─ electron/          main process (window, file access, menus) + preload bridge
├─ src/
│  ├─ core/           parsers (CSV, .ld), session/lap model, math engine, units, stats
│  ├─ state/          app store, workspaces, layout tree, default workspace & math
│  ├─ charts/         every component (canvas-rendered charts, reports, instruments)
│  ├─ ui/             app shell: browser, sidebar, inspector, math editor, dialogs
│  └─ workers/        background CSV/.ld parsing
├─ tests/             parser, math engine and .ld↔CSV cross-check tests
├─ sample-data/       a real Telemetrick export to try
├─ docs/              these guides + screenshots
└─ scripts/           launcher, dev server, screenshot automation, icon generator
```

Useful commands: `npm test` (unit tests), `npm run typecheck`, `npm run dev` (hot reload), `npm run screenshots` (captures every worksheet to `screenshots-out/`).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Node.js is not installed" | Install the LTS version from nodejs.org, then run the launcher again. |
| macOS: "cannot be opened because it is from an unidentified developer" | Right-click the `.command` file (or the app) → **Open** → **Open**. |
| macOS: launcher opens in a text editor / isn't executable | In Terminal: `cd` into the folder and run `bash start-mac.sh` (or `chmod +x "Start Project-Trace (macOS).command"`). |
| Window doesn't appear when started from a VS Code terminal | Use `npm start` (not `electron .`); it clears VS Code's `ELECTRON_RUN_AS_NODE` variable. |
| A track folder shows no sessions | Project-Trace lists `.csv` and `.ld` files. Check Telemetrick is exporting into that folder. |
| The in-game time looks off by some hours | Pick the right zone for that track in the Session Browser's details pane, or set **Settings → In-game clock → Raw UTC**. |
| The track map is mirrored or rotated | Right-click the map → **Mirror** / **Rotate 90°** (saved per track). |
| A math channel says "n/a" | The session doesn't contain one of its input channels (normal for non-AC data). |

---

*Project-Trace is an independent project and is not affiliated with MoTeC Pty Ltd, Kunos Simulazioni or the Telemetrick developers. "MoTeC" is used only to describe the style of analysis.*
