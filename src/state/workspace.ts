// Workspace model (MoTeC terminology: a Workspace holds Worksheets; each worksheet is a layout
// of Components). Everything here is plain JSON so workspaces can be saved, shared and imported.

import type { MathChannelDef, MathConstant } from '../core/math/evaluate';
import type { RampName } from '../core/colors';

export type ComponentType =
  | 'graph'
  | 'scatter'
  | 'histogram'
  | 'mixture'
  | 'trackmap'
  | 'laps'
  | 'channels'
  | 'gauges'
  | 'inputs'
  | 'tyres'
  | 'details'
  | 'trend'
  | 'corners'
  | 'fft';

export interface GraphPane {
  id: string;
  channels: string[];
  weight: number;
  /** 'shared' = one y-scale (best for same units); 'independent' = each channel scaled to the pane. */
  scale: 'auto' | 'shared' | 'independent';
  /** Optional fixed range for shared scale. */
  min?: number;
  max?: number;
}

interface Base {
  id: string;
  title?: string;
}

export interface GraphConfig extends Base {
  type: 'graph';
  panes: GraphPane[];
  showVariance: boolean;
  showSectors: boolean;
  showCorners: boolean;
  yRange: 'full' | 'visible';
}

export interface ScatterConfig extends Base {
  type: 'scatter';
  x: string;
  y: string;
  color: string; // 'lap' or channel name
  pointSize: number;
  fit: 'none' | 'linear' | 'poly2' | 'poly3';
  equalAspect: boolean;
  useZoom: boolean;
  intervalAvg: boolean;
  intervalCount: number;
  ramp: RampName;
  gate?: string; // optional channel: only plot samples where gate channel is non-zero
}

export interface HistogramConfig extends Base {
  type: 'histogram';
  channel: string;
  bins: number;
  min?: number;
  max?: number;
  useZoom: boolean;
  /** Zone boundaries for % breakdown (e.g. damper speeds −50, 0, 50). */
  zones: number[];
  cumulative: boolean;
}

export interface MixtureConfig extends Base {
  type: 'mixture';
  x: string;
  y: string;
  z: string; // '' = time %
  xBins: number;
  yBins: number;
  mode: 'time' | 'mean' | 'max' | 'min';
  useZoom: boolean;
  showValues: boolean;
  ramp: RampName;
}

export interface TrackMapConfig extends Base {
  type: 'trackmap';
  colorBy: string; // 'lap' | 'delta' | channel name
  ramp: RampName;
  showSectors: boolean;
  showCorners: boolean;
  showZoom: boolean;
  lineWidth: number;
  rotation: number; // degrees, added to the per-track profile rotation
}

export interface LapReportConfig extends Base {
  type: 'laps';
  split: 'sectors' | 'sections' | 'none';
  showStats: boolean;
}

export interface ChannelReportConfig extends Base {
  type: 'channels';
  channels: string[];
  stats: ('min' | 'max' | 'mean' | 'std' | 'first' | 'last')[];
  useZoom: boolean;
}

export interface GaugeDef {
  channel: string;
  style: 'bar' | 'dial' | 'digital';
  min?: number;
  max?: number;
}

export interface GaugesConfig extends Base {
  type: 'gauges';
  gauges: GaugeDef[];
  columns: number;
}

export interface InputsConfig extends Base {
  type: 'inputs';
  showCompare: boolean;
}

export interface TyresConfig extends Base {
  type: 'tyres';
  mode: 'cursor' | 'mean' | 'max';
}

export interface DetailsConfig extends Base {
  type: 'details';
  tab: 'info' | 'setup' | 'notes';
  diffOnly: boolean;
}

export interface TrendConfig extends Base {
  type: 'trend';
  channel: string; // '' = lap time
  stat: 'mean' | 'max' | 'min' | 'last' | 'first' | 'delta';
  validOnly: boolean;
}

export interface CornersConfig extends Base {
  type: 'corners';
  metric: 'minSpeed' | 'time' | 'entrySpeed' | 'exitSpeed';
}

export interface FftConfig extends Base {
  type: 'fft';
  channel: string;
  maxHz: number;
  useZoom: boolean;
  logScale: boolean;
}

export type ComponentConfig =
  | GraphConfig
  | ScatterConfig
  | HistogramConfig
  | MixtureConfig
  | TrackMapConfig
  | LapReportConfig
  | ChannelReportConfig
  | GaugesConfig
  | InputsConfig
  | TyresConfig
  | DetailsConfig
  | TrendConfig
  | CornersConfig
  | FftConfig;

export type LayoutNode =
  | { kind: 'split'; id: string; dir: 'row' | 'col'; children: LayoutNode[]; sizes: number[] }
  | { kind: 'leaf'; id: string; componentId: string };

export interface Worksheet {
  id: string;
  name: string;
  layout: LayoutNode | null;
  components: Record<string, ComponentConfig>;
}

export interface ChannelProps {
  color?: string;
  min?: number;
  max?: number;
  dps?: number;
  unit?: string;
}

export interface Workspace {
  id: string;
  name: string;
  version: 1;
  worksheets: Worksheet[];
  activeSheet: number;
  math: MathChannelDef[];
  constants: MathConstant[];
  channelProps: Record<string, ChannelProps>;
  createdAt: number;
  updatedAt: number;
}

let idCounter = 0;
export const uid = (prefix = 'c') => `${prefix}${Date.now().toString(36)}${(++idCounter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
