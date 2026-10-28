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

### The Tyre Deg workspace (start here)

**Tyre Deg** is a clean workspace built for tyre degradation. It has five worksheets, each answering one question, read in order. Comparisons use bars rather than rings, so you compare straight lengths. Each sheet has at most four components.

| Sheet | The question | What's on it |
|---|---|---|
| **1 · Lap** | How much did this lap wear the tyres, and how is it split? | Whole-car summary (the comparison lap as a difference) · each tyre as bars · front vs rear and left vs right · where on the track the comparison lap wears more (red) or less (green) |
| **2 · Lap corners** | Which corners cost rubber on this lap, and why? | The corner table (click a corner) · that corner's bars per tyre |
| **3 · Stint** | How did the wear build up, and how do the stints compare? | Average lap per stint for the whole car and per tyre · lap times with the **107%** filter · wear through the stint (per lap or cumulative) |
| **4 · Stint corners** | Where does each stint wear more on average? | The corner table in **stint average** mode · that corner's bars per tyre, averaged · lap times with the 107% filter, which decides the laps averaged |
| **5 · Corner traces** | Why does this corner wear more? | Speed · steering · throttle and brake · brake-steer combination · front and rear wear by cause (lock-up / wheelspin / slide) · a corner picker that zooms the traces · racing lines |

How to use it:
- **Pick laps:** select a reference lap and a comparison lap (Ctrl/⌘ + click). For stints, select a lap in each stint you want to compare.
- **Follow one corner:** clicking a corner on sheet 2, 4 or 5 makes it the corner everywhere. The bars follow it, and the traces on sheet 5 zoom to it.
- **On sheet 5:** look for the cause that's higher in the wear panes, then read up the traces. More cornering slide often lines up with more steering at the same speed, or with braking deeper while turning (the brake-steer pane).

The older **FA26 Tyre Deg** workspace still has the longer set of sheets described below.


### The worksheets

There are nine tyre-wear worksheets, going from a quick look to scrubbing through one corner. The **FA26 Tyre Deg** workspace has them; the Starter has the first two. To put any of them in another workspace, right-click the tab → **Copy worksheet**, then paste it there. Any math channels it needs come along with it.

| Worksheet | What it's for | What's on it |
|---|---|---|
| **Tyre Wear** | The quick look: which tyre works hardest, why, and where the comparison lap differs. Everything is the average of the four tyres. | Tyre Wear Summary (whole car) · Tyre Wear Wheels · Tyre Wear component (one averaged card + corner table) · Δ wear-rate track map · wear rate by cause along the lap · wear per lap through the stint |
| **Tyre Wear Detail** | The same, tyre by tyre. | Wear rate per tyre · four Δ maps laid out like the car · Tyre Wear component with four cards · four per-lap trends |
| **Wear Balance** | Front axle vs rear, left side vs right: how much, as a %, and what makes up each gap. | Just the reference and comparison laps: Tyre Wear Balance cards · both balances along the lap · the four wheels · two maps coloured front-vs-rear and left-vs-right |
| **Wear by Corner** | Which corners cost rubber, and why. | Corner table in lap order (switch to *Most extra wear* to rank them; click one) · the clicked corner's wheels, with ring length = wear · Corner Report (time in corner) · Δ map · racing lines · driver inputs at the cursor |
| **Wear by Corner – Stint** | Wear by Corner over whole stints: where the wear builds and why, without lap-to-lap variance. | The Tyre Wear table in **stint average** mode (each corner averaged over each selected stint's laps) · lap times with the **107%** filter · average lap per stint for the whole car · the wheels for the clicked corner, averaged over the stint |
| **Wear Deep Dive – Fronts** | Scrub through a corner and see what builds front wear. | One graph: speed · steering angle · brake and throttle · **brake-steer combination** · front **lock-up** · front **wheelspin** · front **cornering slide** · front **left − right**. Beside it: the FL and FR wheels for the clicked corner, tyres at the cursor, racing lines. |
| **Wear Deep Dive – Rears** | The same for the rears, where traction matters. | Speed and **gear** · throttle and brake · steering angle (counter-steer) · rear lock-up · rear wheelspin · rear cornering slide · rear left − right. Beside it: the RL and RR wheels, tyres at the cursor, racing lines. |
| **Wear Stint** | How the stint went, and how the wear built up. | Average lap per stint for the whole car (Tyre Wear Summary; follows the 107% filter) · Stint report · lap times with the **107%** filter (on) · wear per lap with a fit line · **cumulative wear** (the running total through the stint) · **blistering** and **graining** (RL) side by side, i.e. grip lost on top of the wear |
| **Wear Stint – Tyres** | The stint, tyre by tyre. | Average lap per selected stint for each tyre (Tyre Wear Summary, per tyre; follows this sheet's 107% filter) · lap times with the **107%** filter · wear per lap for FL, FR, RL and RR with fit lines (each switchable to cumulative) |

**How the deep dives are laid out.**
- **One trace per lap in every wear pane.** Each cause has its own pane (lock-up, wheelspin, cornering slide) and shows the axle: left and right averaged. When you compare two laps, the reference is drawn in the cause colour and the comparison in its lap colour, one line each, so they never get mixed up. Six panes (three causes × two tyres) would have been twelve overlapping lines once a comparison lap is on.
- **Left versus right** has its own pane: **left − right** wear rate. Above 0, the left tyre is wearing faster there; below 0, the right. For each tyre's own split, look at the axle's two **wheels** on the right; they follow the corner you click.
- **Above the wear panes are the inputs that cause it**, so you can see what happened just before the wear rises.

| Pane | Why it's there |
|---|---|
| Speed (and **gear** on the rears) | Where in the corner you are; wheelspin comes from throttle in a low gear. |
| Steering angle | Turn-in, mid-corner corrections and counter-steer. |
| Brake and throttle | When the tyres are asked to brake or drive. |
| **Brake-steer combination** (fronts) | Trail braking loads the fronts in two directions at once: a lock-up or slide risk. |
| Lock-up / wheelspin / cornering slide | What is wearing the tyres at each moment. The three add up to the axle's wear rate. |
| Left − right | Which side of the axle is doing more of the wearing. |
| Tyres at the cursor | Wear rate (**Rate**), ndSlip (**nd**, 1 = at the grip peak), load, slip angle, slip ratio and surface temperatures for all four tyres at the cursor. Surface temperatures flash up when a tyre slides. |

### Stint averages (Laps | Stint avg)

The Tyre Wear component has a **Laps | Stint avg** switch, and the wheels have the same choice in Properties (*Compare*). With **Stint avg**, each selected lap is replaced by its stint's **average lap**:
- **Which laps count:** the stint's complete laps, minus any the worksheet's 107% filter leaves out. Move the slider and everything updates.
- **What gets averaged:** every number is the average over those laps. That includes each corner and straight (an average T1, an average T5…), the cause split, the per-tyre cards and the clicked corner's wheels and pop-out. Lap-to-lap variance drops out, leaving a steadier picture of where each driver wears the tyres and why.
- **Which stints are compared:** each stint with the reference or a comparison lap selected. The reference's stint comes first, and the others show as differences from it. Rows are labelled with the driver ("Lewis avg"); hover a card row to see the laps used.
- **What can't be averaged:** racing lines and the along-the-lap graphs stay per lap. Compare those one lap at a time.

### Cumulative wear

Every wear-per-lap chart (any trend of a `Tyre Wear Lap …` channel) has a **Per lap | Cumulative | Gap to ref** switch in its top-right corner.
- **Cumulative** adds each lap's wear to a running total through the stint, so over a long run you can see the gap between two drivers grow lap by lap. The Wear Stint sheet has one set to cumulative.
- **Gap to ref** plots each stint's running total minus the reference stint's at the same lap number. The reference stint is the flat line at 0, and the other stints show how far ahead or behind on wear they are, e.g. *−1325 m* after lap 7. The whole chart height is spent on the difference, so the end-of-stint gap is easy to read. A linear fit gives the gap per lap. Laps the reference stint doesn't have are left out.
- Every complete lap counts, including laps the 107% filter leaves out of the other charts: a slow lap still wore the tyres, so leaving it out would understate the total. Out and in laps aren't counted.
- The fit line works on the running total too. With a linear fit, the slope is the average wear per lap.
- Any other channel trend can be made cumulative in Properties.

### Tyre Wear Summary

The whole car over the whole lap, as numbers only:
- **All four tyres** added up (FL + FR + RL + RR), in metres.
- **Lock-up, wheelspin and cornering slide**, each added up over the four tyres. They sum to the total.
- **The reference lap** shows its metres. **Comparison laps** (up to three) show their difference from the reference: in metres with **m**, or as % of the reference with **%**. Red = more wear than the reference, green = less. Hover a difference to see that lap's own metres.
- The **m / %** switch sits in the table's top-left corner. Properties sets how many comparison laps to show.
- **Stint average** (Properties → *Rows*, used on the **Wear Stint** sheet): one row for each stint that has the **reference or a comparison lap selected** (the reference's stint first), showing its **average lap**. Other open stints are left out. The average uses the stint's complete laps (no out or in lap), minus any the worksheet's **107% filter** drops. Turn the filter off and every complete lap counts. Move the slider and the averages update straight away. The first stint is shown in metres and the others as differences from it. Hover a row to see which laps were averaged.
- **Per tyre** (Properties): four small tables laid out like the car (FL FR / RL RR), each with that tyre's total and its lock / spin / slide, using the same rows and m / % switch. The **Wear Stint – Tyres** sheet uses this with stint averages.

### Tyre Wear Wheels

A component that shows each tyre as a wheel. Its **rubber is a ring split into lock-up (red), wheelspin (amber) and cornering slide (blue)**, so one glance says which tyre works hardest and why.

- **Reference and comparison laps.** The **reference is the outer ring** and **comparison laps are the inner rings**, each outlined in its lap colour. A key at the top shows a mini wheel with each ring named: *outer **REF** Lap 6 · inner **CMP** Lap 5*. The centre shows the reference's wear (*96 m · REF*) and the comparison's difference (*CMP −23 m*; red = more wear, green = less).
- **Under each wheel**, one labelled row per lap: **REF** / **CMP**, then lock-up · wheelspin · cornering slide **in metres**, e.g. *REF 89 m · 0 m · 7 m*, and the comparison's total difference. These are raw metres rather than percentages, because a percentage is a share of a different total on each lap, so it can't be compared between laps.
- **m / % switch** (top right of the component, no need for Properties):
  - **m** (default): the causes and the comparison's difference in metres.
  - **%**: each cause as a share of that lap's wear on the tyre, and the difference as % of the reference, e.g. *REF 12% · 0% · 88% = 30 m*, *CMP 34% · 0% · 66% = 40 m (Δ +30%)*. The centre shows *CMP +30%*. Totals always stay in metres.
- **Shape** (Properties): **Rings** (default), or **Bars**. Bars draw each tyre as one straight horizontal bar per lap, split into lock-up / wheelspin / slide, with REF on top and CMP below. Each tyre stays in its corner of the car (FL top-left … RR bottom-right). Comparing straight lengths is easier than comparing rings of different radii. With *the amount*, every bar on every tyre shares one scale. Each bar shows its metres, and the comparison's difference in m or % (per the m / % switch).
- **Rings / bars** (Properties):
  - **The mix** (default): every ring goes all the way round, so you compare *what causes* the wear.
  - **The amount**: ring length is the wear itself (the longest goes all the way round), so a tyre or lap that wears less has a shorter ring. The Wear by Corner sheet uses this.
- **Tyres:** all four (default), **the front or rear axle** (the deep dives show just their axle), one tyre, or the average of the four. Up to two comparison laps can be shown as inner rings.
- **It follows the corner you click** in any Tyre Wear table or Corner Report, on any worksheet. The heading shows the corner; **✕** goes back to the whole lap. Turn this off in Properties if you want a wheel that always shows the whole lap.
- There is no help text underneath, so the wheels fill the panel. The metres under each wheel stay.

### Tyre Wear Balance

Compares **the front axle with the rear** and **the left side with the right**. Each side is its two tyres averaged (front = FL, FR; rear = RL, RR; left = FL, RL; right = FR, RR), so the numbers are per tyre and the axles compare fairly.

**Cards (selected laps).** One card for front vs rear and one for left vs right. Each has a **REF** row, and a **CMP** row for the comparison lap:
- **The gap and what it's made of**, e.g. *"Rear +422 m (38% more per tyre): wheelspin +629 · cornering slide −115 · lock-up −91"*. The heavier side, by how much, then the gap split by cause, biggest first. A negative part means the lighter side has more of that cause.
- **The split bar:** each side's share of the wear, e.g. *Front 42% | Rear 58%*. The middle line marks 50 / 50.
- **Each side's own make-up:** a lock-up / wheelspin / slide bar and the metres, e.g. *Rear 109 · 629 · 807 = 1 545 m*.

They follow the corner you click in a Tyre Wear table or Corner Report, like the wheels.

**Lap by lap (off by default; tick *Lap-by-lap table* in Properties).** Below the cards is a table for each open stint. For every complete lap it shows both splits, the gap and its main cause, and a **One-off?** column:
- A lap is flagged **⚠** when its gap for one cause is far from what's usual in that stint: more than 4.5× the typical lap-to-lap spread, **and** at least 5% of a lap's wear per tyre (never under 50 m), so ordinary lap-to-lap wobble isn't flagged. The flag appears on a line under the lap and names the cause, size and side, e.g. *⚠ wheelspin +691 m on the rear (front vs rear)*.
- That answers *"is the left wearing more because of how I drive, or because of one lap?"* A steady gap with no flags is driving style. A flag means one event (a lock-up, a spin, a big moment) pulled that lap out of step.
- Laps over the worksheet's 107% cut-off are left out.
- Click a lap to make it the reference; Ctrl/⌘ + click adds it as a comparison.

On your Hungaroring stint:
- **Front vs rear:** the rears take about 58% of the wear on every lap, and the gap is almost all **wheelspin**. That's the car, not one event.
- **Left vs right:** the left takes about 55%, mostly **cornering slide**. Hungaroring is mainly right-handers, which load the left.
- **One-offs:** your 1:32 lap 2 is flagged with a wheelspin one-off on the rear.

**Balance channels** (on the Wear Balance sheet; also usable anywhere):

| Channel | What it is |
|---|---|
| `Tyre Wear Front-Rear` | Front minus rear wear rate along the lap. Above 0 = the fronts are wearing faster there. A map coloured by it is red where the fronts wear more, blue where the rears do. |
| `Tyre Wear Left-Right` | Left minus right. Above 0 = the left wears faster: red on the map. |
| `Tyre Wear Front Share` | The fronts' share of the lap's wear, in % (50 = even). Trend its end-of-lap value to see the balance lap by lap. |
| `Tyre Wear Left Share` | The left side's share, in %. |

### Tyre Wear component

It works on the selected laps: the reference and any comparisons.

**Lap cards.** These follow the **Avg / FL / FR / RL / RR** buttons:
- With **Avg**, you get your preference (**Properties → Lap cards**): one card per tyre, or one card averaging the four.
- With a tyre button, you get just that tyre's card.

Each row is a selected lap:

| Column | What it means |
|---|---|
| Bar | Length is the lap's wear. Colours split it into **lock-up** (red), **wheelspin** (amber) and **cornering slide** (blue). Hover for the percentages. |
| Metres | Wear in metres of full sliding at 5 kN (see [the math](#the-math-channels-term-by-term)). |
| Δ % | Wear against the reference lap on the same tyre. Red = more wear, green = less. |
| −x.xx % | Grip the game took off the tyre over the lap (`Tire Rubber Grip`). Hover it for the [game wear factor](#game-wear-factor-validation). **Off by default**; turn it on in Properties (*Game's grip loss … and the game wear factor*). |

**Where table.** The lap is split into your corners (from the track profile) or into 200 m mini-sectors. Each row shows:
- **Reference lap:** its wear in that section, and its lock-up / wheelspin / slide bar.
- **Each comparison lap:**
  - the difference to the reference (**Δ**) and a gain/loss bar
  - the cause that changed most, e.g. *cornering slide*, or *less lock-up* when it went down

Turn on **Breakdown** to also see each comparison lap's own wear and its cause bar. All the cause bars share one scale, so their lengths compare across laps and rows.

**Click a row** to look at that corner on its own:
- The graphs zoom to it.
- The row stays highlighted.
- A **pop-out** opens with the corner's wheels: all four tyres with **Avg**, or the chosen tyre on its own. Next to them, a table of lock-up / wheelspin / slide / total in metres for the reference and each comparison lap, with the differences.
- Every Tyre Wear Wheels component switches to that corner.

Click the row again, or **✕**, to close. The Wear by Corner sheet turns the pop-out off (**Properties → Clicking a row opens that section's pop-out**) because its wheels already show the corner.

Controls:
- **Avg / FL / FR / RL / RR** chooses the tyre: the four averaged, or one. This also switches the cards.
- **Corners / 200 m** chooses the sections.
- **Straights** adds the straights between corners. It's **off by default**, as in the Corner Report; the whole-lap total always counts them.
- **Breakdown** adds each comparison lap's own wear and cause bar.
- **Lap order / Most extra wear** sorts the rows around the lap or by the worst sections first.
- **Hover** a row to highlight it on the track maps.

The line under the table summarises the first comparison lap, for example:

> L5 vs reference: −3.1% tyre wear overall; biggest extra wear in T8 (+35 m, cornering slide).

### Game wear factor (validation)

**The modelled wear does not change with the game's wear setting.** It is calculated only from speed, slip and load, so a lap driven the same way gives the same metres at 1× or 5×. The setting only changes how much grip the game removes for that wear. Your COTA stints show it:

| COTA, same car, track and compound | Game's grip loss per km of modelled wear | Model wear per lap (average tyre) |
|---|---|---|
| 23/10 and 24/10 morning (5× setting) | 5.4 – 5.7 %/km | 1,560 – 1,620 m |
| 24/10 from 11:30 (1× setting) | 1.10 – 1.12 %/km | 1,610 – 1,750 m |

To check a setting yourself:
- Turn on **Properties → Game's grip loss … and the game wear factor** (it's off by default).
- Hover the **ⓘ Game wear factor** line under the table, or any **−x.xx %** value.
- It reads e.g. *"Game wear factor: 2.31 % grip per km of modelled wear ≈ 2.0× the 1× rate for compound 2 (1.16 %/km)"*.
- It is worked out over the whole session: the four tyres' total grip lost ÷ their total modelled wear.
- The **≈ N×** part needs a recorded 1× rate for the compound. So far only compound 2 has one (1.16 %/km, from your Hungaroring, Sepang and COTA 1× stints). For other compounds it shows the raw %/km. Your compound-0 sessions read about 2.2–2.4 %/km and compound 3 about 0.84 %/km, but which wear setting they ran isn't known.

### Track map: difference to the reference

Any Track Map coloured by a channel can show **comparison lap − reference** instead of the raw value: **Properties → Colouring → Difference: comparison lap − reference**.

- Both laps are compared at the same lap distance, on a 4 m grid.
- The difference is averaged over the **smoothing** distance (48 m on the tyre wear sheets).
- Full colour is reached at the 95th percentile of the difference, adjusted by the **sensitivity** slider.
- With several comparison laps, right-click the map, or click the legend, to choose which one.

### A workflow for "why did my tyres go off faster?"

1. Open both stints. Make your representative lap the reference, and your team-mate's lap a comparison (Ctrl/⌘ + click).
2. On **Tyre Wear**:
   - The **wheels** show which tyre works hardest and what's doing it.
   - The **per-lap trend** shows whether the gap is one or two laps (an incident) or every lap (driving style).
3. On **Wear by Corner**, the table is ranked by extra wear. Click the top corner: the wheels show which tyre and which cause. The racing lines and the minimum speed show what was different.
4. Go to **Wear Deep Dive – Fronts** or **Rears**. The graphs are already zoomed to that corner. Scrub through it:
   - Watch the cause traces rise.
   - Look at what happened just before: steering rate, brake, throttle, ndSlip, slip angle or ratio.
   - Compare with your team-mate's lap, drawn in its lap colour.
5. On **Wear Stint**, check that the game agrees: the rubber-grip slope, plus blistering or graining if grip falls faster than the wear explains. The **≤ 107%** filter on the lap-time chart leaves slow laps (traffic, spins, cool-down laps) out of every trend on that sheet and its fit lines.

### Blistering vs graining

Both are grip the tyre loses **on top of** rubber wear. CSP's tyre model logs them as `Tire Blister` and `Tire Grain`, and they appear side by side on **Wear Stint**, each with a one-line explanation (hover for more).

| | **Blistering** | **Graining** |
|---|---|---|
| In one line | The tyre is **too hot** | The tyre is **too cold for the sliding it does** |
| What happens | The rubber overheats inside (core or surface well above its window) for too long. Gas bubbles form under the surface and chunks of tread tear out. | The tread slides while it's below its working temperature. The surface tears into small rolls or balls of rubber that sit on the tread like ball bearings. |
| Typical causes | Lots of sliding, pushing on a hot or worn tyre, low pressure, a hot track | Cold track, early laps, a hard or cold compound, too much lateral slide |
| Does it go away? | **No.** The grip is gone, and it keeps growing while the tyre stays hot. | **It can.** Once the tyre is up to temperature and the loose rubber wears off, the grip comes back. |
| What to do | Slide less (smoother inputs), run the tyre cooler (pressure / camber), back off for a lap | Get temperature in first, avoid sliding a cold tyre |
| In your data | Builds through every long stint (e.g. Martin's Hungaroring stint reaches 6 on RL) | Only on the cooler days (road 22–24 °C: Sepang, COTA in September); zero at Hungaroring |


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

There are 37 wear channels in the default library: the rate and per-lap wear for each tyre (FL, FR, RL, RR), the rate split by cause for each tyre, the causes per axle and each axle's left − right balance, front-vs-rear and left-vs-right balances, and averages of the four. The FL versions, exactly as in the Math editor:

```text
Tyre Wear Rate FL  =  clamp(smooth('Ground Speed' [m/s] * 'ndSlip FL' * max('Tire Load FL', 0), 0.2) / 5000, 0, 100)
Tyre Wear Lap FL   =  integrate_lap('Ground Speed' [m/s] * 'ndSlip FL' * max('Tire Load FL', 0) / 5000)      [m]

Tyre Wear Rate Avg =  ('Tyre Wear Rate FL' + 'Tyre Wear Rate FR' + 'Tyre Wear Rate RL' + 'Tyre Wear Rate RR') / 4
Tyre Wear Lap Avg  =  ('Tyre Wear Lap FL' + 'Tyre Wear Lap FR' + 'Tyre Wear Lap RL' + 'Tyre Wear Lap RR') / 4   [m]

Tyre Wear Lock-up FL    =  clamp(smooth(v·s·F_z  ×  choose('Tire Slip Ratio FL' < 0, f_long, 0), 0.2) / 5000, 0, 100)
Tyre Wear Wheelspin FL  =  clamp(smooth(v·s·F_z  ×  choose('Tire Slip Ratio FL' > 0, f_long, 0), 0.2) / 5000, 0, 100)
Tyre Wear Slide FL      =  clamp(smooth(v·s·F_z  ×  (1 − f_long), 0.2) / 5000, 0, 100)
    where  v·s·F_z = 'Ground Speed' [m/s] * 'ndSlip FL' * max('Tire Load FL', 0)
           f_long  = sqr('Tire Slip Ratio FL' / 100) / max(sqr('Tire Slip Ratio FL' / 100) + sqr(rad('Tire Slip Angle FL')), 0.000000001)
Tyre Wear Lock-up Avg etc. = the four tyres' cause channels / 4
Tyre Wear Lock-up Front  =  ('Tyre Wear Lock-up FL' + 'Tyre Wear Lock-up FR') / 2      (likewise Wheelspin / Slide, and Rear with RL, RR)
Tyre Wear Left-Right Front  =  'Tyre Wear Rate FL' - 'Tyre Wear Rate FR'               (Rear: RL − RR; above 0 = the left wears faster)
Tyre Wear Front-Rear   =  (Rate FL + Rate FR) / 2 − (Rate RL + Rate RR) / 2
Tyre Wear Left-Right   =  (Rate FL + Rate RL) / 2 − (Rate FR + Rate RR) / 2
Tyre Wear Front Share  =  100 × (Lap FL + Lap FR) / max(Lap FL + Lap FR + Lap RL + Lap RR, 1)     [%]
Tyre Wear Left Share   =  100 × (Lap FL + Lap RL) / max(Lap FL + Lap FR + Lap RL + Lap RR, 1)     [%]
```

The three cause channels split each moment's wear rate by the direction of the slip ([cause split](#cause-split-component-and-cause-channels)). They add up to `Tyre Wear Rate`, within about 1% (the 0–100 cap can trim a big spike). The deep-dive sheets draw them in the cause colours, so a pane shows at a glance whether the wear in a corner comes from a lock-up, wheelspin or a slide.

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

### Cause split (component and cause channels)

The component also splits each sample's wear by the direction of the slip. The game scales κ and α by nearly the same peak (0.111 vs 0.112 rad), so the share of the slip that is longitudinal is:

```
f_long  =  κ² / (κ² + α²)                      (α in radians)

lock-up    =  ẇ · f_long     when κ < 0        tyre turning slower than the road: braking
wheelspin  =  ẇ · f_long     when κ > 0        tyre turning faster than the road: traction
cornering  =  ẇ · (1 − f_long)                 sliding sideways
```

The three always add up to the total. The cause channels use exactly this formula, with the slip ratio converted from % (÷ 100) and the slip angle from degrees (`rad`); `max(…, 0.000000001)` only stops a divide-by-zero when both are exactly 0.

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
   - The three cause channels add up to the wear rate (within 3%) and give the same slide share as the model (within 3 points).
   - Every channel the six worksheets use exists, either logged or in the default math.
   - The game wear factor of the bundled Singapore session reads about 2× (it ran a 2× wear rate).

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
