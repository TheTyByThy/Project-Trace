# 02 · Session browser

The Session Browser (**Ctrl/⌘ + O**, **File → Session Browser…**, or **+ Compare session** in the sidebar) is how you find and open runs. It reads only the first ~96 KB of each file, so even folders with hundreds of 80 MB exports list instantly.

![Track cards](images/session-browser-tracks.png)

## Folder levels

Telemetrick saves exports as `exported/<Driver>/<car>/<track>/<files>`. Project-Trace shows:

- **Folder cards** for any sub-folders, most recently driven first. Track folders display a prettified name:
  - prefixes like `fn_`, `rt_`, `acu_`, `ks_`, `00_` are stripped;
  - the layout after the first `-` becomes the subtitle;
  - known acronyms (F1, GP, GT3, CSP…) are capitalised.
  So `fn_hungaroring-layout_f1_2026` reads **Hungaroring · F1 2026**. The raw folder name is shown underneath.
- Each card shows the **number of sessions** (an export that has both `.csv` and `.ld` counts once) and **when you last drove** there. The track you last opened is outlined.
- **Sort** the cards with the control above them: **Last driven** (default), **Name A–Z**, **Most sessions** or **Oldest first**. Your choice is remembered. The **Filter sessions…** box also filters track cards by name.
- A **breadcrumb** trail lets you step back up to your telemetry folder.

## Telemetry folders

The **Telemetry folders** list on the left holds named shortcuts to any number of folders — e.g. one per driver, an older install, or a team-mate's shared exports.

- **+ Add folder…** picks a folder and asks for a name.
- **Click** a folder to browse it. The first folder is the **default** (the one Settings shows and the browser starts in).
- **Right-click** a folder to **Rename…** it, **Change folder…** (point it somewhere else), **Make default**, show it in Finder / Explorer, or **Remove shortcut** (the folder on disk is untouched).

Project-Trace remembers the last folder you opened a session from. Next launch it opens **one level above** (your track list) so you can pick a track straight away.

## The session table

![Session table](images/session-browser-sessions.png)

| Column | Meaning |
|---|---|
| **Saved** | When the export was written (from the file header; falls back to the file name/date). Tag shows `csv` or `ld`. |
| **In-game** | The **time of day in the sim** at the start of the session (see below). |
| **Driver** | Driver name from the file. |
| **Car** | Car folder name prettified, plus the livery/team. |
| **Laps** | Complete laps / total laps (the first lap of a log is normally a partial out lap). |
| **Best lap** | Fastest complete lap from the header, with its lap number. The fastest in the folder is highlighted. |
| **Best valid** | Fastest lap that **wasn't invalidated**. AC's invalid flag is only known after reading the whole file, so this fills in once you've opened the session (it's cached). `?` = not opened yet. |
| **Duration** | Length of the log. |
| **Air / track** | Ambient and track temperatures at the start. |
| **Size** | File size. |

Click a column header to sort. Type in **Filter sessions…** to search by driver, car, track or file name.

### Selecting & opening (comparing several sessions)
There's no limit on how many sessions you can have open: your own stints, another driver's sessions, other days.

- **Tick sessions in as many folders as you like.** The selection is a basket that **survives browsing** to other tracks, cars or drivers, and the footer shows e.g. *"4 sessions selected from 2 folders"*. Plain click picks a session in the current folder; **Ctrl/⌘ + click** or the checkbox adds or removes; **Shift + click** selects a range. **Clear selection** empties the basket.
- With nothing open, **Open** opens the whole selection together.
- With sessions already open you get two buttons: **Add N to open** (keeps everything open and adds the new ones) and **Replace open sessions** (closes the current ones first).
- **Double-click** opens a single session. While sessions are open, the **Double-click: Add to open | Replace** switch in the header decides what it does; the default is **Add**. The same choice applies to *Recent sessions*, *Open files…* and dragging files onto the window (hold Shift to do the opposite).
- The **Open now** list (left column) shows every loaded session (driver · track · date) with ✕ to close it. Sessions already open are tagged **open** in the table.

Each newly added session's fastest lap is overlaid automatically. Ctrl/⌘ + click more laps in the sidebar, where every session has its own card headed by the driver's name.

### Details pane
Selecting a row shows:
- track, layout, car and livery, driver;
- saved time, in-game time (local and UTC), duration;
- weather (sky, air and track temperature) and starting fuel;
- **every lap time** in the file, with the best highlighted;
- **Open**, **Add to comparison** and **Show file** buttons.

## In-game time of day

Telemetrick records CSP's sim clock as a **UTC timestamp** (`UTC Time` channel). CSP already applies the circuit's time zone, so to show the clock you'd see in game, Project-Trace converts it back into the **track's local zone**.

- Known circuits are recognised automatically: Singapore → *Asia/Singapore*, Suzuka → *Asia/Tokyo*, COTA → *America/Chicago*, Spa → *Europe/Brussels*, Hungaroring → *Europe/Budapest*, and ~40 more. Daylight saving follows the in-game date.
- For fictional or unrecognised tracks the time shows in UTC. Choose the right zone in the details pane (**In-game clock time zone for this track**). The choice is remembered per track.
- If you'd rather see the raw value, set **Settings → In-game clock → Raw UTC**.

> Example: the sample Singapore session's clock reads 11:01 UTC, displayed as **19:01** Singapore time, the night-race slot.

## Live updates

While a track folder is open, Project-Trace **watches it**. Save a new export from Telemetrick and it appears in the list a second or two later ("● watching for new exports").

## Live mode: open new runs automatically

With **Settings → Live mode → Open new exports automatically** on, you don't need the browser at all between runs. Leave Project-Trace open, drive, and when Telemetrick writes the export it opens by itself.

- **What's watched:** every telemetry folder in the browser's list, and everything inside them, so a new track or car folder is picked up too. A file is opened once it has stopped growing for a couple of seconds; a MoTeC `.ld` waits for its `.ldx` lap file. If Telemetrick writes a `.csv` and an `.ld` of the same run, it's opened once. Files that were already there when Live mode started are never opened.
- **New session:**
  - **Add to the open sessions** (default): the new run joins what's open, and its fastest lap becomes an overlay on your current reference. This is the way to compare stint after stint.
  - **Replace them:** you always look at just the latest run.
- **Only while a sim is running** (off by default): exports are only opened while a chosen sim is running, or was within the last 15 minutes, since the export is often written as you quit. Tick **Assetto Corsa** (`acs.exe`), **Assetto Corsa Competizione**, or type other program names. Use this if a team-mate's files get synced into your folders and you don't want them popping open. Leave it off if your telemetry syncs from the sim PC to a different analysis computer, because the sim never runs there.
- **It never takes focus from the sim.** The taskbar or Dock icon flashes, and a toast says which run was opened.
- A **● Live** pill in the top bar shows it's on: green when watching, amber while it waits for a sim, grey when no folder is set. Click it to open Settings.

## MoTeC `.ld` files

Telemetrick also writes a MoTeC `.ld` log (plus `.ldx` lap/setup sidecar) for every export, and older sessions may only exist in that format. Project-Trace lists and opens them too:
- in-game time comes from the first `UTC Time` sample;
- laps come from the `.ldx` beacons.

When a folder has both a `.csv` and an `.ld` for the same export, only one row is shown and the CSV is opened. See [11 · File formats](11-file-formats.md).

## Other ways in
- **Open files…** (top right) opens any CSV/`.ld` via the system file dialog.
- **Recent sessions** (left column) re-opens with one click.
- **Bundled sample session** opens the `sample-data/` folder.
- Drag files onto the main window at any time.
