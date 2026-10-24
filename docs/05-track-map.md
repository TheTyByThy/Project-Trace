# 05 · Track map

The track map draws the circuit from the car's position: MoTeC's GPS track, rebuilt from sim coordinates.

![Gain/loss track map](images/driver.png)

## Where the shape comes from

| Source | Used when |
|---|---|
| `Car Coord X` / `Car Coord Y` (metres, Telemetrick/AC) | present (AC files) |
| `GPS Latitude` / `GPS Longitude` | no X/Y channels; projected to local metres around the session's mean position |

The outline is the **reference lap's** path. `Car Coord Z` (elevation) is available as a channel to colour by. The *Session & Setup* worksheet ships with an elevation map.

## Colouring

Choose in the Properties panel, the right-click menu, or by **dragging a channel onto the map**:

| Mode | Shows |
|---|---|
| **Channel** (e.g. Ground Speed, Brake Pos, Gear, Car Coord Z) | the reference lap coloured on a single-hue ramp from the lap's min to max, with a legend (honours *Channel properties* fixed min/max) |
| **Lap colours** | every selected lap's racing line in its lap colour, useful for comparing lines |
| **Time gained / lost** | rate of change of the variance between the reference and the first overlay: **blue = the overlay gains time here, red = loses time**, grey = equal |

Ramps: *Blue* and *Orange* (sequential, for magnitudes) and *Blue ↔ Red* (diverging, for signed values).

## Markers

- **S/F** start/finish line.
- **S2, S3…** game sector splits (from the sector timer; see [08](08-laps-sectors-reports.md)).
- **Custom section** splits with your names.
- **Corner labels** T1, T2… (auto-detected; renameable in the Corner Report).

Toggle sectors/sections and corners from the right-click menu or Properties.

## Cursor & zoom link

- A dot marks every selected lap's position at the cursor. The reference has a ring.
- **Click near the track** to move the cursor to that point, so every graph jumps there.
- When the graphs are zoomed, the map **dims everything outside the zoomed section** (toggle *Highlight zoomed range*).

## Navigation

| Action | Input |
|---|---|
| Zoom | scroll wheel (around the mouse) |
| Pan | drag |
| Reset view | double-click |
| Rotate 90° | right-click → *Rotate 90° (this track)* |
| Mirror | right-click → *Mirror (this track)* |

Rotation and mirroring are saved **per track** (in the track profile), so every map of that circuit, in every workspace, matches. Fine-tune the rotation in degrees in the Properties panel.

## Custom sections

Sections are your own split points, used for section times in the Lap Report.

1. Put the cursor where you want a split (click a graph or the map).
2. Right-click the map → **Add section split at cursor…** and give it a name ("T7 exit", "Back straight").
3. Lap Report → **Custom sections** now shows the time between consecutive splits for every lap.

Edit names and exact distances, or delete splits, in the Properties panel's *Track profile* group. **Clear custom sections** removes them all. Sections are stored per track and shared across workspaces.
