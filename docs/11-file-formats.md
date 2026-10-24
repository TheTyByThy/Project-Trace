# 11 · Supported file formats

## 1. Telemetrick "AC pyTelemetry CSV" (primary format)

This is what Telemetrick writes for Assetto Corsa. Its structure:

```text
Format,AC pyTelemetry CSV
Venue,singapore_2020-layout_f1_2026
Vehicle,vrc_formula_alpha_2026_csp
Driver,Lewis Hamilton
Log Date,24/10/2026
Log Time,15:25:30
Sample Rate,150
Duration,546.85
Laps,6
lapTimes,"117.9,103.122,102.708,102.068,101.424"      ← beacon-to-beacon lap durations

data,Engine Id,Team,Vehicle Number,Vehicle Wheelbase,…  ← vehicle/venue details block
,m,m,%,…                                                ← units
,rwd (Turbo: 1), (Ferrari_SF-26_44_Hamilton),44,3.4,…  ← values

Car Setup,Fst Rebound RR,Spring Rate HF,…               ← full setup sheet block
,,N/m,…
,20,35653,…

time,Last Sector Time,Fuel Level,…,UTC Time,            ← channel names (186 channels)
s,s,l,…,s,                                              ← units
0.0,0.0,91.98,…                                         ← data rows at 150 Hz
0.00667,,,,,,,,,,…,1.2836,0.8685,…                      ← empty cells = not sampled this tick
```

### Multi-rate data
Every row is one 150 Hz tick, but channels are logged at **150, 30, 10 or 1 Hz** and leave their cells empty on ticks where they weren't sampled. Project-Trace:
- parses each column into its own sample list (a byte-level parser in a background worker; ~0.4 s for the 77 MB sample);
- detects each channel's **native rate** from its sampling pattern and stores it on its own uniform grid, about **4× less memory** than resampling everything to 150 Hz, and lossless;
- interpolates linearly when needed. **Discrete** channels (gear, lap number, flags, modes) are held, not interpolated.

Values that need full precision (e.g. the epoch-seconds `UTC Time`) are kept as 64-bit floats; everything else is 32-bit.

### Recognised channels
Channels are matched by name so components work automatically:

| Role | Names tried (first match wins) |
|---|---|
| Speed | `Ground Speed`, `Speed`, `Vehicle Speed`, `GPS Speed`… |
| Lap number / distance / time | `Lap Number`, `Lap Distance`, `Lap Time` |
| Position | `Car Coord X/Y/Z`, or `GPS Latitude/Longitude` |
| Sector timer | `Last Sector Time` |
| Validity | `Lap Invalidated` |
| In-game clock | `UTC Time` |
| Driver inputs | `Throttle Pos`, `Brake Pos`, `Clutch Pos`, `Steering Angle`, `Gear`, `Engine RPM` |
| Accelerations | `CG Accel Lateral`, `CG Accel Longitudinal` |
| Fuel | `Fuel Level` |
| Tyres & brakes | `Tire Temp Inner/Middle/Outer/Core FL…`, `Tire Pressure FL…`, `Brake Temp FL…`, `Tire Load FL…`, `Tire Slip Angle FL…` (`Tyre` spelling also accepted) |

A derived **`Distance`** channel (speed integrated over the session) is always added, as MoTeC does.

## 2. MoTeC i2 log (`.ld` + `.ldx`)

Telemetrick also writes a MoTeC `.ld` log and an `.ldx` XML sidecar for every export. Project-Trace reads:
- **`.ld`**: header (date, time, driver, vehicle, venue, comment) and every channel with its name, unit, rate, data type (int16/int32/float16/float32) and scaling (`value = (raw / scale × 10^-dec + shift) × mul`);
- **`.ldx`**: lap **beacons** (marker times in µs), vehicle/venue **details**, and the **setup** (numeric `Setup …` math items).

The automated tests check that the `.ld` reader produces the **same channels, rates, sample values, laps, sectors and validity** as the CSV of the same session. If the `.ldx` is missing, laps fall back to the `Lap Number` channel.

## 3. MoTeC CSV export

Files exported from MoTeC i2 (*File → Export → CSV*) are supported:
- quoted key/value header with second-column pairs;
- *Beacon Markers* (→ laps);
- channel and unit rows;
- blank spacer rows.

## 4. Generic CSV

Any CSV whose first non-numeric row is the channel names works. If the next row isn't numeric it's treated as units.
- A `Time` column (`time`, `Time (s)`, `Session Time`, `Timestamp`…) is used if present. Otherwise the header's sample rate (or 1 Hz) is assumed.
- Irregular timestamps are resampled onto a uniform grid at the nearest clean rate.
- Text columns are skipped (reported once).

```csv
Time,Speed,RPM,Throttle
s,km/h,rpm,%
0.00,120.5,8000,100
0.05,121.0,8050,100
```

## Units

Source units are read from the file and converted for display according to Settings: speed (km/h, mph, m/s), temperature (°C, °F) and pressure (psi, bar, kPa). Telemetrick's `kph` is displayed as km/h and `C` as °C. Other units are shown as-is, and can be overridden per channel (*Channel properties → Display unit override*).
