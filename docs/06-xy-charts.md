# 06 · XY charts: scatter, histogram, mixture map, FFT, lap trend

All of these use **every selected lap** (or the reference lap, for the mixture map). Most can be limited to the **zoomed range** of the graphs: zoom into one corner and the scatter shows only that corner.

## Scatter / XY plot

![Aero scatters](images/aero.png)

Plots one channel against another, sample by sample. Channels at different rates are resampled to the faster one.

| Option | |
|---|---|
| **X / Y** | any channels (right-click → *Swap X and Y*) |
| **Colour** | *Lap colours* (with different marker shapes per lap) or **a third channel** on a colour ramp, with a legend |
| **Gate** | only plot samples where a channel is non-zero, e.g. gate on `Throttle Brake Overlap` or a math channel like `'Brake Pos' > 10` |
| **Curve fit** | linear, quadratic or cubic least-squares fit per lap, with the equation and **R²** |
| **X-interval averages** | MoTeC's "interval average": the mean Y in N equal bands of X, drawn as a line; sparse bands are ignored |
| **Equal aspect** | same scale on both axes; with two G channels it draws **friction circles** at 1 G, 2 G… (a G-G diagram) |
| **Only zoomed range** | |

The cursor shows as a ring on each lap's point. Scroll to zoom, drag to pan, double-click to reset.

**Ideas:** downforce vs speed (quadratic fit → aero map); aero balance vs front ride height (interval averages); brake pressure vs longitudinal G (linear fit → braking efficiency); lateral G vs steering angle coloured by speed (understeer at speed); damper velocity front vs rear.

## Histogram

![Damper histograms](images/suspension.png)

Shows the **% of time** a channel spends in each bin, with side-by-side bars per lap and a dashed mean line. Options: channel, number of bins, fixed min/max, **cumulative**, only zoomed range.

**Zones** break the distribution into ranges, listed with the % time in each for every lap. The default Suspension sheet uses zones `-25, 0, 25` on damper velocity:

| Zone | Meaning |
|---|---|
| < −25 mm/s | fast rebound |
| −25 … 0 | slow rebound |
| 0 … 25 | slow bump |
| > 25 mm/s | fast bump |

This is the classic damper-tuning histogram; aim for a symmetrical, peaked shape. The cursor value is marked with a line.

## Mixture map

![RPM × throttle](images/engine-ers.png)

A 2-D histogram over the **reference lap** (or the zoomed part of it): X bins × Y bins.

- With no third channel, each cell shows the **% of time** spent there (e.g. RPM × throttle → where the engine lives).
- With a third channel (Z), each cell shows its **mean, min or max**, e.g. `Engine RPM × Throttle Pos → mean Drivetrain Power`, or `Ground Speed × Steering Angle → mean CG Accel Lateral`.

Options: bin counts, statistic, colour ramp, show cell values. The cursor position is ringed.

## Frequency (FFT)

Magnitude spectrum of a channel over each selected lap (or the zoomed range):
- linear trend removed, Hann window, radix-2 FFT;
- scaled to the ride band (≥ 0.5 Hz), with the **peak frequency** marked and listed;
- options: max frequency, log scale, only zoomed range.

Use it on damper/suspension travel or ride heights to find body and wheel-hop frequencies.

## Lap trend

One statistic per lap across the session, with each loaded session as a series:
- **Lap time** (default), or any channel's **mean / max / min / start / end / change** over the lap;
- invalid laps drawn hollow; option to show valid laps only;
- **click a point** to make that lap the reference (Ctrl/⌘ + click to overlay).

Ideas: tyre temperature build-up (`Tyre Temp Avg RR`, mean), fuel burn (`Fuel Level`, end), degradation (`Tire Rubber Grip RR`, mean), consistency (lap time).
