// Default configuration for every component type, plus the catalogue shown in "Add component".

import { uid, type ComponentConfig, type ComponentType, type GraphPane } from './workspace';

export const COMPONENT_CATALOG: { type: ComponentType; label: string; icon: string; description: string }[] = [
  { type: 'graph', label: 'Time / Distance Graph', icon: '〰', description: 'Multi-channel traces against time or distance with lap overlays, variance and cursor.' },
  { type: 'trackmap', label: 'Track Map', icon: '◎', description: 'Track outline from car coordinates or GPS, coloured by any channel or time gain/loss.' },
  { type: 'scatter', label: 'Scatter / XY Plot', icon: '⁘', description: 'Any channel against any other, coloured by lap or a third channel, with curve fits.' },
  { type: 'histogram', label: 'Histogram', icon: '▥', description: 'Distribution of a channel (% of time) with zone breakdowns — ideal for damper speeds.' },
  { type: 'mixture', label: 'Mixture Map', icon: '▦', description: '2-D histogram: % time or mean of a third channel in each X/Y cell.' },
  { type: 'laps', label: 'Lap Report', icon: '⏱', description: 'Lap and sector times with best sectors, ideal lap and validity.' },
  { type: 'channels', label: 'Channel Report', icon: '☰', description: 'Min / max / mean / std of chosen channels for every selected lap.' },
  { type: 'corners', label: 'Corner Report', icon: '↺', description: 'Auto-detected corners with min/entry/exit speed and time per lap.' },
  { type: 'trend', label: 'Lap Trend', icon: '📈', description: 'A per-lap statistic across the session (lap time, max temp, fuel…).' },
  { type: 'gauges', label: 'Gauges', icon: '◔', description: 'Dial, bar and digital gauges showing values at the cursor.' },
  { type: 'inputs', label: 'Driver Inputs', icon: '🎮', description: 'Pedals, steering wheel, gear and speed at the cursor.' },
  { type: 'tyres', label: 'Tyres & Brakes', icon: '◫', description: 'Four-corner tyre temperatures, pressures, loads and brake temps.' },
  { type: 'fft', label: 'Frequency (FFT)', icon: '∿', description: 'Frequency spectrum of a channel — ride and damper analysis.' },
  { type: 'details', label: 'Session & Setup', icon: 'ℹ', description: 'Session details, full car setup (with comparison) and notes.' },
];

export const pane = (channels: string[], weight = 1): GraphPane => ({ id: uid('p'), channels, weight, scale: 'auto' });

export function createComponent(type: ComponentType, patch: Partial<ComponentConfig> = {}): ComponentConfig {
  const id = uid('c');
  let c: ComponentConfig;
  switch (type) {
    case 'graph':
      c = {
        id,
        type,
        panes: [pane(['Ground Speed'], 1.4), pane(['Throttle Pos', 'Brake Pos'])],
        showVariance: false,
        showSectors: true,
        showCorners: false,
        yRange: 'full',
      };
      break;
    case 'scatter':
      c = {
        id,
        type,
        x: 'CG Accel Lateral',
        y: 'CG Accel Longitudinal',
        color: 'lap',
        pointSize: 2,
        fit: 'none',
        equalAspect: true,
        useZoom: true,
        intervalAvg: false,
        intervalCount: 20,
        ramp: 'blue',
      };
      break;
    case 'histogram':
      c = { id, type, channel: 'Ground Speed', bins: 30, useZoom: true, zones: [], cumulative: false };
      break;
    case 'mixture':
      c = { id, type, x: 'Engine RPM', y: 'Throttle Pos', z: '', xBins: 12, yBins: 10, mode: 'time', useZoom: true, showValues: true, ramp: 'blue' };
      break;
    case 'trackmap':
      c = { id, type, colorBy: 'Ground Speed', ramp: 'blue', showSectors: true, showCorners: true, showZoom: true, lineWidth: 4, rotation: 0 };
      break;
    case 'laps':
      c = { id, type, split: 'sectors', showStats: true };
      break;
    case 'channels':
      c = {
        id,
        type,
        channels: ['Ground Speed', 'Throttle Pos', 'Brake Pos', 'Engine RPM', 'Combined G'],
        stats: ['min', 'max', 'mean'],
        useZoom: false,
      };
      break;
    case 'gauges':
      c = {
        id,
        type,
        columns: 3,
        gauges: [
          { channel: 'Ground Speed', style: 'dial', min: 0, max: 340 },
          { channel: 'Engine RPM', style: 'dial', min: 0, max: 13000 },
          { channel: 'Gear', style: 'digital' },
        ],
      };
      break;
    case 'inputs':
      c = { id, type, showCompare: true };
      break;
    case 'tyres':
      c = { id, type, mode: 'cursor' };
      break;
    case 'details':
      c = { id, type, tab: 'setup', diffOnly: false };
      break;
    case 'trend':
      c = { id, type, channel: '', stat: 'mean', validOnly: false };
      break;
    case 'corners':
      c = { id, type, metric: 'minSpeed' };
      break;
    case 'fft':
      c = { id, type, channel: 'Damper Travel FL', maxHz: 25, useZoom: true, logScale: false };
      break;
  }
  return { ...c, ...patch, id, type } as ComponentConfig;
}
