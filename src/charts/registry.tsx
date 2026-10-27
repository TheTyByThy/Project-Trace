// Maps component types to their views.
import type { FC } from 'react';
import type { ComponentConfig, ComponentType } from '../state/workspace';
import { BarsView } from './BarsView';
import { ChannelReportView } from './ChannelReportView';
import { channelLabel } from './data';
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
import { TimeBreakdownView } from './TimeBreakdownView';
import { TrendView } from './TrendView';
import { TyreWearView } from './TyreWearView';
import { WearWheelsView } from './WearWheelsView';
import { WearBalanceView } from './WearBalanceView';
import { WearSummaryView } from './WearSummaryView';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const VIEWS: Record<ComponentType, FC<{ config: any }>> = {
  graph: GraphView,
  trackmap: TrackMapView,
  gpstrack: GpsTrackView,
  bars: BarsView,
  breakdown: TimeBreakdownView,
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
  tyrewear: TyreWearView,
  wearwheels: WearWheelsView,
  wearbalance: WearBalanceView,
  wearsummary: WearSummaryView,
};

export function defaultTitle(c: ComponentConfig): string {
  switch (c.type) {
    case 'graph':
      return c.panes.map((p) => p.channels[0]).filter(Boolean).slice(0, 3).map(channelLabel).join(', ') || 'Graph';
    case 'scatter':
      return `${channelLabel(c.y)} vs ${channelLabel(c.x)}`;
    case 'histogram':
      return `${channelLabel(c.channel)} histogram`;
    case 'mixture':
      return `${channelLabel(c.y)} × ${channelLabel(c.x)}`;
    case 'trackmap':
      return c.colorBy === 'lap' ? 'Track map' : c.colorBy === 'delta' ? 'Track map — gain/loss' : `Track map — ${c.channelDelta ? 'Δ ' : ''}${channelLabel(c.colorBy)}`;
    case 'laps':
      return 'Stint report';
    case 'lapreport':
      return 'Lap report';
    case 'channels':
      return 'Channel report';
    case 'corners':
      return 'Corners';
    case 'trend':
      return c.channel ? `${c.stat} ${channelLabel(c.channel)} by lap` : 'Lap times by lap';
    case 'gauges':
      return 'Gauges';
    case 'inputs':
      return 'Driver inputs';
    case 'tyres':
      return 'Tyres & brakes';
    case 'fft':
      return `${channelLabel(c.channel)} spectrum`;
    case 'details':
      return 'Session & setup';
    case 'gpstrack':
      return 'GPS track — racing lines';
    case 'breakdown':
      return 'Time breakdown';
    case 'tyrewear':
      return 'Tyre wear';
    case 'wearwheels':
      return 'Tyre wear wheels';
    case 'wearbalance':
      return 'Tyre wear balance';
    case 'wearsummary':
      return 'Tyre wear — whole car';
    case 'bars':
      return c.rows.map((r) => r.label || channelLabel(r.channel)).slice(0, 3).join(', ') || 'Bars';
  }
}
