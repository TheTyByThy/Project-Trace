// Math channels that ship with the default workspace. They target Telemetrick/Assetto Corsa channel
// names; in sessions that lack an input channel they simply show as "unavailable" in the editor.

import type { MathChannelDef } from '../core/math/evaluate';

let n = 0;
const def = (name: string, expr: string, unit: string, description: string, dps = 2): MathChannelDef => ({
  id: `m${++n}`,
  name,
  expr,
  unit,
  dps,
  description,
  enabled: true,
});

const corners = ['FL', 'FR', 'RL', 'RR'];

export const DEFAULT_MATH_CHANNELS: MathChannelDef[] = [
  def('Combined G', "hypot('CG Accel Lateral', 'CG Accel Longitudinal')", 'G', 'Total horizontal acceleration — the radius of the friction circle.'),
  def(
    'Corner Radius',
    "gate(min(('Ground Speed' [m/s]) ^ 2 / (abs('CG Accel Lateral') * 9.81), 2000), abs('CG Accel Lateral') > 0.3)",
    'm',
    'Radius of the path the car is on (speed² ÷ lateral acceleration), shown while cornering (> 0.3 G). Smaller = tighter line; compare laps to see who opened the corner up.',
    0,
  ),
  def('Steering Rate', "derivative('Steering Angle')", 'deg/s', 'How fast the driver turns the wheel; spikes show corrections.', 0),
  def('Throttle Brake Overlap', "choose('Throttle Pos' > 5 and 'Brake Pos' > 5, 1, 0)", '', '1 while throttle and brake are both applied.', 2),
  def('Coasting', "choose('Throttle Pos' < 2 and 'Brake Pos' < 2 and 'Ground Speed' > 30, 1, 0)", '', '1 while neither pedal is used (lost time!).', 2),
  def('Full Throttle', "choose('Throttle Pos' > 98, 1, 0)", '', '1 at full throttle. Mean over a lap = full-throttle fraction.', 2),
  def('Braking Time Lap', "integrate_lap(choose('Brake Pos' > 5, 1, 0))", 's', 'Accumulated braking time within the lap.', 1),
  // Brake + steering combining (trail braking). Each input is normalised to 0–1 with a deadband so
  // straight-line braking and coasting through a corner read zero; steering is scaled to 90° of wheel.
  def(
    'Brake Steer Combination',
    "100 * sqrt(clamp(('Brake Pos' - 2) / 98, 0, 1) * clamp((abs('Steering Angle') - 5) / 85, 0, 1))",
    '%',
    'How much braking and steering are combined at once (trail braking): the geometric mean of brake (2–100 %) and steering lock (5–90°). 0 = either input alone, 100 = full brake at 90° lock. Edit the 85/90° scale to suit the car.',
    1,
  ),
  def(
    'Brake Steer Combination Lap',
    "integrate_lap('Brake Steer Combination' / 100)",
    's',
    "Accumulated brake–steer combining in the lap, in seconds of 'full brake at full lock'. Use the lap's last value (Trend: stat = last) to compare how much each lap trail-brakes.",
    2,
  ),
  def(
    'Trail Braking Time Lap',
    "integrate_lap(choose('Brake Pos' > 5 and abs('Steering Angle') > 10, 1, 0))",
    's',
    'Time in the lap spent braking (> 5 %) with steering lock on (> 10°).',
    1,
  ),
  ...corners.map((c) =>
    def(`Damper Velocity ${c}`, `derivative('Damper Travel ${c}')`, 'mm/s', `Damper speed (${c}). Positive = bump, negative = rebound.`, 0),
  ),
  ...corners.map((c) =>
    def(
      `Tyre Temp Avg ${c}`,
      `('Tire Temp Inner ${c}' + 'Tire Temp Middle ${c}' + 'Tire Temp Outer ${c}') / 3`,
      'C',
      `Average surface temperature across the ${c} tread.`,
      1,
    ),
  ),
  ...corners.map((c) =>
    def(`Tyre Temp Spread ${c}`, `'Tire Temp Inner ${c}' - 'Tire Temp Outer ${c}'`, 'C', `Inner minus outer temperature (${c}) — a camber indicator.`, 1),
  ),
  // Tyre wear (src/core/tyreWear.ts, docs/14-tyre-wear.md): speed × normalised slip × load — the load-weighted
  // sliding distance that drives Assetto Corsa's rubber wear. 100 = 100 m/s of it (peak slip at 240 km/h, 7.5 kN).
  ...corners.map((c) =>
    def(
      `Tyre Wear Rate ${c}`,
      `clamp(smooth('Ground Speed' [m/s] * 'ndSlip ${c}' * max('Tire Load ${c}', 0), 0.2) / 5000, 0, 100)`,
      '',
      `How fast the ${c} tyre is wearing right now, 0–100 (speed × normalised slip × load). Colour a track map by it to see where the rubber goes: lock-ups, wheelspin and slides light up.`,
      0,
    ),
  ),
  ...corners.map((c) =>
    def(
      `Tyre Wear Lap ${c}`,
      `integrate_lap('Ground Speed' [m/s] * 'ndSlip ${c}' * max('Tire Load ${c}', 0) / 5000)`,
      'm',
      `${c} tyre wear accumulated in the lap: metres of full sliding at 5 kN. Proportional to the grip the game takes off (Tire Rubber Grip); use the lap's last value in a Lap Trend to compare laps, stints and drivers.`,
      0,
    ),
  ),
  // The wear rate split by cause, on the same 0–100 scale (they add up to Tyre Wear Rate): the longitudinal
  // share of the slip is sr² / (sr² + α²) — lock-up when the slip ratio is negative, wheelspin when positive —
  // and the rest is cornering slide. Shown in the cause colours on the wear deep-dive worksheets.
  ...corners.flatMap((c) => {
    const base = `'Ground Speed' [m/s] * 'ndSlip ${c}' * max('Tire Load ${c}', 0)`;
    const sr2 = `sqr('Tire Slip Ratio ${c}' / 100)`;
    const long = `${sr2} / max(${sr2} + sqr(rad('Tire Slip Angle ${c}')), 0.000000001)`;
    const rate = (share: string) => `clamp(smooth(${base} * ${share}, 0.2) / 5000, 0, 100)`;
    return [
      def(`Tyre Wear Lock-up ${c}`, rate(`choose('Tire Slip Ratio ${c}' < 0, ${long}, 0)`), '', `Part of the ${c} wear rate from lock-ups / braking slip (negative slip ratio), 0–100.`, 0),
      def(`Tyre Wear Wheelspin ${c}`, rate(`choose('Tire Slip Ratio ${c}' > 0, ${long}, 0)`), '', `Part of the ${c} wear rate from wheelspin / traction slip (positive slip ratio), 0–100.`, 0),
      def(`Tyre Wear Slide ${c}`, rate(`(1 - ${long})`), '', `Part of the ${c} wear rate from cornering slide (slip angle), 0–100.`, 0),
    ];
  }),
  ...(['Lock-up', 'Wheelspin', 'Slide'] as const).map((k) =>
    def(`Tyre Wear ${k} Avg`, `(${corners.map((c) => `'Tyre Wear ${k} ${c}'`).join(' + ')}) / 4`, '', `${k === 'Slide' ? 'Cornering-slide' : k} part of the wear rate, averaged over the four tyres.`, 0),
  ),
  // Per axle: each cause averaged over left and right (one trace per lap, so two laps compare cleanly), and
  // the left − right balance of the wear rate (positive = the left tyre is wearing faster).
  ...(
    [
      ['Front', 'FL', 'FR'],
      ['Rear', 'RL', 'RR'],
    ] as const
  ).flatMap(([axle, l, r]) => [
    ...(['Lock-up', 'Wheelspin', 'Slide'] as const).map((k) =>
      def(`Tyre Wear ${k} ${axle}`, `('Tyre Wear ${k} ${l}' + 'Tyre Wear ${k} ${r}') / 2`, '', `${k === 'Slide' ? 'Cornering-slide' : k} part of the wear rate, ${axle.toLowerCase()} axle (${l} and ${r} averaged), 0–100.`, 0),
    ),
    def(
      `Tyre Wear Left-Right ${axle}`,
      `'Tyre Wear Rate ${l}' - 'Tyre Wear Rate ${r}'`,
      '',
      `${axle} axle wear-rate balance: ${l} minus ${r}. Above 0 = the left tyre is wearing faster there, below 0 = the right.`,
      0,
    ),
  ]),
  // Balance between the axles and the sides. Rates (along the lap): front minus rear and left minus right,
  // each the average of its two tyres. Per lap: the front's and the left's share of the lap's wear, in % (50 = even).
  def(
    'Tyre Wear Front-Rear',
    "('Tyre Wear Rate FL' + 'Tyre Wear Rate FR') / 2 - ('Tyre Wear Rate RL' + 'Tyre Wear Rate RR') / 2",
    '',
    'Front minus rear wear rate (each axle averaged). Above 0 = the fronts are wearing faster there, below 0 = the rears.',
    0,
  ),
  def(
    'Tyre Wear Left-Right',
    "('Tyre Wear Rate FL' + 'Tyre Wear Rate RL') / 2 - ('Tyre Wear Rate FR' + 'Tyre Wear Rate RR') / 2",
    '',
    'Left minus right wear rate (each side averaged). Above 0 = the left tyres are wearing faster there (right-hand corners load the left), below 0 = the right.',
    0,
  ),
  def(
    'Tyre Wear Front Share',
    "100 * ('Tyre Wear Lap FL' + 'Tyre Wear Lap FR') / max('Tyre Wear Lap FL' + 'Tyre Wear Lap FR' + 'Tyre Wear Lap RL' + 'Tyre Wear Lap RR', 1)",
    '%',
    "The fronts' share of the wear so far in the lap (50 = even). Its end-of-lap value in a Lap Trend is the front / rear balance per lap.",
    1,
  ),
  def(
    'Tyre Wear Left Share',
    "100 * ('Tyre Wear Lap FL' + 'Tyre Wear Lap RL') / max('Tyre Wear Lap FL' + 'Tyre Wear Lap FR' + 'Tyre Wear Lap RL' + 'Tyre Wear Lap RR', 1)",
    '%',
    "The left tyres' share of the wear so far in the lap (50 = even). Its end-of-lap value in a Lap Trend is the left / right balance per lap.",
    1,
  ),
  def(
    'Tyre Wear Rate Avg',
    "('Tyre Wear Rate FL' + 'Tyre Wear Rate FR' + 'Tyre Wear Rate RL' + 'Tyre Wear Rate RR') / 4",
    '',
    'Wear rate averaged over the four tyres, 0–100. Colour a track map by its difference to the reference to see where a lap uses more rubber.',
    0,
  ),
  def(
    'Tyre Wear Lap Avg',
    "('Tyre Wear Lap FL' + 'Tyre Wear Lap FR' + 'Tyre Wear Lap RL' + 'Tyre Wear Lap RR') / 4",
    'm',
    "Wear accumulated in the lap, averaged over the four tyres. Its end-of-lap value in a Lap Trend is the stint's tyre-wear figure per lap.",
    0,
  ),
  def('Rake', "'Ride Height Rear' - 'Ride Height Front'", 'mm', 'Rear minus front ride height.', 1),
  def('Total Downforce', "'Aero Downforce F' + 'Aero Downforce R'", 'N', 'Front + rear downforce.', 0),
  def(
    'Aero Balance',
    "choose('Aero Downforce F' + 'Aero Downforce R' > 500, 100 * 'Aero Downforce F' / ('Aero Downforce F' + 'Aero Downforce R'), invalid())",
    '%',
    'Front share of total downforce (invalid at low speed).',
    1,
  ),
  def(
    'Aero Efficiency',
    "choose('Aero Drag' > 100, ('Aero Downforce F' + 'Aero Downforce R') / 'Aero Drag', invalid())",
    '',
    'Downforce / drag (L/D).',
    2,
  ),
  def(
    'Front Load Share',
    "100 * ('Tire Load FL' + 'Tire Load FR') / max('Tire Load FL' + 'Tire Load FR' + 'Tire Load RL' + 'Tire Load RR', 1)",
    '%',
    'Share of vertical load on the front axle.',
    1,
  ),
  def(
    'Lateral Load Transfer',
    "100 * (('Tire Load FR' + 'Tire Load RR') - ('Tire Load FL' + 'Tire Load RL')) / max('Tire Load FL' + 'Tire Load FR' + 'Tire Load RL' + 'Tire Load RR', 1)",
    '%',
    'Right-minus-left load as a share of total (positive = loaded on the right).',
    1,
  ),
  def('Rear Wheelspin', "max('Tire Slip Ratio RL', 'Tire Slip Ratio RR')", '%', 'Largest rear slip ratio — traction loss on exits.', 1),
  def('Front Lockup', "min('Tire Slip Ratio FL', 'Tire Slip Ratio FR')", '%', 'Most negative front slip ratio — lock-ups under braking.', 1),
  def('Brake Temp Front Avg', "('Brake Temp FL' + 'Brake Temp FR') / 2", 'C', 'Mean front disc temperature.', 0),
  def('Brake Temp Rear Avg', "('Brake Temp RL' + 'Brake Temp RR') / 2", 'C', 'Mean rear disc temperature.', 0),
  def('Lap Fuel Used', "stat_max('Fuel Level') - 'Fuel Level'", 'l', 'Fuel burned since the start of the lap.', 2),
  def('Speed Smoothed', "smooth('Ground Speed', 0.3)", 'kph', 'Ground speed with a 0.3 s moving average.', 1),
];
