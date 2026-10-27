# 07 · Math channels

Math channels are calculated channels defined by an expression. Once applied they behave exactly like logged channels: you can graph them, colour the track map by them, report them, and use them in other math channels.

![Math editor](images/math-editor.png)

Open the editor with **Ctrl/⌘ + M**, **Analysis → Math Channels…** or the command palette.

## The editor

- **Left:** the list of math channels with a status for the current session:
  - ✓ OK;
  - **error** — a problem in the expression;
  - **n/a** — the session lacks an input channel;
  - **off** — disabled.
  Use **+ New**, **Duplicate**, **Delete** and the checkbox to enable or disable.
- **Middle:** name, unit, decimal places, **expression**, description.
  - The expression is validated **live**. Errors show a message and a caret under the offending character.
  - A **preview sparkline** over the reference lap, with min / avg / max and the evaluation rate.
- **Right:** a searchable **function reference** and **channel list**. Click to insert at the caret.
- **Constants** tab: named numbers usable in any expression (e.g. `SteeringRatio = 12`).
- **Apply** (or **Ctrl/⌘ + Enter**) recomputes every math channel for all open sessions. Edits are drafts until applied.
- **Add missing defaults** restores any of the shipped channels you've deleted.

Math channels and constants are stored **in the workspace**.

New default channels (like **Corner Radius**) appear in existing workspaces when you click **Add missing defaults** in the math editor.

### Renaming a math channel

Change its **name** and **Apply**: everything that used the old name is updated to the new one in the same step. That covers:
- every graph pane, including hidden channels;
- scatter X / Y / colour / gate;
- histograms, mixture maps, track-map colouring, Channel Report lists, gauges, Lap Trend and FFT;
- its channel properties (colour, ranges, display name);
- **other math expressions** that refer to it. A new name with spaces is written quoted, e.g. `'Coasting %'`.

A notice lists the renames, and **Ctrl/⌘ + Z** undoes the whole thing. To change only how a channel is *shown*, without touching expressions, give it a **display name** instead (see [03](03-workspaces-and-layout.md#renaming-channels)).

## Syntax

| Element | Example | Notes |
|---|---|---|
| Channel | `'Ground Speed'` | single or double quotes; case-insensitive match |
| Bare channel | `Gear` | only for names without spaces |
| Unit conversion | `'Ground Speed' [m/s]` | converts from the channel's unit before use |
| Numbers | `3`, `0.5`, `1e-3` | |
| Arithmetic | `+ - * / %` and `^` (power, right-associative) | `-x^2` = `-(x^2)` |
| Comparison | `< <= > >= == !=` (`<>` and `=` also accepted) | result 1 or 0 |
| Logic | `and or not` or `&& \|\| !` | |
| Conditional | `cond ? a : b` or `choose(cond, a, b)` | |
| Constants | `pi`, `e`, `g` + your own | |
| Comments | `// …` or `# …` | |

**Invalid values:** `invalid()` produces a gap. Graphs break the line, and statistics, histograms and scatters skip it. Use it to discard data, e.g. aero balance at low speed.

**Unit conversions supported:**
- speed: km/h · kph · mph · m/s
- temperature: °C · °F · K
- pressure: psi · bar · kPa · mbar
- distance: m · km · mm · cm · ft · in · mi
- angle: deg · rad
- angular rate: deg/s · rad/s · rpm
- time: s · ms · min · h
- acceleration: G · m/s²
- force: N · kN · lbf · kgf
- torque: Nm · lbft
- power: kW · hp · PS
- volume: l · gal
- energy: kJ · MJ · J
- ratios: % · ratio

## How evaluation works

- The result is calculated at the **highest sample rate** of the channels it uses: mixing a 30 Hz and a 150 Hz channel gives a 150 Hz result, and slower channels are interpolated (discrete channels such as Gear are held, not interpolated).
- Expressions are evaluated over the **whole session**. Per-lap functions use the session's lap boundaries.
- Math channels can reference other math channels in any order; circular references are reported.

## Function reference

### Arithmetic
| Function | Description |
|---|---|
| `abs(x)` | absolute value |
| `sqrt(x)` / `sqr(x)` | square root / square |
| `pow(x, y)` | x to the power y |
| `exp(x)`, `ln(x)`, `log(x)`, `log10(x)` | exponential / natural log / natural log / base-10 log |
| `floor(x)`, `ceil(x)`, `int(x)`, `frac(x)` | rounding down / up / truncate / fractional part |
| `round(x, dps?)` | round to an integer or to `dps` decimals |
| `sgn(x)` / `sign(x)` | −1, 0 or 1 |
| `mod(x, y)` | remainder |
| `hypot(x, y)` | √(x² + y²) |
| `min(a, b, …)`, `max(a, b, …)` | sample-by-sample min / max |
| `clamp(x, lo, hi)` / `limit(x, lo, hi)` | restrict to a range |

### Trigonometry
| Function | Description |
|---|---|
| `sin cos tan (x)` | radians |
| `asin acos atan (x)` | → radians |
| `atan2(y, x)` | angle of a vector |
| `rad(x)` / `deg2rad(x)` | degrees → radians |
| `deg(x)` / `rad2deg(x)` | radians → degrees |

### Logic & validity
| Function | Description |
|---|---|
| `choose(cond, a, b)` / `if(cond, a, b)` | a where cond ≠ 0, else b |
| `between(x, lo, hi)` | 1 where lo ≤ x ≤ hi |
| `invalid()` | an invalid value (gap) |
| `isvalid(x)` | 1 where x is valid |
| `gate(x, cond)` | x where cond, otherwise invalid |
| `hold(x)` | replace invalid samples with the last valid value |

### Signal processing
| Function | Description |
|---|---|
| `derivative(x)` | rate of change per second (central difference) |
| `integrate(x, cond?)` | running integral x·dt; with cond, only accumulates while cond is true |
| `integrate_lap(x, cond?)` | as integrate, reset at every lap start |
| `smooth(x, seconds)` | centred moving average |
| `lowpass(x, hz)` / `highpass(x, hz)` | zero-phase first-order filters |
| `shift(x, seconds)` | delay (negative = advance) |
| `delta(x)` | x[i] − x[i−1] |
| `prev(x)` | previous sample |

### Statistics
| Function | Description |
|---|---|
| `stat_mean(x)`, `stat_min(x)`, `stat_max(x)`, `stat_std(x)`, `stat_sum(x)` | per lap (constant within each lap) |
| `session_mean(x)`, `session_min(x)`, `session_max(x)` | whole session (a single number) |

### Lap & time
| Function | Description |
|---|---|
| `time()` | session time (s) |
| `lap_time()` | time since the lap started (s) |
| `lap_number()` | lap number (1 = out lap) |
| `lap_distance()` | distance from the start/finish line (m) |

## The default library (71 channels)

| Channel | Expression (abridged) | Unit |
|---|---|---|
| Corner Radius | `gate(min(('Ground Speed' [m/s])^2 / (abs('CG Accel Lateral') × 9.81), 2000), abs('CG Accel Lateral') > 0.3)` — the radius of the path while cornering; smaller = tighter line | m |
| Combined G | `hypot('CG Accel Lateral', 'CG Accel Longitudinal')` | G |
| Steering Rate | `derivative('Steering Angle')` | deg/s |
| Throttle Brake Overlap | `choose('Throttle Pos' > 5 and 'Brake Pos' > 5, 1, 0)` | |
| Coasting | `choose('Throttle Pos' < 2 and 'Brake Pos' < 2 and 'Ground Speed' > 30, 1, 0)` | |
| Full Throttle | `choose('Throttle Pos' > 98, 1, 0)` (lap mean = full-throttle %) | |
| Braking Time Lap | `integrate_lap(choose('Brake Pos' > 5, 1, 0))` | s |
| Brake Steer Combination | `100 × sqrt(brake share × steering share)`, with deadbands (2 % brake, 5° steering) and steering scaled to 90°. 0 = either input alone, 100 = full brake at 90° lock | % |
| Brake Steer Combination Lap | `integrate_lap('Brake Steer Combination' / 100)`: seconds of "full brake at full lock" in the lap | s |
| Trail Braking Time Lap | time braking (> 5 %) with more than 10° of lock | s |
| Tyre Wear Rate FL/FR/RL/RR | `speed [m/s] × ndSlip × load / 5000`, capped at 100: where each tyre is wearing (see [14 · Tyre wear](14-tyre-wear.md)) | |
| Tyre Wear Lap FL/FR/RL/RR | `integrate_lap(speed [m/s] × ndSlip × load / 5000)`: wear per lap in metres of full sliding at 5 kN | m |
| Tyre Wear Rate Avg / Tyre Wear Lap Avg | the four tyres averaged | –, m |
| Tyre Wear Front-Rear / Left-Right, Tyre Wear Front Share / Left Share | front vs rear and left vs right: the wear-rate difference along the lap, and each side's share of the lap's wear | –, % |
| Tyre Wear Lock-up / Wheelspin / Slide Front / Rear, Tyre Wear Left-Right Front / Rear | each cause per axle (left and right averaged), and the axle's left − right wear-rate balance | |
| Tyre Wear Lock-up / Wheelspin / Slide FL/FR/RL/RR (and Avg) | the wear rate split by cause: lock-up (negative slip ratio), wheelspin (positive), cornering slide (slip angle); they add up to Tyre Wear Rate | |
| Damper Velocity FL/FR/RL/RR | `derivative('Damper Travel FL')` | mm/s |
| Tyre Temp Avg FL/FR/RL/RR | mean of inner/middle/outer | °C |
| Tyre Temp Spread FL/FR/RL/RR | inner − outer (camber indicator) | °C |
| Rake | `'Ride Height Rear' - 'Ride Height Front'` | mm |
| Total Downforce | front + rear downforce | N |
| Aero Balance | front share of downforce (invalid below 500 N) | % |
| Aero Efficiency | downforce / drag (invalid at low drag) | |
| Front Load Share | front axle share of tyre load | % |
| Lateral Load Transfer | (right − left) / total load | % |
| Rear Wheelspin | `max('Tire Slip Ratio RL', 'Tire Slip Ratio RR')` | % |
| Front Lockup | `min('Tire Slip Ratio FL', 'Tire Slip Ratio FR')` | % |
| Brake Temp Front/Rear Avg | axle mean disc temperature | °C |
| Lap Fuel Used | `stat_max('Fuel Level') - 'Fuel Level'` | l |
| Speed Smoothed | `smooth('Ground Speed', 0.3)` | km/h |

## Examples

```text
// Wheel speed from angular speed and loaded radius (km/h)
'Wheel Angular Speed RL' * 'Tire Loaded Radius RL' / 1000 * 3.6

// Understeer gradient proxy: steering per G of lateral acceleration, only in real corners
gate(abs('Steering Angle') / abs('CG Accel Lateral'), abs('CG Accel Lateral') > 1)

// Time spent off-throttle this lap
integrate_lap(choose('Throttle Pos' < 95, 1, 0))

// Brake release smoothness (negative = releasing)
smooth(derivative('Brake Pos'), 0.1)

// Speed in m/s via unit conversion
'Ground Speed' [m/s]

// Percentage of each lap at full throttle (constant per lap)
stat_mean(choose('Throttle Pos' > 98, 100, 0))
```
