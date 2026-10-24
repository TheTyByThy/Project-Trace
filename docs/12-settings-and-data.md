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
| Theme | Dark · Light | both use colour-blind-validated palettes |
| Cursor | Click to place (MoTeC) · Follows mouse | |
| Overlay colouring | Auto · By lap · By channel | see [04](04-time-distance-graph.md#laps-on-the-graph) |
| In-game clock | Track local time · Raw UTC | see [02](02-session-browser.md#in-game-time-of-day) |
| On launch | open the session browser | |

**Reset to defaults** restores every setting except your telemetry folder, recent files and active workspace. Workspaces are never touched.

![Light theme](images/light-theme.png)

## Where things are stored

Everything lives in Project-Trace's data folder (shown in Settings; **Help → Open Settings Folder**):

| OS | Location |
|---|---|
| Windows | `%APPDATA%\Project-Trace\` |
| macOS | `~/Library/Application Support/Project-Trace/` |

| File | Contents |
|---|---|
| `settings.json` | settings, recent files, per-track profiles (rotation, mirror, custom sections, corner names) and in-game time zones |
| `workspaces/*.json` | one file per workspace (worksheets, layouts, components, math channels, constants, channel properties) |
| `session-notes.json` | your notes, keyed by session file name |
| `session-cache.json` | cached facts about opened sessions (best valid lap, ideal lap) for the browser |

Files are written atomically (temp file + rename), so a crash can't corrupt them. Back them up or copy them to another machine (Windows ↔ macOS works). To start completely fresh, quit Project-Trace and delete the folder.

## Privacy

Project-Trace is fully offline. It never uploads data and has no telemetry of its own. It only reads the folders and files you point it at.
