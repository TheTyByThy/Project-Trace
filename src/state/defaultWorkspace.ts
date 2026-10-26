// The Starter workspace (also the template for new workspaces): twelve worksheets covering every
// component type. Corners are user-defined per track, so corner markers stay empty until you add some.

import { DEFAULT_MATH_CHANNELS } from './defaultMath';
import { createComponent, pane } from './components';
import { leaf, split } from './layout';
import { uid, type ComponentConfig, type ComponentType, type LayoutNode, type Workspace, type Worksheet } from './workspace';

class SheetBuilder {
  components: Record<string, ComponentConfig> = {};
  add(type: ComponentType, patch: Partial<ComponentConfig> = {}): LayoutNode {
    const c = createComponent(type, patch);
    this.components[c.id] = c;
    return leaf(c.id);
  }
  sheet(name: string, layout: LayoutNode): Worksheet {
    return { id: uid('w'), name, layout, components: this.components };
  }
}

const quad = ['FL', 'FR', 'RL', 'RR'];
const q = (base: string) => quad.map((c) => `${base} ${c}`);

export function buildDefaultWorkspace(name = 'Starter'): Workspace {
  const sheets: Worksheet[] = [];

  {
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Overview',
        split(
          'row',
          [
            b.add('graph', {
              title: 'Driver channels',
              panes: [pane(['Ground Speed'], 1.6), pane(['Throttle Pos', 'Brake Pos'], 1.1), pane(['Gear'], 0.7), pane(['Steering Angle']), pane(['Engine RPM'])],
              showVariance: true,
            } as Partial<ComponentConfig>),
            split('col', [b.add('trackmap', { title: 'Track map — speed' } as Partial<ComponentConfig>), b.add('lapreport'), b.add('breakdown')], [0.46, 0.2, 0.34]),
          ],
          [0.64, 0.36],
        ),
      ),
    );
  }
  {
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Driver',
        split(
          'row',
          [
            b.add('graph', {
              title: 'Inputs',
              panes: [pane(['Ground Speed'], 1.4), pane(['Throttle Pos', 'Brake Pos']), pane(['Steering Angle']), pane(['Steering Rate'], 0.8), pane(['Coasting', 'Throttle Brake Overlap'], 0.6)],
              showVariance: true,
              showCorners: true,
            } as Partial<ComponentConfig>),
            split(
              'col',
              [
                b.add('trackmap', { title: 'Time gained / lost', colorBy: 'delta', ramp: 'gainloss' } as Partial<ComponentConfig>),
                split('row', [b.add('inputs'), b.add('scatter', { title: 'G-G diagram', envelope: true } as Partial<ComponentConfig>)], [0.45, 0.55]),
                b.add('corners'),
              ],
              [0.38, 0.32, 0.3],
            ),
          ],
          [0.58, 0.42],
        ),
      ),
    );
  }
  {
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Racing Lines',
        split(
          'row',
          [
            b.add('gpstrack', { title: 'Racing lines' } as Partial<ComponentConfig>),
            split(
              'col',
              [
                b.add('graph', {
                  title: 'Line inputs',
                  panes: [pane(['Ground Speed'], 1.3), pane(['Steering Angle']), pane(['Throttle Pos', 'Brake Pos']), pane(['CG Accel Lateral'], 0.8)],
                  showVariance: true,
                  showCorners: true,
                } as Partial<ComponentConfig>),
                b.add('corners'),
              ],
              [0.66, 0.34],
            ),
          ],
          [0.5, 0.5],
        ),
      ),
    );
  }
  {
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Tyres',
        split(
          'row',
          [
            b.add('graph', {
              title: 'Tyres',
              panes: [pane(q('Tyre Temp Avg')), pane(q('Tire Pressure')), pane(q('Tire Slip Angle')), pane(q('Tire Slip Ratio')), pane(q('Tire Load'))],
            } as Partial<ComponentConfig>),
            split(
              'col',
              [
                b.add('tyres'),
                b.add('trend', { title: 'Tyre temperature by lap', channel: 'Tyre Temp Avg RR', stat: 'mean' } as Partial<ComponentConfig>),
                b.add('channels', {
                  title: 'Tyre summary',
                  channels: [...q('Tyre Temp Avg'), ...q('Tire Pressure')],
                  stats: ['mean', 'max'],
                } as Partial<ComponentConfig>),
              ],
              [0.42, 0.26, 0.32],
            ),
          ],
          [0.6, 0.4],
        ),
      ),
    );
  }
  {
    // Tyre wear overview: everything averaged over the four tyres, and the track map coloured by how much
    // more (red) or less (green) rubber the comparison lap uses than the reference.
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Tyre Wear',
        split(
          'row',
          [
            split(
              'col',
              [
                b.add('graph', { title: 'Tyre wear rate (average of 4)', panes: [pane(['Ground Speed'], 0.8), pane(['Tyre Wear Rate Avg'])] } as Partial<ComponentConfig>),
                b.add('trend', { title: 'Tyre wear per lap (average of 4)', channel: 'Tyre Wear Lap Avg', stat: 'last' } as Partial<ComponentConfig>),
              ],
              [0.55, 0.45],
            ),
            split(
              'col',
              [
                b.add('tyrewear', { cards: 'average', tyre: 'all' } as Partial<ComponentConfig>),
                b.add('trackmap', { title: 'Track map — Δ wear rate vs reference', colorBy: 'Tyre Wear Rate Avg', channelDelta: true, ramp: 'gainloss', deltaSmoothing: 48 } as Partial<ComponentConfig>),
              ],
              [0.58, 0.42],
            ),
          ],
          [0.5, 0.5],
        ),
      ),
    );
  }
  {
    // Tyre wear detail: the same, split per tyre (FL / FR / RL / RR).
    const b = new SheetBuilder();
    const trend = (t: string) => b.add('trend', { title: `${t} wear per lap`, channel: `Tyre Wear Lap ${t}`, stat: 'last' } as Partial<ComponentConfig>);
    const map = (t: string) =>
      b.add('trackmap', { title: `${t} — Δ wear rate`, colorBy: `Tyre Wear Rate ${t}`, channelDelta: true, ramp: 'gainloss', deltaSmoothing: 48, showCorners: false, showLegend: false } as Partial<ComponentConfig>);
    sheets.push(
      b.sheet(
        'Tyre Wear Detail',
        split(
          'row',
          [
            split(
              'col',
              [
                b.add('graph', {
                  title: 'Tyre wear rate per tyre',
                  panes: [pane(['Tyre Wear Rate FL']), pane(['Tyre Wear Rate FR']), pane(['Tyre Wear Rate RL']), pane(['Tyre Wear Rate RR'])],
                } as Partial<ComponentConfig>),
                split('row', [split('col', [map('FL'), map('RL')], [0.5, 0.5]), split('col', [map('FR'), map('RR')], [0.5, 0.5])], [0.5, 0.5]),
              ],
              [0.5, 0.5],
            ),
            split(
              'col',
              [
                b.add('tyrewear', { cards: 'tyres', tyre: 'FL' } as Partial<ComponentConfig>),
                split('row', [split('col', [trend('FL'), trend('RL')], [0.5, 0.5]), split('col', [trend('FR'), trend('RR')], [0.5, 0.5])], [0.5, 0.5]),
              ],
              [0.55, 0.45],
            ),
          ],
          [0.5, 0.5],
        ),
      ),
    );
  }
  {
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Brakes',
        split(
          'row',
          [
            b.add('graph', {
              title: 'Braking',
              panes: [pane(['Ground Speed'], 1.3), pane(['Brake Pos']), pane(q('Brake Temp')), pane(['Front Lockup', 'Rear Wheelspin']), pane(['CG Accel Longitudinal'])],
              showVariance: true,
            } as Partial<ComponentConfig>),
            split(
              'col',
              [
                b.add('trackmap', { title: 'Brake pressure', colorBy: 'Brake Pos', ramp: 'orange' } as Partial<ComponentConfig>),
                b.add('scatter', {
                  title: 'Brake vs deceleration',
                  x: 'Brake Pos',
                  y: 'CG Accel Longitudinal',
                  color: 'Ground Speed',
                  equalAspect: false,
                  fit: 'linear',
                } as Partial<ComponentConfig>),
                b.add('channels', { title: 'Brake temps', channels: q('Brake Temp'), stats: ['mean', 'max'] } as Partial<ComponentConfig>),
              ],
              [0.38, 0.37, 0.25],
            ),
          ],
          [0.6, 0.4],
        ),
      ),
    );
  }
  {
    const b = new SheetBuilder();
    const hist = (c: string) =>
      b.add('histogram', { title: `Damper velocity ${c}`, channel: `Damper Velocity ${c}`, bins: 40, min: -200, max: 200, zones: [-25, 0, 25] } as Partial<ComponentConfig>);
    sheets.push(
      b.sheet(
        'Suspension',
        split(
          'row',
          [
            b.add('graph', {
              title: 'Platform',
              panes: [pane(['Ride Height Front', 'Ride Height Rear']), pane(q('Damper Travel')), pane(['Chassis Roll Angle'], 0.8), pane(['Chassis Pitch Angle'], 0.8), pane(['Rake'], 0.8)],
            } as Partial<ComponentConfig>),
            split(
              'col',
              [
                split('row', [hist('FL'), hist('FR')]),
                split('row', [hist('RL'), hist('RR')]),
                b.add('fft', { title: 'Ride frequency', channel: 'Damper Travel HF' } as Partial<ComponentConfig>),
              ],
              [0.36, 0.36, 0.28],
            ),
          ],
          [0.55, 0.45],
        ),
      ),
    );
  }
  {
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Aero',
        split(
          'row',
          [
            b.add('graph', {
              title: 'Aero',
              panes: [pane(['Ground Speed'], 1.2), pane(['Aero Downforce F', 'Aero Downforce R']), pane(['Aero Drag']), pane(['Aero Balance']), pane(['Ride Height Front', 'Ride Height Rear'])],
            } as Partial<ComponentConfig>),
            split(
              'col',
              [
                b.add('scatter', {
                  title: 'Downforce vs speed',
                  x: 'Ground Speed',
                  y: 'Total Downforce',
                  color: 'lap',
                  equalAspect: false,
                  fit: 'poly2',
                } as Partial<ComponentConfig>),
                b.add('scatter', {
                  title: 'Aero balance vs front ride height',
                  x: 'Ride Height Front',
                  y: 'Aero Balance',
                  color: 'Ground Speed',
                  equalAspect: false,
                  intervalAvg: true,
                } as Partial<ComponentConfig>),
              ],
              [0.5, 0.5],
            ),
          ],
          [0.58, 0.42],
        ),
      ),
    );
  }
  {
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Engine & ERS',
        split(
          'row',
          [
            b.add('graph', {
              title: 'Powertrain',
              panes: [pane(['Engine RPM'], 1.2), pane(['Gear'], 0.7), pane(['KERS Charge']), pane(['KERS Deployed Energy']), pane(['Turbo Boost']), pane(['Drivetrain Power'])],
            } as Partial<ComponentConfig>),
            split(
              'col',
              [
                b.add('gauges', {
                  columns: 3,
                  gauges: [
                    { channel: 'Engine RPM', style: 'dial', min: 0, max: 13000 },
                    { channel: 'Ground Speed', style: 'dial', min: 0, max: 340 },
                    { channel: 'Gear', style: 'digital' },
                    { channel: 'KERS Charge', style: 'bar', min: 0, max: 100 },
                    { channel: 'Fuel Level', style: 'bar', min: 0, max: 132 },
                    { channel: 'Turbo Boost', style: 'bar', min: 0, max: 4 },
                  ],
                } as Partial<ComponentConfig>),
                b.add('mixture', { title: 'RPM × throttle (time %)' } as Partial<ComponentConfig>),
                b.add('histogram', { title: 'Gear usage', channel: 'Gear', bins: 9, min: -0.5, max: 8.5 } as Partial<ComponentConfig>),
              ],
              [0.34, 0.36, 0.3],
            ),
          ],
          [0.58, 0.42],
        ),
      ),
    );
  }
  {
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Lap Analysis',
        split(
          'row',
          [
            split('col', [b.add('laps'), b.add('trend', { title: 'Lap times' } as Partial<ComponentConfig>)], [0.55, 0.45]),
            split(
              'col',
              [
                b.add('channels', {
                  title: 'Lap statistics',
                  channels: ['Ground Speed', 'Throttle Pos', 'Full Throttle', 'Brake Pos', 'Coasting', 'Combined G', 'Lap Fuel Used'],
                  stats: ['min', 'max', 'mean'],
                } as Partial<ComponentConfig>),
                b.add('corners'),
              ],
              [0.45, 0.55],
            ),
          ],
          [0.5, 0.5],
        ),
      ),
    );
  }
  {
    const b = new SheetBuilder();
    sheets.push(
      b.sheet(
        'Session & Setup',
        split(
          'row',
          [
            b.add('details'),
            split(
              'col',
              [
                b.add('trackmap', { title: 'Elevation', colorBy: 'Car Coord Z', ramp: 'orange', showCorners: false } as Partial<ComponentConfig>),
                b.add('trend', { title: 'Fuel by lap', channel: 'Fuel Level', stat: 'last' } as Partial<ComponentConfig>),
              ],
              [0.55, 0.45],
            ),
          ],
          [0.55, 0.45],
        ),
      ),
    );
  }

  const now = Date.now();
  return {
    id: uid('ws'),
    name,
    version: 1,
    worksheets: sheets,
    activeSheet: 0,
    math: DEFAULT_MATH_CHANNELS.map((m) => ({ ...m })),
    constants: [],
    channelProps: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function buildBlankWorkspace(name = 'New workspace'): Workspace {
  const b = new SheetBuilder();
  const sheet = b.sheet('Sheet 1', split('row', [b.add('graph'), b.add('trackmap')], [0.65, 0.35]));
  const now = Date.now();
  return {
    id: uid('ws'),
    name,
    version: 1,
    worksheets: [sheet],
    activeSheet: 0,
    math: DEFAULT_MATH_CHANNELS.map((m) => ({ ...m })),
    constants: [],
    channelProps: {},
    createdAt: now,
    updatedAt: now,
  };
}
