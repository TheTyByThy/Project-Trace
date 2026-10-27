// Workspace model (MoTeC terminology: a Workspace holds Worksheets; each worksheet is a layout
// of Components). Everything here is plain JSON so workspaces can be saved, shared and imported.

import type { MathChannelDef, MathConstant } from '../core/math/evaluate';
import type { RampName } from '../core/colors';
import type { FitKind } from '../core/fit';

export type ComponentType =
  | 'graph'
  | 'scatter'
  | 'histogram'
  | 'mixture'
  | 'trackmap'
  | 'laps'
  | 'lapreport'
  | 'channels'
  | 'gauges'
  | 'inputs'
  | 'tyres'
  | 'details'
  | 'trend'
  | 'corners'
  | 'fft'
  | 'gpstrack'
  | 'bars'
  | 'breakdown'
  | 'tyrewear'
  | 'wearwheels'
  | 'wearbalance';

export interface GraphPane {
  id: string;
  channels: string[];
  weight: number;
  /** 'shared' = one y-scale (best for same units); 'independent' = each channel scaled to the pane. */
  scale: 'auto' | 'shared' | 'independent';
  /** Optional fixed range for shared scale. */
  min?: number;
  max?: number;
  /** Channels kept in the pane but not drawn (toggled from the legend or Properties). */
  hidden?: string[];
}

interface Base {
  id: string;
  title?: string;
}

export interface GraphConfig extends Base {
  type: 'graph';
  panes: GraphPane[];
  showVariance: boolean;
  /** Relative height of the variance pane (same units as pane weights). */
  varianceWeight?: number;
  /** Marker visibility is shared by every graph in the workspace (toggling one updates all). */
  /** The game's sector lines (S2, S3…). */
  showSectors: boolean;
  /** Your custom split lines (Track editor); undefined = follow showSectors (older workspaces). */
  showSplits?: boolean;
  showCorners: boolean;
  yRange: 'full' | 'visible';
  /** Channel legends with live values (default on). */
  showLegend?: boolean;
  /** Horizontal grid lines (default on). */
  showGrid?: boolean;
  /** Reference / comparison trace widths in px (defaults 1.5 / 1.2). */
  refLineWidth?: number;
  lapLineWidth?: number;
}

/** A condition drawn as a filled bar wherever it holds (Bars component). */
export interface BarRow {
  id: string;
  channel: string;
  /** 'nonzero' = true wherever the channel isn't 0 (boolean / flag channels). */
  op: 'nonzero' | 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'between';
  /** Threshold in the channel's display units. */
  value: number;
  /** Upper bound for 'between'. */
  value2?: number;
  /** Bar colour for the reference lap (comparison laps use their lap colour). */
  color?: string;
  label?: string;
}

/** Bars: like a time/distance graph, but each row is a filled bar where a condition is true. */
export interface BarsConfig extends Base {
  type: 'bars';
  rows: BarRow[];
  /** 'all' = one thin lane per selected lap; 'ref' = the reference lap only. */
  laps: 'all' | 'ref';
  /** All rows in one: where several conditions hold at once, the earliest row in the list wins. */
  combined?: boolean;
  showLabels: boolean;
  /** X-axis labels along the bottom (off by default, so it sits seamlessly under a graph). */
  showAxis: boolean;
  showSectors: boolean;
  /** Custom split lines; undefined = follow showSectors. */
  showSplits?: boolean;
  showCorners: boolean;
}

/** Time breakdown: time gained / lost in low, medium and high-speed corners and on straights. */
export interface BreakdownConfig extends Base {
  type: 'breakdown';
  /** Gain / loss bars next to each Δ (default on). */
  showBars?: boolean;
  /** The reference lap's time in each bucket (default on). */
  showTimes?: boolean;
}

/** Tyre wear balance: front vs rear and left vs right — shares, metres and what each gap is made of; lap by lap below. */
export interface WearBalanceConfig extends Base {
  type: 'wearbalance';
  /** Comparison laps shown under the reference (default 1). */
  maxCompare?: number;
  /** Lap-by-lap table through each open stint, with one-off laps flagged (default on). */
  showLaps?: boolean;
  /** Show the corner clicked in a Tyre Wear table or Corner Report instead of the whole lap (default on). */
  followFocus?: boolean;
}

/** Tyre wear wheels: each tyre's rubber as a ring split into lock-up / wheelspin / slide (ref outside, comparisons inside). */
export interface WearWheelsConfig extends Base {
  type: 'wearwheels';
  /** 'share' (default): every ring goes all the way round, showing the mix; 'amount': ring length = wear. */
  mode?: 'share' | 'amount';
  /** Four tyres (default), one axle, one tyre, or the average of the four. */
  tyre?: 'all' | 'avg' | 'front' | 'rear' | 'FL' | 'FR' | 'RL' | 'RR';
  /** Comparison laps drawn as inner rings (default 1, up to 2). */
  maxCompare?: number;
  /** Show the section clicked in a Tyre Wear table instead of the whole lap (default on). */
  followFocus?: boolean;
  /** 'm' (default): causes and differences in metres; 'pct': as % (cause share of the lap's wear, difference vs the reference). Totals stay in metres. */
  units?: 'm' | 'pct';
}

/** Tyre wear: how much rubber each tyre loses on each selected lap, why (lock-up / wheelspin / slide), and where. */
export interface TyreWearConfig extends Base {
  type: 'tyrewear';
  /** Lap cards: one per tyre (default), or one card with the four tyres averaged. */
  cards?: 'tyres' | 'average';
  /** Tyre the "where" table looks at (default the four averaged). */
  tyre?: 'all' | 'FL' | 'FR' | 'RL' | 'RR';
  /** Rows: your corners and the straights between them, or fixed-length mini-sectors (default corners when defined). */
  sections?: 'corners' | 'mini';
  /** Comparison laps: also show each lap's own wear and lock-up / wheelspin / slide breakdown (default off: Δ only). */
  showBreakdown?: boolean;
  /** Rows for the straights between corners (default off; the whole-lap total still counts them). */
  showStraights?: boolean;
  /** Row order: around the lap, or biggest extra wear against the reference first. */
  sort?: 'track' | 'delta';
  /** Clicking a row opens a pop-out with that section's wear per tyre and by cause (default on). */
  popout?: boolean;
  /** Game's own grip loss (Tire Rubber Grip) next to each lap, and the game wear factor (default off). */
  showGame?: boolean;
}

export interface ScatterConfig extends Base {
  type: 'scatter';
  x: string;
  y: string;
  color: string; // 'lap' or channel name
  pointSize: number;
  /** Best-fit curve kind ('none' = off, from older configs) — see FitOptions. */
  fit: FitKind | 'none';
  showFit?: boolean;
  showEquation?: boolean;
  equalAspect: boolean;
  useZoom: boolean;
  intervalAvg: boolean;
  intervalCount: number;
  ramp: RampName;
  gate?: string; // optional channel: only plot samples where gate channel is non-zero
  /** Grip envelope: the outer edge of the points (G-G) and how much of it each lap used. */
  envelope?: boolean;
  /** Fixed axis ranges (display units); undefined = automatic. */
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
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
  /** Colours for the 'custom' ramp (low → high). */
  customLow?: string;
  customHigh?: string;
  /** The game's sector markers (S2, S3…). */
  showSectors: boolean;
  /** Custom split markers; undefined = follow showSectors (older workspaces). */
  showSplits?: boolean;
  showCorners: boolean;
  showZoom: boolean;
  /** Frame the graphs' zoomed range like the GPS track does (default on). */
  fitToZoom?: boolean;
  lineWidth: number;
  /** Grey track outline under the coloured line (default on). */
  showOutline?: boolean;
  /** Colour key / lap legend along the bottom (default on). */
  showLegend?: boolean;
  /** Start / finish tick (default on). */
  showStartFinish?: boolean;
  /** Car position dots at the cursor (default on). */
  showCars?: boolean;
  /** Channel colouring: colour by the comparison lap minus the reference at the same lap distance (red = higher). */
  channelDelta?: boolean;
  /** Gain/loss colouring: the comparison lap (lap key) compared with the reference; missing = the first one. */
  compareKey?: string;
  /** Gain/loss colouring: higher = smaller differences reach full colour (default 1). */
  deltaSensitivity?: number;
  /** Gain/loss colouring: distance the rate of gain/loss is averaged over, in metres (default 32). */
  deltaSmoothing?: number;
  /** @deprecated rotation now lives in the per-track profile. */
  rotation?: number;
}

/** Racing-line comparison: thin per-lap lines from car coordinates. */
export interface GpsTrackConfig extends Base {
  type: 'gpstrack';
  lineWidth: number;
  /** Frame the graphs' zoomed range automatically. */
  fitToZoom: boolean;
  /** Keep the reference car centred when zoomed in. */
  followCursor: boolean;
  /** @deprecated the approximate track band was removed; only raw car positions are drawn. */
  showRoad?: boolean;
  /** The game's sector markers (S2, S3…). */
  showSectors: boolean;
  /** Custom split markers; undefined = follow showSectors (older workspaces). */
  showSplits?: boolean;
  showCorners: boolean;
  /** Metric scale bar (default on). */
  showScale?: boolean;
  /** Lap legend along the bottom (default on). */
  showLegend?: boolean;
  /** Lateral offset of each lap from the reference at the cursor (default on). */
  showOffsets?: boolean;
}

/** Column switches shared by the Stint Report and the Lap Report (all default on). */
export interface LapColumns {
  showDelta?: boolean;
  showSplits?: boolean;
  showIdeal?: boolean;
  showTags?: boolean;
}

/** Stint report: every lap of every open session. */
export interface LapReportConfig extends Base, LapColumns {
  type: 'laps';
  split: 'sectors' | 'sections' | 'none';
  showStats: boolean;
}

/** Lap report: only the selected laps (reference and comparisons). */
export interface SelectedLapReportConfig extends Base, LapColumns {
  type: 'lapreport';
  split: 'sectors' | 'sections' | 'none';
  showStats: boolean;
  /** Comparison laps' sectors as absolute times (default) or as the difference to the reference. */
  sectorMode?: 'absolute' | 'delta';
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

/** The parts of the Driver Inputs panel that read a channel. */
export type InputRole = 'throttle' | 'brake' | 'clutch' | 'steering' | 'gear' | 'speed' | 'rpm';

export interface InputsConfig extends Base {
  type: 'inputs';
  showCompare: boolean;
  /** Channel for each part; missing = the automatically detected one (Throttle Pos, Brake Pos…). */
  channels?: Partial<Record<InputRole, string>>;
  /** Show a pedal bar upside down (100 − value). Clutch defaults to inverted for AC's Clutch Pos. */
  invert?: Partial<Record<'throttle' | 'brake' | 'clutch', boolean>>;
  /** Each part defaults to shown. */
  showPedals?: boolean;
  showClutch?: boolean;
  showSteering?: boolean;
  showGear?: boolean;
  showSpeed?: boolean;
  showRpm?: boolean;
}

/** Information the tyre panel can show for each wheel. */
export type TyreField =
  | 'surface'
  | 'surfaceValues'
  | 'core'
  | 'brakeDisc'
  | 'pressure'
  | 'brakeTemp'
  | 'load'
  | 'slipAngle'
  | 'slipRatio'
  | 'wear'
  | 'grip'
  | 'dirt'
  | 'grain'
  | 'blister'
  | 'camber'
  | 'travel'
  | 'wheelSpeed'
  | 'latForce'
  | 'longForce'
  | 'loadedRadius'
  | 'ndSlip'
  | 'wearRate';

export const TYRE_FIELDS: { key: TyreField; label: string; default: boolean }[] = [
  { key: 'surface', label: 'Surface temperature strips (inner / middle / outer)', default: true },
  { key: 'surfaceValues', label: 'Surface temperature numbers', default: true },
  { key: 'core', label: 'Core temperature', default: true },
  { key: 'brakeDisc', label: 'Brake disc (temperature colour)', default: true },
  { key: 'pressure', label: 'Pressure', default: true },
  { key: 'brakeTemp', label: 'Brake temperature', default: true },
  { key: 'load', label: 'Load', default: true },
  { key: 'slipAngle', label: 'Slip angle', default: true },
  { key: 'slipRatio', label: 'Slip ratio', default: false },
  { key: 'wear', label: 'Wear (virtual km)', default: false },
  { key: 'grip', label: 'Rubber grip', default: false },
  { key: 'dirt', label: 'Dirt level', default: false },
  { key: 'grain', label: 'Graining', default: false },
  { key: 'blister', label: 'Blistering', default: false },
  { key: 'camber', label: 'Camber', default: false },
  { key: 'travel', label: 'Suspension travel', default: false },
  { key: 'wheelSpeed', label: 'Wheel angular speed', default: false },
  { key: 'latForce', label: 'Lateral force (Fy)', default: false },
  { key: 'longForce', label: 'Longitudinal force (Fx)', default: false },
  { key: 'loadedRadius', label: 'Loaded radius', default: false },
  { key: 'ndSlip', label: 'Normalised slip (ndSlip: 1 = at the grip peak)', default: false },
  { key: 'wearRate', label: 'Tyre wear rate (0–100)', default: false },
];

export interface TyresConfig extends Base {
  type: 'tyres';
  mode: 'cursor' | 'mean' | 'max';
  /** Fields to show (undefined = the defaults in TYRE_FIELDS). */
  fields?: TyreField[];
  /** Show the footer caption (default on). */
  showCaption?: boolean;
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
  yMin?: number;
  yMax?: number;
  /** Lap times: raw, fuel-corrected, or both (default raw). */
  lapTimes?: 'raw' | 'corrected' | 'both';
  /** Fuel correction: seconds of lap time per litre of fuel on board (default 0.03). */
  fuelEffect?: number;
  /** Best-fit line through each series (off by default), its kind, and whether to show its equation. */
  showFit?: boolean;
  fit?: FitKind;
  showEquation?: boolean;
  /** Channel trends: leave out laps that aren't complete (out / in / partial laps; default off). */
  completeOnly?: boolean;
  /** Lap times: hide laps slower than `cutoff` % of the fastest shown (the 107% rule; default off, 107). */
  cutoffOn?: boolean;
  cutoff?: number;
  /** A one-line explanation shown at the top of the chart, with more on hover (e.g. what blistering means). */
  note?: string;
  noteDetail?: string;
  /** Key of which colour is which stint, top left (default off — the colours follow the lap selection). */
  showLegend?: boolean;
}

export interface CornersConfig extends Base {
  type: 'corners';
  metric: 'minSpeed' | 'time' | 'entrySpeed' | 'exitSpeed';
  /** Rows for the straights between corners (default off; totals still count them). */
  showStraights?: boolean;
  /** Corner vs straight time totals (default on). */
  showTotals?: boolean;
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
  | SelectedLapReportConfig
  | ChannelReportConfig
  | GaugesConfig
  | InputsConfig
  | TyresConfig
  | DetailsConfig
  | TrendConfig
  | CornersConfig
  | FftConfig
  | GpsTrackConfig
  | BarsConfig
  | BreakdownConfig
  | TyreWearConfig
  | WearWheelsConfig
  | WearBalanceConfig;

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
  /** Display name shown everywhere instead of the logged name (graphs and math still use the logged name). */
  label?: string;
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
  /** Built-in template (the Starter workspace): never modified in place. */
  locked?: boolean;
}

let idCounter = 0;
export const uid = (prefix = 'c') => `${prefix}${Date.now().toString(36)}${(++idCounter).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
