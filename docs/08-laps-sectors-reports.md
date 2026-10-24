# 08 · Laps, sectors & reports

![Lap analysis worksheet](images/lap-analysis.png)

## How laps are found

Project-Trace uses the best evidence in the file, in this order:

1. **Beacons**: Telemetrick's `lapTimes` header (or MoTeC's *Beacon Markers*, or the `.ldx` markers). These are the official crossing times, so lap times match the game to the millisecond. They are used when they agree with the `Lap Number` channel.
2. **`Lap Number` changes**, refined with the lap timer (at the first sample of a new lap, `Lap Time` reads the time since crossing, which is subtracted).
3. **`Lap Distance` resets**.
4. Otherwise the whole file is one lap.

**Numbering follows MoTeC**: lap 1 is the first (partial) lap of the log. The sample file's laps are therefore 1 (out), 2, 3, 4 (invalid), **5 (best, 1:41.424)**, 6 (in).

| Tag | Meaning |
|---|---|
| **OUT** | the log started mid-lap or in the pits; this lap didn't start on the line |
| **IN** | the log ended with the car stopped (pit entry) |
| **PART** | the log ended mid-lap while moving |
| **INV** | AC's `Lap Invalidated` flag was set during the lap (track limits, cuts) |
| **BEST** | fastest complete, **valid** lap (falls back to the fastest lap if none are valid) |

## Reference and overlay laps

| In the sidebar or lap report | Effect |
|---|---|
| **Click** a lap | show only this lap (it becomes the reference) |
| **Ctrl/⌘ + click** (or the checkbox) | add/remove it as an overlay |
| **Shift + click** (or ☆) | make it the **reference** (keeps the others) |
| **F** | fastest lap as reference |
| **↑ / ↓** (or PgUp / PgDn, [ / ]) | step the reference to the previous/next lap |
| *Whole session* | view the entire outing on a session-time axis |
| **Clear overlays** | keep only the reference |

**Lap colours**: each selected lap gets a colour that stays with it. **Right-click a selected lap's coloured square** (or right-click the lap → *Lap colour…*); a plain click on the square removes the lap. The reference is blue and the first comparison lap white by default. The picker offers any colour from the palette, a custom colour picker or a hex value. Overlay laps are drawn in their colour on every graph, map and report; the reference lap uses channel colours or its lap colour (toggle with **J**, see [04](04-time-distance-graph.md#lap-colours)).

The **reference** is what variance, gain/loss maps and corner deltas compare against. It is drawn on top in every chart and listed first in reports. Opening a session selects its fastest valid lap. Opening a *second* session adds its fastest lap as an overlay, so comparing two runs takes one action.

## Sectors

Telemetrick's `Last Sector Time` channel only updates once per second, but the values are exact. Project-Trace reconstructs each lap's sectors by finding the run of consecutive sector times that sums exactly to the lap time, then locates the **split points on track** (the median across laps). For the sample: S1 32.008 + S2 42.759 + S3 28.355 = 103.122 s, with splits at 1695 m and 3480 m.

- Laps where the game's values can't be matched (e.g. out laps) get sector times measured from the split crossings.
- A sector is only shown when the lap covers it fully.
- **Ideal lap** = sum of the best sectors from valid laps.

## Lap report and Stint report

Two components show lap and sector times:

| Component | Shows |
|---|---|
| **Lap Report** | only the **selected laps** — the reference first, then the comparison laps |
| **Stint Report** | every lap of each **stint (session) that has a selected lap** — open a second session and it only appears once you select one of its laps |

![Lap report with sectors as Δ to the reference](images/lap-report-delta.png)

| Column | |
|---|---|
| swatch / Lap | the lap's colour if selected (outlined = reference); the lap cell is tinted in the lap's colour |
| Time | lap time (struck through if invalid, grey if incomplete) |
| Δ ref / Δ best | Lap Report: gap to the reference · Stint Report: gap to the fastest lap |
| S1…Sn | sector or section times |
| V max | maximum speed (in your speed unit) |
| Fuel | fuel used during the lap |

**Best times fill the cell**: **green** = the best in that stint, **purple** = the best of every lap open at this track (with one session they are the same, so bests are purple).

**Absolute / Δ to ref** (Lap Report, next to the split buttons): show the comparison laps' sectors as times (default) or as the difference to the reference's sectors, e.g. **+0.321** (red = slower, green = faster).

The Stint Report's last row is the **Ideal** lap. Switch the split columns between **Game sectors**, **Custom sections** (from your splits, see [05](05-track-map.md)) and **None**. Columns (Δ, splits, ideal row, tags, max speed & fuel) can be switched off in Properties.

## Lap colours in side-by-side data

Wherever laps are compared side by side — the Channel Report, Corner Report, graph legends, histogram zone tables, gauges and the GPS track's offset readout — each lap's values sit on a **translucent background in that lap's colour** (blue reference, white first comparison, …), so you can tell the columns apart at a glance.

## Channel report

A table of statistics for chosen channels for every selected lap (or only the zoomed range), each lap's columns tinted in its colour.
- Statistics: **min, max, avg, std, start, end**.
- Add channels with **+ Add channel** or by dragging from the sidebar; remove with ×.
- Values are in your display units with each channel's decimal places.

## Other stint-level components

The **Lap Trend** and **Session & Setup** components also only show stints that have a selected lap.

## Corner report

The corner report uses **the corners you define for the track**. Nothing is generated automatically; see [05](05-track-map.md#corners-sections-and-the-track-profile). Until a track has corners, the report explains how to add them and offers two buttons: **Open track profile editor**, and an optional **Suggest from speed minima** that proposes corners at the reference lap's slowest points for you to keep, rename or delete.

Each corner is analysed over a window from halfway to the previous corner to halfway to the next, capped at ±200 m from the apex you set — or over the **exact range** you give it in advanced mode (track profile → *Advanced: exact start / end distance for each corner*). Everything that isn't inside a corner is a **straight** (named after its neighbours, e.g. *T3 → T4*; the first and last run to the start/finish line). Edit corners in Properties or **Analysis → Track Profile…**.

![Corner report](images/basic-fa26.png)

| Metric | |
|---|---|
| Time in corner (first, default) | time from entry to exit |
| Min speed | lowest speed in the range |
| Entry speed | speed at the start of the range |
| Exit speed | speed at the end of the range |

At the top, **Total time** sums each lap's time **in corners** and **on straights**, with the gain/loss against the reference — so you can see at once whether time is lost in the corners or down the straights. Below, each corner and straight is listed with the chosen metric; each lap's column is tinted in its colour, and the delta to the reference is green (better) or red (worse), plus a "best − ref" column. Straights and totals can be hidden in Properties. **Click a row** to zoom all graphs to it in distance mode.
