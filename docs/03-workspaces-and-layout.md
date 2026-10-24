# 03 · Workspaces, worksheets & layout

Project-Trace follows MoTeC i2's organisation:

```
Workspace  ── e.g. "Formula — Default"
 ├─ Worksheets (tabs) ── Overview · Driver · Tyres · …
 │   └─ Components laid out in resizable splits ── graphs, track maps, reports…
 ├─ Math channels + constants
 └─ Channel display properties (colours, fixed ranges, decimals, units)
```

Everything you change is **saved automatically** (a fraction of a second after you stop editing).

## Workspaces

Use the **▦ workspace button** in the top bar:

| Action | What it does |
|---|---|
| *Workspace list* | Switch workspace. Math channels are recomputed for the open sessions. |
| **New from default template** | A fresh copy of the 9-sheet *Formula — Default* workspace. |
| **New blank workspace** | One sheet with a graph and a track map. |
| **Duplicate current** | Copy to experiment safely. |
| **Rename current…** | |
| **Export current to file…** | Saves a `.ptw.json` file you can share or back up. |
| **Import from file…** | Loads a shared workspace (added alongside yours, never overwriting). |
| **Delete current** | Asks first; you always keep at least one. |

Workspaces are plain JSON. Share one with a friend and they get your sheets, layouts and math channels.

## Worksheets (tabs)

- **Click** a tab or press **1–9** to switch.
- **＋** adds a worksheet.
- **Double-click** a tab to rename it.
- **Drag** tabs to reorder them.
- **Right-click** for Rename / Duplicate / Move left / Move right / Delete.

## Components

There are 14 component types:

| Component | Purpose |
|---|---|
| Time / Distance Graph | Multi-channel traces with lap overlays, variance, cursor and zoom |
| Track Map | Track outline coloured by channel, lap or gain/loss |
| Scatter / XY Plot | Channel vs channel with fits and interval averages |
| Histogram | Distribution with zone breakdowns |
| Mixture Map | 2-D histogram (% time or a third channel) |
| Lap Report | Lap & sector/section times, ideal lap |
| Channel Report | Min/max/avg/std per lap |
| Corner Report | Per-corner speeds/times vs reference |
| Lap Trend | A statistic per lap across the session |
| Gauges | Dial/bar/digital at the cursor |
| Driver Inputs | Pedals, wheel, gear, speed, RPM |
| Tyres & Brakes | Four-corner temperatures, pressures, loads |
| Frequency (FFT) | Spectrum of a channel |
| Session & Setup | Details, full setup sheet, notes |

### Adding
- **＋ Component** (right end of the tab bar) adds to the current worksheet.
- **＋** on a component's header adds a new component **beside** it.
- With nothing selected, the **Properties** panel lists every type; click one to add it.
- Right-click a header → **Split right with… / Split below with… / Replace with…**.
- The command palette (**Ctrl/⌘ + K**) has "Add component: …" for every type.

### Arranging
- **Resize**: drag the thin gaps between components.
- **Dock**: drag a component's **header** onto another component. A blue zone shows where it will land:
  - **left / right / top / bottom edge** splits that component and places yours there;
  - the **centre** swaps the two.
- **Maximise**: double-click the header (or □). Double-click again to restore.
- **Remove**: ✕ on the header.

### Configuring
Click a component (or ⚙ on its header) to show its settings in the **Properties** panel on the right (toggle with **Ctrl/⌘ + I**). Every component also has a **right-click menu** with the most common options, and most accept **channels dragged from the sidebar**:

| Drop a channel on… | Effect |
|---|---|
| a graph pane | adds it to that pane (drop near the bottom or hold Shift for a new pane) |
| a track map | colours the map by it |
| a histogram | shows its distribution |
| a channel report | adds a row |
| gauges | adds a digital gauge |

## Channel properties

Right-click a channel in a graph legend or in the Channels list → **Channel properties…**:
- **Colour** — pick from the palette or any custom colour (or *Auto*).
- **Fixed min / max** — lock the y-range (in display units).
- **Decimal places**.
- **Display unit override** — e.g. show one speed channel in mph.

These are stored per workspace.

## The sidebar

The left sidebar (toggle with **Ctrl/⌘ + B**, drag its edge to resize) has two tabs:

- **Sessions & laps**: each loaded session with its laps. See [08 · Laps](08-laps-sectors-reports.md) for selection rules.
- **Channels**: every channel grouped by category, with its live value at the cursor:
  - Driver Inputs, Speed & Position, Lap & Timing, Engine, Hybrid/ERS, Tyres, Brakes, Suspension, Chassis, Aero, Environment, Session & Sim, Derived, Math;
  - search box and "Hide constant channels";
  - double-click a channel to add it to the selected graph; drag it onto any component.
