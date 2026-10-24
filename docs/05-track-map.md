# 05 · Track Map & GPS Track

Two components draw the circuit from the car's position (`Car Coord X/Y`, or GPS latitude/longitude projected to metres):

| | **Track Map** | **GPS Track** |
|---|---|---|
| Purpose | See *what* happened where: speed, pedals, gear, elevation, time gained/lost | Compare *the lines you drove*, lap against lap |
| Line | Thick, coloured by a channel or by lap | **Thin**, one line per lap in its lap colour |
| Zoom | Highlights the graphs' zoomed range | **Frames** the graphs' zoomed range |
| Extras | Colour ramps (preset or custom), gain/loss | Line-offset readout, scale bar, follow-cursor (raw car positions only) |

Both share the **rotation dial**, the per-track **corners, sections and rotation**, cursor dots for every lap, and **click-to-seek**.

## Track Map

![Track map coloured by time gained/lost](images/driver.png)

**Colour by** (Properties, or drag a channel onto the map):

| Mode | Shows |
|---|---|
| **Channel** (Ground Speed, Brake Pos, Gear, Car Coord Z…) | The reference lap coloured from the lap's min to max, with a legend |
| **Lap colours** | Each selected lap's line in its lap colour |
| **Time gained / lost** | Where the first overlay gains (blue) or loses (red) time against the reference |

**Colour ramps**: Blue or Orange (sequential), Blue ↔ Red (diverging), or **Custom colours…**. Custom means you pick the **low** and **high** colours (or the *gaining* and *losing* colours in gain/loss mode) with the full colour picker in Properties.

## GPS Track: comparing racing lines

![GPS track zoomed into T1–T2](images/gps-track.png)

1. Select two or more laps (Ctrl/⌘ + click in the sidebar).
2. **Zoom the graphs into a corner**: double-click and drag across it, or click the corner in the Corner Report. The GPS Track automatically frames exactly that part of the lap for every selected lap.
3. Compare the thin lines:
   - the **scale bar** (bottom right) gives the size in metres;
   - the faint band is an approximate 13 m-wide track;
   - the readout at the top left gives each overlay's **lateral offset from the reference line at the cursor**, e.g. *"Lap 3: 0.8 m left of ref"*.
4. Scrub the cursor along a graph to watch the cars and offsets move. With **Follow the cursor** on, a map you've zoomed into manually keeps the reference car centred.

Interactions are the same as the Track Map: scroll to zoom (much deeper on the GPS Track), drag to pan, double-click to reset, click to move the cursor. Options in Properties:
- line width;
- frame the zoomed range;
- follow cursor;
- sector/corner labels.

## The rotation dial

Both maps have a small **dial** in the top-right corner:

- **Drag the ring** to rotate the map (hold **Shift** for 15° steps). Every map of the same track turns together, and the angle in Properties updates live.
- **Save** stores the current angle as **this track's default rotation**, used every time you open that track.
- **Reset** returns to the saved rotation after you've been experimenting. "unsaved" shows while they differ.

You can also type an angle, or use ⟲ 90° / ⟳ 90°, in the track profile (Properties, or **Analysis → Track Profile…**). **Mirror** is in the same place.

## Corners, sections and the track profile

![Track profile editor](images/track-profile.png)

Corners are **not** generated automatically: you define them once per track and they're remembered.

**Add a corner**
1. Put the cursor on the corner's apex (click a graph or the map).
2. Right-click a graph, the Track Map or the GPS Track → **Add corner at cursor…**, and name it (e.g. "T7" or "Turn 7 – Memorial").

**Edit corners** in the **track profile** editor (Properties of a map or corner report, or **Analysis → Track Profile (corners, sections, rotation)…**):
- rename;
- type an exact distance;
- **⇢ cursor** to move a corner to the cursor;
- delete, or **Clear all**.

Right-click a corner in the Corner Report for Rename / Move to cursor / Delete. **Suggest from speed minima** proposes corners at the reference lap's slowest points, but only when you click it; edit or delete them afterwards.

**Splits** work the same way (**Add split at cursor…**). They divide the lap into named parts for the Lap and Stint Reports' *Custom sections* columns.

**Advanced corner ranges**: in the track profile, tick *Advanced: exact start / end distance for each corner* to set where each corner begins and ends. Everything outside a corner counts as a straight, and the Corner Report shows total time (and gain/loss vs the reference) in corners and on straights.

Corners appear on graphs (*Corner markers*), both maps (*Corner labels*) and in the **Corner Report**. Everything in a track profile is saved per venue, shared by all workspaces, and undoable.
