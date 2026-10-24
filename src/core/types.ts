// Core data model shared by the parser, the session builder, the math engine and every chart.

/** Channel sample storage. Float32 for almost everything; Float64 where precision matters (e.g. epoch times). */
export type Samples = Float32Array | Float64Array;

export interface MetaValue {
  value: string;
  unit: string;
}

export interface SessionMeta {
  format: string; // "AC pyTelemetry CSV" | "MoTeC CSV File" | "Generic CSV"
  venue: string;
  vehicle: string;
  driver: string;
  logDate: string;
  logTime: string;
  /** Local epoch ms when the file was saved (from Log Date + Log Time, else file mtime). */
  savedAt: number | null;
  sampleRate: number;
  duration: number;
  lapCountHeader: number | null;
  /** Lap durations straight from the header (Telemetrick `lapTimes`). First entry is log-start → first crossing. */
  lapTimesHeader: number[];
  /** Absolute lap-boundary times in seconds (cumulative lapTimes, or MoTeC "Beacon Markers"). */
  beacons: number[];
  /** Vehicle/venue details block ("data" block in Telemetrick files). */
  details: Record<string, MetaValue>;
  /** Car setup block. */
  setup: Record<string, MetaValue>;
  /** Any other key/value header lines. */
  extra: Record<string, string>;
  /** In-game clock at the first sample (epoch seconds, UTC) if a "UTC Time" channel exists. */
  gameTimeUtc: number | null;
}

export interface ParsedChannel {
  name: string;
  unit: string;
  rate: number; // Hz
  t0: number; // time of first sample, s
  data: Samples;
}

export interface ParsedFile {
  meta: SessionMeta;
  channels: ParsedChannel[];
  duration: number;
  baseRate: number;
  warnings: string[];
}

export type LapKind = 'out' | 'flying' | 'in' | 'partial' | 'session';

export interface Lap {
  index: number; // 0-based index in session.laps
  number: number; // display number, 1-based (MoTeC convention: lap 1 is the out lap)
  start: number; // session time, s
  end: number;
  time: number; // lap time, s (official where available)
  complete: boolean;
  kind: LapKind;
  invalid: boolean;
  sectors: number[]; // sector times, NaN where not covered
  /** Distance travelled in the lap (m). */
  length: number;
  /** Lap-distance samples used for distance-domain mapping (monotonic). */
  distT: Float64Array;
  distD: Float64Array;
}

export interface ChannelInfo {
  name: string;
  unit: string;
  rate: number;
  t0: number;
  data: Samples;
  min: number;
  max: number;
  discrete: boolean;
  constant: boolean;
  category: string;
  isMath: boolean;
  isDerived: boolean;
  /** Number of samples. */
  n: number;
}

export interface KeyChannels {
  time?: string;
  lapNumber?: string;
  lapDistance?: string;
  lapTime?: string;
  speed?: string;
  posX?: string;
  posY?: string;
  posZ?: string;
  lat?: string;
  lon?: string;
  lastSector?: string;
  lapInvalid?: string;
  utcTime?: string;
  throttle?: string;
  brake?: string;
  clutch?: string;
  steering?: string;
  gear?: string;
  rpm?: string;
  latG?: string;
  longG?: string;
  fuel?: string;
}

export interface Session {
  id: string;
  path: string;
  fileName: string;
  meta: SessionMeta;
  channels: Map<string, ChannelInfo>;
  /** Raw channel names in file order (math/derived channels appended). */
  channelOrder: string[];
  duration: number;
  baseRate: number;
  laps: Lap[];
  /** Pseudo-lap covering the entire outing (index -1). */
  sessionLap: Lap;
  trackLength: number;
  sectorSplits: number[]; // lap distances (m) where game sectors split
  key: KeyChannels;
  warnings: string[];
  loadedAt: number;
  fileSize: number;
  fileMtime: number;
}

export interface LapRef {
  sessionId: string;
  lapIndex: number; // -1 = whole session
}

export const lapKey = (r: LapRef) => `${r.sessionId}:${r.lapIndex}`;
export const parseLapKey = (k: string): LapRef => {
  const i = k.lastIndexOf(':');
  return { sessionId: k.slice(0, i), lapIndex: Number(k.slice(i + 1)) };
};

export type XMode = 'time' | 'distance';
