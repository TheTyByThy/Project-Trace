# 10 · Keyboard & mouse

Press **F1** in the app for this list. On macOS, use **⌘** wherever **Ctrl** is shown.

## Shortcut editor

Every keyboard shortcut below (except undo/redo) can be changed in **Help → Keyboard Shortcuts** (**F1**):

- **+ Add** next to an action, then press the keys you want (Esc cancels);
- click a key to remove it; an action can have several keys;
- each key combo belongs to one action — assigning it elsewhere moves it (a notice says so);
- **Reset** restores one action; **Reset all to defaults** restores everything.

Changes apply immediately, also to the hints in menus, tooltips and the command palette.

![Keyboard shortcuts](images/shortcuts.png)

## Global

| Keys | Action |
|---|---|
| Ctrl + Z | Undo (deleted components, panes, channels, worksheets, layouts, corners…) |
| Ctrl + Y, Ctrl + Shift + Z | Redo |
| Ctrl + O | Session browser |
| Ctrl + Shift + O | Open CSV / .ld files directly |
| Ctrl + I | Toggle the **Properties side panel** (right-click a component → Properties… for the pop-out) |
| Ctrl + K | Command palette (search every action, worksheet, workspace and component) |
| Ctrl + M | Math channel editor |
| Ctrl + , | Settings |
| Ctrl + B | Toggle sidebar |
| Ctrl + E | Export the visible data to CSV |
| Ctrl + S | Save the workspace (defaults: Save as…) |
| Ctrl + Shift + S | Save a screenshot (PNG) |
| F1 | Keyboard & mouse help |
| 1 … 9 | Switch to worksheet 1–9 |

## Analysis

| Keys | Action |
|---|---|
| D | Toggle time / distance x-axis |
| **J** | Reference lap: per-channel colours ⇄ single lap colour |
| **S** | Toggle trace smoothing |
| **C** | Toggle corner lines on every graph, track map and GPS track |
| **Shift + S** | Toggle sector & split lines on every graph, track map and GPS track |
| F3 or V | Toggle the time-variance pane on this worksheet's graphs |
| F | Fastest lap as reference |
| **↑ / ↓** (also PgUp / PgDn, [ / ]) | Previous / next lap as reference |
| ← / → | Move the cursor (hold Shift for larger steps) |
| + / − | Zoom in / out around the cursor |
| Esc, W, Home | Reset view: whole lap, clear the range measurement |

## Mouse: graphs

| Input | Action |
|---|---|
| Click | Place the cursor |
| Drag | **Classic mode** (default): zoom to the dragged range · **Scrub mode**: move the cursor |
| Double-click | Classic: reset zoom · Scrub: double-click then drag zooms |
| Shift + drag | Measure a range (min / avg / max / Δ) |
| Scroll | Zoom around the mouse |
| Shift + scroll, trackpad swipe | Pan |
| Right-drag, middle-drag, Ctrl + drag | Pan |
| **Drag a pane border** (highlights on hover) | Resize panes |
| Right-click | Sector & split lines, corner lines (all graphs), **Add corner** / **Add split** at the cursor, then Properties / Maximise / Remove |
| Drag a channel from the sidebar | Onto a pane to add it there; onto the bottom edge (or with Shift) for a new pane |

## Mouse: other components

| Where | Input | Action |
|---|---|---|
| Scatter, lap trend, histogram, FFT | drag a rectangle | zoom into it |
| Scatter, lap trend, histogram, FFT | scroll / right-drag / double-click | zoom / pan / reset |
| Lap trend | click a point | make that lap the reference (Ctrl + click: overlay) |
| Track map, GPS track | click near the track | move the cursor there |
| Track map, GPS track | drag / scroll / double-click | pan / zoom / reset |
| Track map, GPS track | **drag the dial ring** (Shift = 15° steps) | rotate; **Save** / **Reset** under the dial |
| Corner report | click a row | zoom to the corner or straight (edit corners in Properties) |
| Lap lists | click / Ctrl + click / Shift + click | show only / overlay / set reference |
| Sidebar laps | click a selected lap's colour square | remove that lap |
| Sidebar laps | right-click a selected lap's colour square | change its colour |
| Any component | right-click | its main options (graphs and maps: marker lines, add corner / split) + **Properties…** / Maximise / **Remove component** |
| Divider between components | drag | resize; snaps to line up with other dividers (hold Alt/⌥ for free movement) |
| Component header | drag | dock elsewhere (edges split, centre swaps) |
| Component header | double-click | maximise / restore |
| Sidebar channel | drag onto a component / double-click | add / apply it |
| Worksheet tab | double-click / drag / right-click | rename / reorder / menu |
| Window | drop CSV or .ld files | open (hold Shift to add for comparison) |
