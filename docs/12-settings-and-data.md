# 12 · Settings & data

Open **Settings** with ⚙ in the top bar or **Ctrl/⌘ + ,**.

![Settings](images/settings.png)

| Setting | Options | Notes |
|---|---|---|
| Telemetry folder | any folder | the root of the Session Browser |
| Speed | km/h · mph · m/s | |
| Temperature | °C · °F | |
| Pressure | psi · bar · kPa | |
| Distance axis | metres · km · miles | x-axis labels in distance mode |
| Theme | Dark · Light | first row in Settings; also **View → Theme** in the menu bar, the command palette, and an optional key in Keyboard Shortcuts. Both use colour-blind-validated palettes |
| Cursor | Click to place, drag to zoom (classic) · Drag to scrub, double-click-drag to zoom · Follows mouse | see [04](04-time-distance-graph.md#cursor-zoom-pan-measure) |
| Reference lap colours | Per channel · Single lap colour | overlay laps are always solid in their lap colour; toggle with **J** |
| Smoothing | Off (raw) · On + amount (30 ms – 1 s) | **on at 50 ms by default**; also in the top bar; **S** toggles |
| Workspaces folder | — | where your workspace files live; **Open** shows it (see [03](03-workspaces-and-layout.md#the-workspaces-folder)) |
| In-game clock | Track local time · Raw UTC | see [02](02-session-browser.md#in-game-time-of-day) |
| On launch | open the session browser | |
| Session browser double-click | Add to open · Replace | switch in the browser header; also applies to drag & drop |

**Reset to defaults** restores every setting except your telemetry folder, recent files, active workspace, track profiles (corners, splits, rotation) and keyboard shortcuts. Workspaces are never touched. Shortcuts have their own reset in **Help → Keyboard Shortcuts**.

![Light theme](images/light-theme.png)

## Where things are stored

Your **workspaces** are in a visible folder so you can find, back up and share them: `Documents/Project-Trace/Workspaces/` (see [03](03-workspaces-and-layout.md#the-workspaces-folder)). Everything else lives in Project-Trace's data folder (shown in Settings; **Help → Open Settings Folder**):

| OS | Location |
|---|---|
| Windows | `%APPDATA%\Project-Trace\` |
| macOS | `~/Library/Application Support/Project-Trace/` |

| File | Contents |
|---|---|
| `settings.json` | settings, recent files, track sort, keyboard shortcuts, per-track profiles (saved rotation, mirror, corners and their ranges, splits) and in-game time zones |
| `workspaces/` | only in older versions: workspaces are copied to the Documents folder once and the originals left here as a backup |
| `worksheet-library.json` | worksheets you saved with *Worksheet → Save Worksheet to Library…* |
| `session-notes.json` | your notes, keyed by session file name |
| `session-cache.json` | cached facts about opened sessions (best valid lap, ideal lap) for the browser |

Files are written atomically (temp file + rename), so a crash can't corrupt them. Back them up or copy them to another machine (Windows ↔ macOS works). To start completely fresh, quit Project-Trace and delete the folder.

## Privacy

Project-Trace is fully offline. It never uploads data and has no telemetry of its own. It only reads the folders and files you point it at.
