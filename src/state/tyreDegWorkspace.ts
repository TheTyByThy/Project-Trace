// The Tyre Deg workspace: five worksheets, one question each, read in order —
//   1 · Lap            how much did this lap wear the tyres, where, and front/rear · left/right?
//   2 · Lap corners    which corners cost rubber on this lap, and why?
//   3 · Stint          how did the wear build over the stint, and how do the stints compare?
//   4 · Stint corners  the average corner over each stint (107% filter), so lap-to-lap variance drops out
//   5 · Corner traces  why does this corner wear more? (scrub the traces for the clicked corner)
// No more than four components a sheet (sheet 5 has three); tyre comparisons use bars (straight lengths) rather than rings.

import { buildBlankWorkspace } from './defaultWorkspace';
import { createComponent, pane } from './components';
import { leaf, split } from './layout';
import { WEAR_CHANNEL_PROPS } from './tyreWearSheets';
import { uid, type ComponentConfig, type ComponentType, type LayoutNode, type Workspace, type Worksheet } from './workspace';

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
const causes = (t: string) => [`Tyre Wear Lock-up ${t}`, `Tyre Wear Wheelspin ${t}`, `Tyre Wear Slide ${t}`];

/** The lap-time chart that sets a sheet's 107% filter (stint sheets). */
const lapTimes = (title = 'Lap times — tick ≤ 107% to leave slow laps out of this sheet') =>
  P({ title, channel: '', cutoffOn: true, cutoff: 107, showFit: true, fit: 'linear' });

export function tyreDegSheets(): Worksheet[] {
  return [
    sheet('1 · Lap', (add) =>
      split(
        'row',
        [
          split(
            'col',
            [
              add('wearsummary', P({ title: 'Whole car — this lap (cmp as difference)' })),
              add('wearwheels', P({ title: 'Each tyre — this lap', shape: 'bars', mode: 'amount', followFocus: false, maxCompare: 1 })),
            ],
            [0.2, 0.8],
          ),
          split(
            'col',
            [
              add('wearbalance', P({ title: 'Front vs rear · left vs right', showLaps: false, followFocus: false, maxCompare: 1 })),
              add('trackmap', P({ title: 'Where the comparison lap wears more (red) or less (green)', colorBy: 'Tyre Wear Rate Avg', channelDelta: true, ramp: 'gainloss', deltaSmoothing: 48 })),
            ],
            [0.62, 0.38],
          ),
        ],
        [0.48, 0.52],
      ),
    ),
    sheet('2 · Lap corners', (add) =>
      split(
        'row',
        [
          add('tyrewear', P({ title: 'Corner by corner — click one', source: 'laps', cards: 'tyres', tyre: 'all', sort: 'track', popout: false })),
          add('wearwheels', P({ title: 'The clicked corner, each tyre', shape: 'bars', mode: 'amount', maxCompare: 1 })),
        ],
        [0.6, 0.4],
      ),
    ),
    sheet('3 · Stint', (add) =>
      split(
        'row',
        [
          split('col', [add('wearsummary', P({ title: 'Average lap per stint — whole car', source: 'stints' })), add('trend', lapTimes())], [0.24, 0.76]),
          split(
            'col',
            [
              add(
                'trend',
                P({ title: 'Wear through the stint (average of 4) — per lap or cumulative', channel: 'Tyre Wear Lap Avg', stat: 'last', completeOnly: true, cumulative: true, showFit: true, fit: 'linear' }),
              ),
              add('wearsummary', P({ title: 'Average lap per stint — each tyre', source: 'stints', perTyre: true })),
            ],
            [0.56, 0.44],
          ),
        ],
        [0.5, 0.5],
      ),
    ),
    sheet('4 · Stint corners', (add) =>
      split(
        'row',
        [
          split(
            'col',
            [
              add('tyrewear', P({ title: 'Average corner per stint — click one', source: 'stints', cards: 'tyres', tyre: 'all', sort: 'track', popout: false })),
              add('trend', lapTimes('Lap times — the ≤ 107% filter decides which laps are averaged')),
            ],
            [0.76, 0.24],
          ),
          add('wearwheels', P({ title: 'The clicked corner, each tyre — stint average', source: 'stints', shape: 'bars', mode: 'amount', maxCompare: 1 })),
        ],
        [0.6, 0.4],
      ),
    ),
    sheet('5 · Corner traces', (add) =>
      split(
        'row',
        [
          add(
            'graph',
            P({
              title: 'Why — speed, steering, pedals, then front and rear wear by cause (click a corner on the right to zoom)',
              panes: [
                pane(['Ground Speed'], 0.8),
                pane(['Steering Angle'], 0.8),
                pane(['Throttle Pos', 'Brake Pos'], 0.8),
                pane(['Brake Steer Combination'], 0.6),
                pane(causes('Front')),
                pane(causes('Rear')),
              ],
            }),
          ),
          split(
            'col',
            [
              add('tyrewear', P({ title: 'Pick a corner (the traces zoom to it)', source: 'laps', cards: 'average', tyre: 'all', sort: 'track', popout: false })),
              add('gpstrack', P({ title: 'Racing lines through it' })),
            ],
            [0.62, 0.38],
          ),
        ],
        [0.62, 0.38],
      ),
    ),
  ];
}

/** A fresh Tyre Deg workspace: the five sheets, the default math channels and the wear colours. */
export function buildTyreDegWorkspace(name = 'Tyre Deg'): Workspace {
  return { ...buildBlankWorkspace(name), worksheets: tyreDegSheets(), channelProps: structuredClone(WEAR_CHANNEL_PROPS) };
}
