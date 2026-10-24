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
| **PgUp / PgDn** or **[ / ]** | step the reference to the previous/next lap |
| *Whole session* | view the entire outing on a session-time axis |
| **Clear overlays** | keep only the reference |

The **reference** is what variance, gain/loss maps and corner deltas compare against. It is drawn on top in every chart and listed first in reports. Opening a session selects its fastest valid lap. Opening a *second* session adds its fastest lap as an overlay, so comparing two runs takes one action.

## Sectors

Telemetrick's `Last Sector Time` channel only updates once per second, but the values are exact. Project-Trace reconstructs each lap's sectors by finding the run of consecutive sector times that sums exactly to the lap time, then locates the **split points on track** (the median across laps). For the sample: S1 32.008 + S2 42.759 + S3 28.355 = 103.122 s, with splits at 1695 m and 3480 m.

- Laps where the game's values can't be matched (e.g. out laps) get sector times measured from the split crossings.
- A sector is only shown when the lap covers it fully.
- **Ideal lap** = sum of the best sectors from valid laps.

## Lap report

| Column | |
|---|---|
| swatch | the lap's colour if selected (outlined = reference) |
| Lap | number and tags |
| Time | lap time (struck through if invalid, grey if incomplete) |
| Δ best | gap to the fastest lap |
| S1…Sn | sector or section times; **purple bar = best in session** |
| V max | maximum speed (in your speed unit) |
| Fuel | fuel used during the lap |

The last row is the **Ideal** lap. Switch the split columns between **Game sectors**, **Custom sections** (from your track-map splits, see [05](05-track-map.md)) and **None**. With several sessions loaded, each gets its own table.

## Channel report

A table of statistics for chosen channels for every selected lap (or only the zoomed range).
- Statistics: **min, max, avg, std, start, end**.
- Add channels with **+ Add channel** or by dragging from the sidebar; remove with ×.
- Values are in your display units with each channel's decimal places.

## Corner report

Corners are **detected automatically** on the reference lap as significant minima in speed vs distance (≥ 8 km/h or 6 % drop and recovery, merged within 60 m). Fast kinks taken flat are not corners by this definition, so numbering can differ from the official one. **Double-click a corner name to rename it** (e.g. "T7 Turn 7 / Memorial"); names are stored per track and shown on graphs and maps.

| Metric | |
|---|---|
| Min speed | apex speed |
| Entry speed | speed at the braking point (the preceding speed peak) |
| Exit speed | speed at the following speed peak |
| Time in corner | time from entry to exit |

For each overlay lap the delta to the reference is shown in blue (better) or red (worse), plus a "best − ref" column. **Click a corner** to zoom all graphs to it in distance mode.
