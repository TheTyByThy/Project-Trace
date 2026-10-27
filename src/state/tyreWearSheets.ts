// Tyre wear worksheets, from the quick look down to scrubbing through one corner (docs/14-tyre-wear.md):
//   Tyre Wear          — overview, everything averaged over the four tyres: wheels, Δ map, per-lap trend
//   Tyre Wear Detail   — the same per tyre (FL / FR / RL / RR)
//   Wear Balance       — front vs rear and left vs right: shares, metres, what makes up each gap, one-off laps
//   Wear by Corner     — which corners cost rubber and why: ranked table, wheels, line and inputs
//   Wear Deep Dive – Fronts / Rears — every channel that builds the wear, to scrub through a corner
//   Wear Stint         — per-lap trends across the stint, with the game's grip and blistering to check against
// The Starter has the first two; the full set is for a dedicated tyre-wear workspace.

import { createComponent, pane } from './components';
import { leaf, split } from './layout';
import { uid, type ComponentConfig, type ComponentType, type GraphPane, type LayoutNode, type Worksheet } from './workspace';

type Add = (type: ComponentType, patch?: Partial<ComponentConfig>) => LayoutNode;

function sheet(name: string, build: (add: Add) => LayoutNode): Worksheet {
  const components: Record<string, ComponentConfig> = {};
  const add: Add = (type, patch = {}) => {
    const c = createComponent(type, patch);
    components[c.id] = c;
    return leaf(c.id);
  };
  return { id: uid('w'), name, layout: build(add), components };
}

const P = (patch: object) => patch as Partial<ComponentConfig>;
const indep = (channels: string[], weight = 1): GraphPane => ({ ...pane(channels, weight), scale: 'independent' });
const causes = (t: string) => [`Tyre Wear Lock-up ${t}`, `Tyre Wear Wheelspin ${t}`, `Tyre Wear Slide ${t}`];

/** Cause channels drawn in the cause colours (lock-up red, wheelspin amber, slide blue), as in the wheels. */
export const WEAR_CHANNEL_PROPS: Record<string, { color: string; min?: number; max?: number }> = {
  ...Object.fromEntries(
    ['FL', 'FR', 'RL', 'RR', 'Avg', 'Front', 'Rear'].flatMap((t) => [
      [`Tyre Wear Lock-up ${t}`, { color: '#e66767' }],
      [`Tyre Wear Wheelspin ${t}`, { color: '#c98500' }],
      [`Tyre Wear Slide ${t}`, { color: '#3987e5' }],
      [`Tyre Wear Left-Right ${t}`, { color: '#9085e9' }],
    ]),
  ),
  // Balance channels: a symmetric range, so a track map coloured by them is neutral where the two sides match.
  'Tyre Wear Front-Rear': { color: '#9085e9', min: -30, max: 30 },
  'Tyre Wear Left-Right': { color: '#199e70', min: -30, max: 30 },
  'Tyre Wear Front Share': { color: '#9085e9' },
  'Tyre Wear Left Share': { color: '#199e70' },
};

/** Δ wear-rate track map: red where the comparison lap wears the tyres more than the reference, green where less. */
const deltaMap = (channel: string, title: string, extra: object = {}) =>
  P({ title, colorBy: channel, channelDelta: true, ramp: 'gainloss', deltaSmoothing: 48, ...extra });

export function tyreWearOverviewSheet(): Worksheet {
  return sheet('Tyre Wear', (add) =>
    split(
      'row',
      [
        split(
          'col',
          [add('wearwheels', P({ title: 'What is wearing each tyre', mode: 'share' })), add('tyrewear', P({ cards: 'average', tyre: 'all' }))],
          [0.52, 0.48],
        ),
        split(
          'col',
          [
            add('trackmap', deltaMap('Tyre Wear Rate Avg', 'Where the comparison lap wears the tyres more (red) or less (green)')),
            add('graph', P({ title: 'Wear rate by cause (average of 4)', panes: [pane(['Ground Speed'], 0.7), pane(causes('Avg'))] })),
            add('trend', P({ title: 'Tyre wear per lap (average of 4)', channel: 'Tyre Wear Lap Avg', stat: 'last', completeOnly: true, showFit: true, fit: 'linear', showEquation: false })),
          ],
          [0.42, 0.33, 0.25],
        ),
      ],
      [0.46, 0.54],
    ),
  );
}

export function tyreWearDetailSheet(): Worksheet {
  return sheet('Tyre Wear Detail', (add) => {
    const trend = (t: string) => add('trend', P({ title: `${t} wear per lap`, channel: `Tyre Wear Lap ${t}`, stat: 'last', completeOnly: true }));
    const map = (t: string) => add('trackmap', deltaMap(`Tyre Wear Rate ${t}`, `${t} — Δ wear rate`, { showCorners: false, showLegend: false }));
    return split(
      'row',
      [
        split(
          'col',
          [
            add('graph', P({ title: 'Tyre wear rate per tyre', panes: ['FL', 'FR', 'RL', 'RR'].map((t) => pane([`Tyre Wear Rate ${t}`])) })),
            split('row', [split('col', [map('FL'), map('RL')], [0.5, 0.5]), split('col', [map('FR'), map('RR')], [0.5, 0.5])], [0.5, 0.5]),
          ],
          [0.5, 0.5],
        ),
        split(
          'col',
          [
            add('tyrewear', P({ cards: 'tyres', tyre: 'all' })),
            split('row', [split('col', [trend('FL'), trend('RL')], [0.5, 0.5]), split('col', [trend('FR'), trend('RR')], [0.5, 0.5])], [0.5, 0.5]),
          ],
          [0.55, 0.45],
        ),
      ],
      [0.5, 0.5],
    );
  });
}

export function wearByCornerSheet(): Worksheet {
  return sheet('Wear by Corner', (add) =>
    split(
      'row',
      [
        split(
          'col',
          [
            add('tyrewear', P({ title: 'Corners ranked by extra wear — click one', cards: 'tyres', tyre: 'all', sort: 'track', popout: false })),
            add('corners', P({ metric: 'time', showStraights: false, showTotals: false })),
          ],
          [0.64, 0.36],
        ),
        split(
          'col',
          [
            add('wearwheels', P({ title: 'The clicked corner, tyre by tyre', mode: 'amount', maxCompare: 2 })),
            split(
              'row',
              [add('trackmap', deltaMap('Tyre Wear Rate Avg', 'Δ wear rate')), add('gpstrack', P({ title: 'Racing lines' }))],
              [0.5, 0.5],
            ),
            add('inputs', P({ title: 'Driver inputs at the cursor' })),
          ],
          [0.46, 0.34, 0.2],
        ),
      ],
      [0.52, 0.48],
    ),
  );
}

export function wearBalanceSheet(): Worksheet {
  return sheet('Wear Balance', (add) =>
    split(
      'row',
      [
        // Just the reference and comparison laps (no stint table or per-lap trends).
        split(
          'col',
          [
            add('wearbalance', P({ title: 'Front vs rear · left vs right — how much, and what makes up the gap', showLaps: false })),
            add('graph', P({ title: 'Balance along the lap (above 0 = front / left wearing faster)', panes: [pane(['Ground Speed'], 0.7), pane(['Tyre Wear Front-Rear']), pane(['Tyre Wear Left-Right'])] })),
          ],
          [0.5, 0.5],
        ),
        split(
          'col',
          [
            add('wearwheels', P({ title: 'All four tyres — clicked corner or whole lap', mode: 'share' })),
            split(
              'row',
              [
                add('trackmap', P({ title: 'Front (red) vs rear (blue) wearing more', colorBy: 'Tyre Wear Front-Rear', ramp: 'diverging' })),
                add('trackmap', P({ title: 'Left (red) vs right (blue) wearing more', colorBy: 'Tyre Wear Left-Right', ramp: 'diverging' })),
              ],
              [0.5, 0.5],
            ),
          ],
          [0.6, 0.4],
        ),
      ],
      [0.56, 0.44],
    ),
  );
}

function deepDiveSheet(axle: 'Fronts' | 'Rears'): Worksheet {
  // One trace per lap in every wear pane (left and right averaged per cause), so a comparison lap in a single
  // lap colour still reads clearly; the last pane says which side of the axle is wearing faster.
  const ax = axle === 'Fronts' ? 'Front' : 'Rear';
  const wearPanes = [
    pane([`Tyre Wear Lock-up ${ax}`], axle === 'Fronts' ? 1 : 0.8),
    pane([`Tyre Wear Wheelspin ${ax}`], axle === 'Fronts' ? 0.7 : 1),
    pane([`Tyre Wear Slide ${ax}`]),
    pane([`Tyre Wear Left-Right ${ax}`], 0.9),
  ];
  const panes: GraphPane[] =
    axle === 'Fronts'
      ? [pane(['Ground Speed'], 0.8), pane(['Steering Angle'], 0.8), pane(['Brake Pos', 'Throttle Pos'], 0.8), pane(['Brake Steer Combination'], 0.7), ...wearPanes]
      : [indep(['Ground Speed', 'Gear'], 0.8), pane(['Throttle Pos', 'Brake Pos'], 0.8), pane(['Steering Angle'], 0.8), ...wearPanes];
  return sheet(`Wear Deep Dive – ${axle}`, (add) =>
    split(
      'row',
      [
        add('graph', P({ title: `${ax} tyre wear — what builds it (${ax.toLowerCase()} axle; last pane: left − right)`, panes })),
        split(
          'col',
          [
            add('wearwheels', P({ title: `${ax} tyres — clicked corner or whole lap`, mode: 'share', tyre: axle === 'Fronts' ? 'front' : 'rear' })),
            add('tyres', P({ title: 'Tyres at the cursor', mode: 'cursor', fields: ['wearRate', 'ndSlip', 'load', 'slipAngle', 'slipRatio', 'surface', 'surfaceValues'] })),
            add('gpstrack', P({ title: 'Racing lines' })),
          ],
          [0.34, 0.33, 0.33],
        ),
      ],
      [0.66, 0.34],
    ),
  );
}

export const wearDeepDiveFrontsSheet = () => deepDiveSheet('Fronts');
export const wearDeepDiveRearsSheet = () => deepDiveSheet('Rears');

// Blistering vs graining (CSP's extended tyre model logs both): grip lost on top of the rubber wear.
const BLISTER_NOTE = 'Blistering = too HOT: the tread overheats and bubbles of rubber tear out. Permanent grip loss.';
const BLISTER_DETAIL =
  'Blistering: the rubber gets too hot inside (core / surface well above its window) for too long — lots of sliding, pushing on a hot or worn tyre, low pressure, a hot track. Gas bubbles form under the surface and chunks of tread tear out. The grip it costs does not come back; it keeps growing while the tyre stays hot. Cure: less sliding (smoother inputs), cooler tyres (pressure / camber), backing off for a lap.';
const GRAIN_NOTE = 'Graining = too COLD for the sliding: the surface tears into little rolls of rubber. Can clean up.';
const GRAIN_DETAIL =
  "Graining: the tread slides while it is still below its working temperature (cold track, early laps, a cold compound, too much lateral slide). The surface tears into small rolls / balls of rubber that sit on the tread like ball bearings and cut grip. Unlike blistering it can clear up: once the tyre is up to temperature and the loose rubber wears off, the grip comes back. In your data it only appears on the cooler days (road 22–24 °C).";

export function wearStintSheet(): Worksheet {
  return sheet('Wear Stint', (add) =>
    split(
      'row',
      [
        split(
          'col',
          [add('laps', P({ split: 'sectors', showStats: true })), add('trend', P({ title: 'Lap times', channel: '', cutoffOn: true, cutoff: 107, showFit: true, fit: 'linear' }))],
          [0.5, 0.5],
        ),
        split(
          'col',
          [
            add('trend', P({ title: 'Tyre wear per lap (average of 4) — the deg measure', channel: 'Tyre Wear Lap Avg', stat: 'last', completeOnly: true, showFit: true, fit: 'linear' })),
            add('trend', P({ title: "Game's rubber grip, rear left (end of lap)", channel: 'Tire Rubber Grip RL', stat: 'last', completeOnly: true, showFit: true, fit: 'linear' })),
            split(
              'row',
              [
                add('trend', P({ title: 'Blistering, rear left (max per lap)', channel: 'Tire Blister RL', stat: 'max', completeOnly: true, note: BLISTER_NOTE, noteDetail: BLISTER_DETAIL })),
                add('trend', P({ title: 'Graining, rear left (max per lap)', channel: 'Tire Grain RL', stat: 'max', completeOnly: true, note: GRAIN_NOTE, noteDetail: GRAIN_DETAIL })),
              ],
              [0.5, 0.5],
            ),
          ],
          [0.36, 0.32, 0.32],
        ),
      ],
      [0.5, 0.5],
    ),
  );
}

/** Every tyre-wear worksheet, in order. */
export const allTyreWearSheets = (): Worksheet[] => [
  tyreWearOverviewSheet(),
  tyreWearDetailSheet(),
  wearBalanceSheet(),
  wearByCornerSheet(),
  wearDeepDiveFrontsSheet(),
  wearDeepDiveRearsSheet(),
  wearStintSheet(),
];
