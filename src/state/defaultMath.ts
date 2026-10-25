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
