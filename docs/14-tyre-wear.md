# 14 · Tyre wear

Project-Trace estimates **how much rubber each tyre loses, where on the lap it happens, and why**: lock-ups, wheelspin or cornering slides. The model was fitted against Assetto Corsa's own `Tire Rubber Grip` channel across 35 stints (208 laps, about 900 km). It follows that channel lap by lap with a median R² of 0.95. Because it measures only the driving, it compares fairly between drivers and stints even when the game's wear settings differ.

- [Using it](#using-it)
- [Reading the numbers](#reading-the-numbers)
- [The math channels, term by term](#the-math-channels-term-by-term)
- [How it relates to real tyres](#how-it-relates-to-real-tyres)
- [How the model was found](#how-the-model-was-found)
- [How it was verified](#how-it-was-verified)
- [Limits](#limits)
- [Sources](#sources)

---

## Using it

### The two worksheets

The Starter workspace has two tyre wear worksheets.

**Tyre Wear (overview):** everything averaged over the four tyres.

| Panel | Shows |
|---|---|
| Tyre wear rate (average of 4) | Speed, plus `Tyre Wear Rate Avg` against distance, for every selected lap. |
| Tyre wear per lap (average of 4) | A Lap Trend of `Tyre Wear Lap Avg` (end-of-lap value): wear per lap across each open stint. |
| Tyre Wear component | One card (average of the four tyres) and the per-section table. |
| Track map — Δ wear rate vs reference | The track coloured by the comparison lap's wear rate minus the reference's. Red = the comparison lap wears the tyres more there, green = less. |

**Tyre Wear Detail:** the same, split per tyre (FL / FR / RL / RR).

| Panel | Shows |
|---|---|
| Tyre wear rate per tyre | One pane per tyre. |
| Four Δ wear-rate track maps | One per tyre, laid out like the car (FL FR / RL RR). |
| Tyre Wear component | Four tyre cards, with the table on one tyre at a time. |
| Four Lap Trends | Wear per lap, one per tyre. |

To use them in your own workspace:
- Add the channels with **Math editor → Add missing defaults**.
- Copy the worksheets, or add the pieces with **+ Component**.

### Tyre Wear component

It works on the selected laps: the reference and any comparisons.

**Lap cards.** One card per tyre, or one card averaging the four (**Properties → Lap cards**). Each row is a selected lap:

| Column | What it means |
|---|---|
| Bar | Length is the lap's wear. Colours split it into **lock-up** (red), **wheelspin** (amber) and **cornering slide** (blue). Hover for the percentages. |
| Metres | Wear in metres of full sliding at 5 kN (see [the math](#the-math-channels-term-by-term)). |
| Δ % | Wear against the reference lap on the same tyre. Red = more wear, green = less. |
| −x.xx % | Grip the game took off the tyre over the lap (`Tire Rubber Grip`), for comparison. Hide it in Properties. |

**Where table.** The lap is split into your corners and the straights between them (from the track profile), or into 200 m mini-sectors. Each row shows:
- **Reference lap:** its wear in that section, and its lock-up / wheelspin / slide bar.
- **Each comparison lap:**
  - the difference to the reference (**Δ**) and a gain/loss bar
  - the cause that changed most, e.g. *cornering slide*, or *less lock-up* when it went down

Turn on **Breakdown** (the button above the table, or in Properties) to also see each comparison lap's own wear and its lock-up / wheelspin / slide bar. It's off by default. All the cause bars share one scale, so their lengths compare across laps and rows.

Controls:
- **Avg / FL / FR / RL / RR** chooses the tyre for the table: the four averaged, or one.
- **Corners / 200 m** chooses the sections.
- **Straights** shows or hides the straight rows, as in the Corner Report. The whole-lap total still counts them.
- **Breakdown** adds each comparison lap's own wear and cause bar.
- **Lap order / Most extra wear** sorts the rows around the lap or by the worst sections first.
- **Click a row** to zoom every graph to that section. **Hover** to highlight it on the track maps.

The line under the table summarises the first comparison lap, for example:

> L5 vs reference: −3.1% tyre wear overall; biggest extra wear in T2 → T3 (+10 m, cornering slide).

### Track map: difference to the reference

Any Track Map coloured by a channel can show **comparison lap − reference** instead of the raw value: **Properties → Colouring → Difference: comparison lap − reference**.

- Both laps are compared at the same lap distance, on a 4 m grid.
- The difference is averaged over the **smoothing** distance (48 m on the tyre wear sheets).
- Full colour is reached at the 95th percentile of the difference, adjusted by the **sensitivity** slider.
- With several comparison laps, right-click the map, or click the legend, to choose which one.

### A workflow for "why did my tyres go off faster?"

1. Open both stints. Make your representative lap the reference, and your team-mate's lap a comparison (Ctrl/⌘ + click).
2. On **Tyre Wear**, look at the per-lap trend. A gap on one or two laps is an incident; a gap on every lap is driving style.
3. For an incident, select that lap and sort the table by **Most extra wear**. One section with a big *wheelspin* or *lock-up* cause is the incident.
4. For a style difference:
   - Read the Δ track map and the table for the corners where you consistently wear more.
   - Switch to **Tyre Wear Detail** to see which tyre it is.
   - Click the corner, then compare steering, throttle, brake and slip-angle traces there.

---

## Reading the numbers

### Which number means "more deg"?

**Wear per lap in metres** (`Tyre Wear Lap`, end-of-lap value) is the measure of how hard a lap is on the tyres. Compare its level between drivers or stints: if your laps sit at 1,580 m and your team-mate's at 1,470 m, you use about 7% more rubber per lap.

If you add a **best-fit line** to that trend:

| Fit value | What it tells you | Use it as a deg measure? |
|---|---|---|
| **The line's level** (C, or simply the average of the points) | Typical wear per lap. | **Yes. This is the one.** |
| **M (slope)** | Whether wear *per lap* rises or falls through the stint: positive = laps get harder on the tyres (sliding more as grip drops, pushing more), negative = taking it easier, e.g. managing tyres or fuel. | Secondary: it shows a change in driving, not the amount of wear. |
| **R²** | How well a straight line describes the points. Low R² just means laps vary, e.g. traffic or one bad lap. | **No.** It is a fit-quality number, not a wear number. |

**If you trend `Tire Rubber Grip` instead** (stat = last), the line falls through the stint, and its **slope M (grip % per lap)** is the degradation rate the game applied. That's useful within one session. It is **not** comparable between sessions that used different wear multipliers or compounds; see [validation](#how-it-was-verified), where the same track lost grip 5× faster before a settings change. The wear metres don't have that problem.

### Converting metres to grip

Grip lost ≈ *k* × wear (km). *k* depends only on the compound and the wear multiplier:

| Setting | *k* (grip % per km of wear) |
|---|---|
| Compound 2 at 1× | about **1.2** |
| 2× | about 2.2 |
| 5× | about 5.5 |

The rear tyres lose about 10% less grip per metre than the fronts, because of the car's rear wear curve.

---

## The math channels, term by term

There are ten wear channels in the default library: per tyre (FL, FR, RL, RR) plus averages. The FL versions, exactly as in the Math editor:

```text
Tyre Wear Rate FL  =  clamp(smooth('Ground Speed' [m/s] * 'ndSlip FL' * max('Tire Load FL', 0), 0.2) / 5000, 0, 100)
Tyre Wear Lap FL   =  integrate_lap('Ground Speed' [m/s] * 'ndSlip FL' * max('Tire Load FL', 0) / 5000)      [m]

Tyre Wear Rate Avg =  ('Tyre Wear Rate FL' + 'Tyre Wear Rate FR' + 'Tyre Wear Rate RL' + 'Tyre Wear Rate RR') / 4
Tyre Wear Lap Avg  =  ('Tyre Wear Lap FL' + 'Tyre Wear Lap FR' + 'Tyre Wear Lap RL' + 'Tyre Wear Lap RR') / 4   [m]
```

The Tyre Wear component computes the same thing directly in code (`src/core/tyreWear.ts`). A unit test checks that its lap totals match `Tyre Wear Lap` within 3%.

### The core product: `speed × ndSlip × load / 5000`

In symbols, per tyre at each sample:

```
ẇ  =  v · s · max(F_z, 0) / F_ref          [m/s]

v      'Ground Speed' [m/s]   the car's speed. The [m/s] converts the logged km/h (÷ 3.6).
s      'ndSlip FL'            the game's normalised slip, dimensionless (below).
F_z    'Tire Load FL'         vertical load on the tyre, N. max(…, 0) stops a wheel that is
                              in the air (or a sensor glitch below zero) from giving negative wear.
F_ref  5000 N                 reference load, about a typical mid-corner tyre load on this car.
```

**`ndSlip` (s).** This is Assetto Corsa's normalised slip: how far the tyre is through its grip curve, combined in both directions.

- **s ≈ 0:** rolling freely.
- **s ≈ 1:** at the peak of the grip curve, the most grip the tyre can give.
- **s > 1:** past the peak, sliding. A locked wheel or a wheelspin gives 5–30, and a spin over 200.

Fitting the logged channels shows how the game builds it (R² = 0.95):

```
s²  ≈  (κ / 0.111)²  +  (tan α / 0.112)²

κ   slip ratio:  (wheel surface speed − road speed) / road speed
α   slip angle:  angle between where the tyre points and where it travels
```

So s is the length of the combined slip vector, scaled so the peak (κ ≈ 11%, α ≈ 6.4°) reads 1.

**v × s is a sliding speed.** The tread's sliding speed over the road is about v·κ along the tyre plus v·tan α across it. Its size is v·|(κ, tan α)| ≈ 0.111 · v · s. So v × s is the sliding speed in "peak-slip units": a tyre at its peak (s = 1) going at 50 m/s slides as much as 50 m/s of peak-slip sliding.

**× F_z / F_ref weights it by load.** Wear needs the rubber to slide *while pressed onto the road*. Twice the load at the same sliding speed removes about twice the rubber (see [real tyres](#how-it-relates-to-real-tyres)). Dividing by 5000 N keeps the number in readable units: at 5 kN the load factor is 1.

**ẇ is therefore metres of full sliding at 5 kN, per second.**

### `Tyre Wear Lap`: integrating it over the lap

```
W_lap  =  Σ  ẇ · Δt        over the samples of the lap      [m]
```

`integrate_lap(x)` adds up x × (time between samples) and resets to zero at each lap start. The value at the end of the lap is the lap's wear: how far the tyre slid at its peak under 5 kN during the lap. At s = 1 and 5 kN, 1 km driven = 1 km of wear, the same unit as Assetto Corsa's *virtual km*.

### `Tyre Wear Rate`: the 0–100 trace

```
rate  =  clamp( smooth(v · s · max(F_z, 0), 0.2) / 5000,  0,  100 )
```

- `smooth(x, 0.2)` is a centred 0.2 s moving average. It removes sample-to-sample jitter at 30 Hz, so a lock-up shows as one clean spike.
- `/ 5000` is the same load normalisation, so the value **is** ẇ in m/s.
- `clamp(…, 0, 100)` caps it at 100 for display. 100 = 100 m/s of full sliding at 5 kN, e.g. peak slip at 240 km/h with 7.5 kN on the tyre.

Over all the data, only 0.4% of samples pass 100, all lock-ups and spins. Normal running reads about 10, and hard corners 30–75.

The scale is linear, so **the area under the trace is the wear**. `Tyre Wear Lap` uses the uncapped value, so big events are counted in full.

### Worked examples

| Moment | v | s | F_z | ẇ = v·s·F_z/5000 | Rate | Wear in 0.1 s |
|---|---|---|---|---|---|---|
| Straight, rolling | 80 m/s (288 km/h) | 0.03 | 6,000 N | 2.9 m/s | 3 | 0.3 m |
| Fast corner at the limit | 55.6 m/s (200 km/h) | 0.9 | 6,500 N | 65 m/s | 65 | 6.5 m |
| Hairpin exit, wheelspin (RL) | 25 m/s (90 km/h) | 4.0 | 5,000 N | 100 m/s | 100 | 10 m |
| Lock-up into a braking zone (FL) | 70 m/s (252 km/h) | 6.0 | 7,500 N | 630 m/s | 100 (capped) | 63 m |

A single 0.3 s lock-up like the last row adds about 190 m: an eighth of a whole lap's FL wear at Hungaroring (about 1,250 m).

### Cause split (component only)

The component also splits each sample's wear by the direction of the slip. The game scales κ and α by nearly the same peak (0.111 vs 0.112 rad), so the share of the slip that is longitudinal is:

```
f_long  =  κ² / (κ² + α²)                      (α in radians)

lock-up    =  ẇ · f_long     when κ < 0        tyre turning slower than the road: braking
wheelspin  =  ẇ · f_long     when κ > 0        tyre turning faster than the road: traction
cornering  =  ẇ · (1 − f_long)                 sliding sideways
```

The three always add up to the total.

---

## How it relates to real tyres

**Where wear comes from.**
- Almost all tread wear is rubber **sliding over the road while loaded**. A rolling tyre's tread blocks still slip a little whenever the tyre transmits force (braking, traction, cornering), and more at the limit.
- Rubber-wear research (Grosch and Schallamach) ties wear to the **frictional energy** dissipated in the contact patch: friction force × sliding distance, or roughly load × sliding distance.
- **Archard's wear law** says the same in its simplest form: worn volume ∝ normal load × sliding distance ÷ hardness. On its own it fits rubber only roughly, because rubber wears by tearing and fatigue, so the constant varies a lot with compound, road and temperature.

**What this model keeps:** exactly that product, load × sliding distance. The sliding is measured with the game's own normalised slip, so it is zero when rolling, grows with slip, and explodes in lock-ups and spins. The left/right and front/rear balance of the car comes out right because of the load term. Without it the left/right split was 17% off; with it, 3%.

**What it leaves out, deliberately:**
- **Temperature.** Real rubber abrades faster when very hot, and grains when cold. In Assetto Corsa, adding any temperature factor made the fit *worse*, so the game's rubber wear doesn't use it. Temperature still changes the grip you feel.
- **Graining and blistering.** CSP models these as separate grip losses (`Tire Grain`, `Tire Blister` channels), not as rubber wear. Look at them alongside this model when a stint falls away faster than the wear explains.
- **Compound and road abrasiveness.** These scale everything equally, so they go into the conversion factor *k* from metres to grip %, not into the metres.

**In Assetto Corsa:**
- Each tyre accumulates **virtual km**. The community description is that it builds only while the tyre is working: about 1 per km at peak grip, more or less above or below it.
- The car's `WEAR_CURVE` lookup table turns virtual km into the grip multiplier that Telemetrick logs as `Tire Rubber Grip`.
- A **wear-rate multiplier** (Content Manager, or the server's `TYRE_WEAR_RATE`) scales the whole thing.

Kunos never published the exact formula. This model is that description written as maths, plus load, and the data confirms it.

---

## How the model was found

### Data

- Every logged stint in `myTelemData`: 35 sessions, 208 laps (139 complete), about 900 km, all in the Formula Alpha 2026.
- Tracks: COTA, Hungaroring, Montreal, Sepang, Singapore and Mugello.
- Two drivers: Tyler and Martin.
- Every stint starts on fresh tyres, and `Tire Rubber Grip` never rises, so it is a clean cumulative wear counter.

### Method

1. **Extraction.** Each session was resampled to 10 Hz per tyre: speed, ndSlip, slip ratio, slip angle, Fx, Fy, load, temperatures, pressure, grain, blister, camber, wheel speed and `Tire Rubber Grip`.
2. **Windows.** Each stint was cut into 20-second windows (about 880 windows per tyre, 3,500 in all).
3. **Fit.** For a candidate wear rate r(t), its integral over each window, ΔW, was compared with the grip that window lost, ΔL:

   ```
   ΔL[session, tyre, window]  ≈  k_session · c_axle · ΔW[session, tyre, window]
   ```

   - **k_session:** one per session. It absorbs the wear multiplier and the compound, which the driving can't explain.
   - **c_axle:** one global rear-axle factor (front = 1), for different front and rear wear curves.

   Each k was solved by least squares; c by a grid search.
4. **Scores:**

   | Score | Formula | Meaning |
   |---|---|---|
   | **R²c** | 1 − Σ(ΔL − k·c·ΔW)² ÷ Σ(ΔL − mean ΔL of that session-tyre)² | Share of the window-to-window variation explained **beyond a steady wear rate per tyre**. 0 = no better than "each tyre wears at its own constant rate". This is the score that matters. |
   | **L/R** | RMS of log[(model left ÷ right) ÷ (game left ÷ right)] per session and axle | Error in the left/right split (0.03 ≈ 3%). |
   | **F/R** | the same for front ÷ rear | Error in the front/rear split. |
   | **kCV** | spread of k within sessions known to share a setting | Should be small if the model captures the driving. |

### Iterations

| # | Formula (per tyre) | R²c | L/R | F/R | Verdict |
|---|---|---|---|---|---|
| 1 | distance only: v | −0.03 | 0.16 | 0.17 | Baseline: no better than a constant rate. |
| 1 | **v × ndSlip** (the community vKM description) | **+0.81** | 0.17 | 0.08 | Strongly confirmed. The fitted rear factor ≈ 1, i.e. one curve front and rear. The left/right split is poor. |
| 1 | sliding speed v·\|(κ, tan α)\| | +0.02 | 0.20 | 0.11 | Most likely swamped by spins: tan α explodes near 90°. |
| 1 | frictional slip power \|Fx·v·κ\| + \|Fy·v·tan α\| | +0.51 | **0.07** | **0.05** | The best left/right split, but weaker overall. |
| 1 | Archard: Fz × sliding speed | +0.27 | 0.11 | 0.09 | Same problem as the sliding speed. |
| 2 | v × ndSlip^p, p = 0.7 … 1.3 | +0.75 … +0.83 | 0.17 | 0.08–0.22 | p = 1 is effectively best. |
| 2 | **v × ndSlip × Fz** | **+0.93** | **0.03** | **0.03** | **Breakthrough**: load fixes the left/right split. |
| 2 | v × ndSlip × √Fz | +0.92 | 0.08 | 0.04 | |
| 2 | wheel surface speed × ndSlip | +0.03 | 0.17 | 0.32 | Wheelspin inflates it. |
| 3 | Fz^0.8 … Fz^1.2 | +0.91 … +0.94 | 0.03–0.05 | 0.03 | All within noise, so the plain linear form was kept. |
| 3 | cap ndSlip at 2 / 5 / 10 | +0.79 / +0.85 / +0.90 | 0.03 | 0.05–0.07 | Worse: wheelspin really costs rubber. |
| 3 | × core temperature e^(β(T−90)) | +0.89 at best | 0.04 | 0.03 | Worse for every β: **the game's rubber wear doesn't use temperature**. |
| 3 | × surface temperature | +0.92 at best | 0.04 | 0.04 | Same. |
| 3 | × (1 + blister/10) | +0.92 | 0.04 | 0.06 | Worse: blistering is a separate grip penalty. |
| 3 | × pressure, + rolling term, + slip-power blend | +0.89 … +0.92 | 0.03 | 0.03–0.05 | No gain. |
| 5 | speed gate: none / 5 / 15 / 30 km/h | **+0.94** / +0.94 / +0.93 / +0.91 | 0.03 | 0.03–0.04 | **No gate**: wheels spinning while the car is nearly stopped (spins) still wear the tyres. |
| 6 | final model, 60-second windows | **+0.97** | 0.03 | 0.03 | Distance alone: +0.30. |

Two more findings:
- **The wear curve is linear.** Grip lost per metre of wear stays within ±1% from the first fifth of a stint to the last (±5% scatter), so no curve correction is needed.
- **The 0–100 scale** was first 60 m/s full scale, but that clipped for whole corners at Hungaroring. It was widened to 100 m/s, which clips 0.4% of the time.

---

## How it was verified

1. **Against the game, lap by lap, on every session.** The shipped code was run over all 35 sessions. Each lap's modelled wear was compared with the grip the game removed, for each tyre, with one scale per session. **Median R² = 0.95** (0.80 to 0.99).
   - The low exception is a Mugello stint where every lap lost 1.3–1.4% grip, so there is almost no variation to explain (R² 0.40). Its individual laps still match: its one heavier lap is also heavier in the model.

2. **The scale factors group like the game's settings.** If the model captures the driving, each session's k should only reflect the wear multiplier and compound. It does: k falls into tight groups, and within a group it varies by only about 8%.

   | Sessions | k (grip % per km) | Reading |
   |---|---|---|
   | Hungaroring, Sepang, COTA Sept, COTA 24/10 from 11:30 (compound 2) | 1.10 – 1.22 | 1× |
   | Montreal and Singapore (compound 2); Hungaroring and Mugello on compound 0 | 1.99 – 2.40 | ≈ 2× |
   | COTA 23/10 and 24/10 morning | 5.42 – 5.64 | ≈ 5× |
   | Mugello, compound 3 | 0.84 | slower-wearing compound |

   The same track, car and compound went from 5× to 1× at 11:30 on 24/10: a settings change. So **raw `Tire Rubber Grip` can't be compared between sessions, but wear metres can**.

3. **Left/right and front/rear balance.** The model predicts each axle's left/right wear split within about 3%, and the front/rear split within about 3% (after the single rear factor of 0.9).

4. **Incidents.** Montreal 25/10 23:05: a spin at 585 s (20 km/h, 240° of lock, rear slip ratio above 1900%) cost RL 5.0% grip in 40 seconds. The model predicts about 4%; distance alone predicts 0.6%.

5. **Two drivers, one track** (Hungaroring, compound 2, both 1×):
   - On push laps Tyler averages about 1,580 m of RL wear per lap against Martin's 1,470 (+7%), and about 1,250 m of FL against 1,150 (+9%). The game's grip channel shows the same gap.
   - The extra is mostly **cornering slide** around 600–700 m, 2000–2100 m, 2700–2800 m, 3500–3600 m and 4000–4100 m, plus a front **lock-up** at 1000–1100 m.
   - Tyler's lap 2 (92.0 s) used about 1.6× a normal lap's rear wear, half of it **wheelspin**.

6. **Automated tests** (`tests/tyreWear.test.ts`, on the bundled Singapore session):
   - Model wear correlates with the game's grip loss (r > 0.9).
   - The causes add up to the total.
   - The sections add up to the lap.
   - The math channels match the component, and the rate stays within 0–100.

**Check it yourself:** put `Tyre Wear Lap RL` (stat = last) and `Tire Rubber Grip RL` (stat = change over lap) in two Lap Trends for one session. They should move together lap by lap.

---

## Limits

- **Needs Telemetrick's tyre channels:** `ndSlip`, `Tire Load` and `Ground Speed`, plus `Tire Slip Ratio` and `Tire Slip Angle` for the cause split. Loggers without ndSlip aren't supported.
- **Fitted on one car** (Formula Alpha 2026, CSP). The formula's form comes from how AC accumulates wear, so it should transfer to other AC cars. The 0–100 scale suits fast, high-downforce cars; slower cars will read lower. The metres stay comparable regardless.
- **Wear is not total grip.** Blistering, graining and temperature change grip separately. Check them when a stint falls away faster than the wear explains.
- **Predicted grip % needs k.** Compare metres between sessions with different settings, not grip %.

---

## Sources

- [Rubber Wear: History, Mechanisms, and Perspectives (arXiv 2503.19494)](https://arxiv.org/html/2503.19494v2): wear from tread slip; Grosch and Schallamach's frictional-energy link; the limits of Archard's law for rubber.
- [Steam community: tyre wear in Assetto Corsa](https://steamcommunity.com/app/244210/discussions/0/571541224065967018/) and [Overtake: creating a tyre wear profile](https://www.overtake.gg/threads/creating-tyre-wear-profile.157504/): `WEAR_CURVE` lookup tables and virtual km.
- [How to tune physics & tyre wear in Assetto Corsa (FreakHosting)](https://help.freakhosting.com/games/assetto-corsa/tweaking-physics-and-tyre-wear) and [server_cfg.ini explained](https://connecthosting.net/blog/assetto-corsa-server-cfg-ini-explained): the `TYRE_WEAR_RATE` multiplier.
- [CSP: Tyres FX](https://cup.acstuff.club/docs/csp/cars/tyres-fx) and [CSP: enabling extended physics](https://cup.acstuff.club/docs/csp/cars/enabling-extended-physics): CSP tyre wear, grain and blister visuals and extended physics.
