// Maps component types to their views.
import type { FC } from 'react';
import type { ComponentConfig, ComponentType } from '../state/workspace';
import { ChannelReportView } from './ChannelReportView';
import { CornerReportView } from './CornerReportView';
import { DetailsView } from './DetailsView';
import { FftView } from './FftView';
import { GpsTrackView } from './GpsTrackView';
import { GraphView } from './GraphView';
import { HistogramView } from './HistogramView';
import { GaugesView, InputsView, TyresView } from './Instruments';
import { LapReportView } from './LapReportView';
import { MixtureView } from './MixtureView';
import { ScatterView } from './ScatterView';
import { TrackMapView } from './TrackMapView';
import { TrendView } from './TrendView';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const VIEWS: Record<ComponentType, FC<{ config: any }>> = {
  graph: GraphView,
  trackmap: TrackMapView,
  gpstrack: GpsTrackView,
  scatter: ScatterView,
  histogram: HistogramView,
  mixture: MixtureView,
  laps: LapReportView,
  lapreport: LapReportView,
  channels: ChannelReportView,
  corners: CornerReportView,
  trend: TrendView,
  gauges: GaugesView,
  inputs: InputsView,
  tyres: TyresView,
  fft: FftView,
  details: DetailsView,
};

export function defaultTitle(c: ComponentConfig): string {
  switch (c.type) {
    case 'graph':
      return c.panes.map((p) => p.channels[0]).filter(Boolean).slice(0, 3).join(', ') || 'Graph';
    case 'scatter':
      return `${c.y} vs ${c.x}`;
    case 'histogram':
      return `${c.channel} histogram`;
    case 'mixture':
      return `${c.y} × ${c.x}`;
    case 'trackmap':
      return c.colorBy === 'lap' ? 'Track map' : c.colorBy === 'delta' ? 'Track map — gain/loss' : `Track map — ${c.colorBy}`;
    case 'laps':
      return 'Stint report';
    case 'lapreport':
      return 'Lap report';
    case 'channels':
      return 'Channel report';
    case 'corners':
      return 'Corners';
    case 'trend':
      return c.channel ? `${c.stat} ${c.channel} by lap` : 'Lap times by lap';
    case 'gauges':
      return 'Gauges';
    case 'inputs':
      return 'Driver inputs';
    case 'tyres':
      return 'Tyres & brakes';
    case 'fft':
      return `${c.channel} spectrum`;
    case 'details':
      return 'Session & setup';
    case 'gpstrack':
      return 'GPS track — racing lines';
  }
}
