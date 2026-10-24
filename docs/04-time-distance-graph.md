# 04 · Time / distance graph

The graph is the core of Project-Trace, equivalent to MoTeC's Time/Distance Graph.

![Overview graph](images/overview.png)

## Panes and scales

A graph is a stack of **panes** sharing one x-axis. Each pane holds one or more channels.

| Pane scale | Behaviour | MoTeC term |
|---|---|---|
| **Auto** (default) | Shared scale if all channels have the same unit, otherwise independent | — |
| **Shared** | One y-axis for every channel in the pane | Tiled |
| **Independent** | Each channel is scaled to fill the pane; the axis shows the first channel | Overlapped |

**Pane heights**: hover over the border between two panes (the variance pane included) until it highlights, then **drag up or down**. You can also set heights with the sliders in Properties.

The y-range of each channel is either the **whole lap** (the default; stable while zooming) or the **visible area**. Fixed ranges come from *Channel properties* or a pane's shared min/max (Properties).

## Lap colours

Like MoTeC:

- **Overlay laps** are always drawn **solid in their lap colour**, for every channel. Each lap's colour stays put while it's selected.
- The **reference lap** (★) is drawn on top, either:
  - in **per-channel colours** (speed blue, throttle green, brake red…), the default; or
  - entirely in **its lap colour**.

  Press **J** (or **Analysis → Reference Lap in Channel Colours**, or Settings) to toggle. The status bar shows the current mode.
- **Change any lap's colour**: right-click its coloured square in the sidebar (or right-click the lap → *Lap colour…*). Clicking the square of a selected lap removes it. The first comparison lap is white by default. The picker offers palette swatches, a full custom colour picker and a hex field.
- **Channel colours** (used by the reference lap) are set in *Channel properties*.

![Reference lap in lap colour](images/ref-lap-colour.png)

## Legends: values and deltas

Each pane's legend lists its channels with their value at the cursor for every lap. Each lap's value sits on a **translucent background in that lap's colour** (blue reference, white first comparison…). For overlay laps it also shows the **Δ to the reference lap**, e.g. `Ground Speed [km/h]  236.1   237.0 Δ+0.9`. While measuring a range (Shift-drag) the legend shows **min / avg / max / Δ** over the range instead.

## X axis: time or distance

Press **D** or use the **Time | Distance** toggle.

- **Distance**: metres from the start/finish line using the game's lap distance, so laps line up corner for corner.
- **Time**: seconds since the start of each lap (session time for *Whole session*).

Switching keeps your zoom and cursor on the same piece of track.

## Cursor, zoom, pan, measure

Choose how the mouse behaves in **Settings → Cursor**:

| Mode | Click | Drag | Double-click |
|---|---|---|---|
| **Click to place, drag to zoom** (classic MoTeC, default) | places the cursor | zooms to the dragged range | resets the zoom |
| **Drag to scrub, double-click-drag to zoom** | places the cursor | **moves the cursor** through the data | then drag = **zoom** to that range |
| **Follows mouse** | — (the cursor tracks the pointer) | zooms to the dragged range | resets the zoom |

Everything else is the same in every mode:

| Action | Mouse | Keyboard |
|---|---|---|
| Move the cursor | see the mode table | ← / → (Shift = bigger steps) |
| Zoom to a range | see the mode table | + / − around the cursor |
| Zoom at the mouse | scroll wheel | |
| Pan | right-drag, middle-drag, Ctrl/⌘ + drag, Shift + wheel, trackpad swipe | |
| **Whole lap** | | **W** |
| Reset view | **Reset view** button | Esc, W or Home |
| **Measure range** | **Shift + drag** | Esc clears |

- The **cursor** is shared by every component: legends, the track-map and GPS-track dots, gauges, inputs, tyres and the Channels list all follow it.
- **Zoom** is shared by every graph. Scatter, histogram, mixture, FFT and channel reports can follow it, the Track Map highlights the zoomed section, and the GPS Track frames it.
- **W** zooms to the whole reference lap. In *Whole session* view it zooms to the lap under the cursor.


## Smoothing

![Smoothing on](images/smoothing.png)

Traces show the **raw logged samples** by default. The **〰 Smoothing** control in the top bar (next to Time/Distance) applies a centred moving average:
- click it, or press **S**, to toggle on/off;
- click **▾** to choose the amount (30 ms – 1 s, slider or presets).

Smoothing affects only graph traces and their legend values. Discrete channels (gear, flags) are never smoothed, and reports, statistics, histograms and math channels always use raw data.

## Time variance (F3)

The variance pane shows **overlay lap time − reference lap time** along the lap, so rising means the overlay is losing time. Toggle per graph (Properties) or for the whole sheet (**Δ Variance**, **F3**, **V**). It needs two or more laps.

## Markers, corners and sections

- **Sector lines** (S2, S3…, purple) and your **splits** (green): *Sector & section lines*.
- **Corner lines** (orange) show the corners you've defined for the track: *Corner lines*. Corners with an exact range (advanced mode) also get a faint band over that range.
- Lines are coloured at low opacity; their labels sit along the **top** of the graph (in the variance pane when it's shown). There are no other vertical grid lines.
- Turning lines on or off — right-click, Properties, or the shortcuts **C** (corners) and **Shift + S** (sectors & splits) — applies to **every graph** in the workspace (the shortcuts also switch the track maps and GPS tracks).
- **Right-click the graph → Add corner at cursor… / Add split at cursor…** to define them right where the cursor is. They're saved to the track profile (see [05](05-track-map.md#corners-sections-and-the-track-profile)).

The graph's right-click menu is deliberately short: the two line toggles, *Add corner* / *Add split*, then **Properties…**, **Maximise** and **Remove component**. Everything else (variance, y-range, pane scales, legends, grid, line widths) is in Properties.

## Adding and editing channels

- Drag from the **Channels** sidebar onto a pane (near the bottom edge, or hold Shift, for a new pane).
- **Properties** gives the full pane-and-channel table (see [03](03-workspaces-and-layout.md#the-properties-pop-out)).

## Exporting

**Ctrl/⌘ + E** exports the visible range of the reference lap for every graph channel on the worksheet to CSV.
