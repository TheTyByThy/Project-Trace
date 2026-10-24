# 01 · Getting started

This guide takes you from a fresh download to analysing your first lap on **Windows** or **macOS**.

## Requirements

| | Windows | macOS |
|---|---|---|
| OS | Windows 10 or 11 (64-bit) | macOS 11 Big Sur or newer (Intel or Apple Silicon) |
| Software | [Node.js LTS](https://nodejs.org) | [Node.js LTS](https://nodejs.org) |
| Disk | ~500 MB after the first run | ~500 MB after the first run |
| Memory | 4 GB+ (8 GB recommended for long sessions) | same |

Node.js is only needed when running from source. The optional installers (see below) bundle everything.

## Install & launch

### Windows
1. Install **Node.js LTS** from <https://nodejs.org> (accept the defaults).
2. Double-click **`Start Project-Trace (Windows).bat`** in the Project-Trace folder.
3. The first run downloads and installs Project-Trace's components (~1 minute). A console window shows progress; leave it open while you use the app.

### macOS
1. Install **Node.js LTS** from <https://nodejs.org>.
2. **Right-click** `Start Project-Trace (macOS).command` → **Open** → **Open**. The right-click is only needed the first time, to satisfy Gatekeeper.
3. If macOS complains the file isn't executable (this can happen when the folder came from a zip), open **Terminal**, `cd` into the folder and run:
   ```bash
   bash start-mac.sh
   ```
   or make the launcher executable once with `chmod +x "Start Project-Trace (macOS).command"`.

### From a terminal (both platforms)
```bash
npm install     # once
npm start       # builds the UI and launches the app
npm run dev     # development mode with hot reload
```

> **Why not `electron .`?** Terminals inside VS Code set `ELECTRON_RUN_AS_NODE=1`, which stops Electron opening a window. `npm start` goes through `scripts/launch.mjs`, which clears it.

## First run

When Project-Trace opens for the first time you'll see the **Session Browser** with a welcome panel:

- **Choose telemetry folder…** — pick your Telemetrick export folder. Any level works:
  `exported` (all drivers), a driver folder, or a single car folder (the most convenient).
- **Use detected folder** — shown when `Documents/Assetto Corsa/apps/telemetrick/exported` exists.
- **Browse the sample session** — a real 6-lap Singapore session that ships in `sample-data/`.

Then:
1. Click a **track card**.
2. **Double-click** a session (or select one and press **Open**).
3. Project-Trace opens it with the **fastest valid lap as the reference** and shows the *Overview* worksheet.

## Your first analysis in 60 seconds

1. **Overlay another lap**: in the left sidebar, **Ctrl/⌘ + click** a second lap. It appears in a new colour and the **time variance** pane shows where you gained or lost time.
2. **Place the cursor**: click anywhere on a graph. Every legend, gauge, the track map dot and the channel list update to that point.
3. **Zoom**: drag across a corner on the graph. Press **Esc** to zoom out.
4. **Measure**: hold **Shift** and drag. Each legend shows min / avg / max / Δ over the range.
5. **Switch axis**: press **D** to toggle between distance and time.
6. **Explore worksheets**: use the tabs (or keys **1–9**): Driver, Tyres, Brakes, Suspension, Aero, Engine & ERS, Lap Analysis, Session & Setup.
7. **Add a channel**: open the **Channels** tab in the sidebar and drag any channel onto a graph pane.

## Opening files other ways

- **File → Open CSV Files…** (Ctrl/⌘ + Shift + O) opens files directly.
- **Drag & drop** CSV or `.ld` files onto the window. Hold **Shift** while dropping to *add* them for comparison.
- **Recent sessions** are listed in the Session Browser's left column.
- On Windows you can also pass files on the command line: `npm start -- "C:\path\file.csv"`.

## Building a standalone app

To give Project-Trace to someone without Node.js:

```bash
npm run dist:win    # Windows installer + portable zip   (run on Windows)
npm run dist:mac    # macOS .dmg + zip                    (run on a Mac)
```

Output goes to `release/`. You can also build both in the cloud with the included GitHub Actions workflow: **Actions → Build installers → Run workflow**.

Next: [02 · Session browser](02-session-browser.md)
