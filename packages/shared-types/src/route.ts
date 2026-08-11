import type { GeoPoint } from './place';

export type RouteMode = 'walking' | 'driving';

export const ROUTE_MODES = ['walking', 'driving'] as const;

export type RouteDataSource = 'map_provider' | 'cache' | 'unavailable';

export const ROUTE_DATA_SOURCES = ['map_provider', 'cache', 'unavailable'] as const;

export interface RouteEndpoint {
  location: GeoPoint;
  placeId?: string;
}

export interface EstimateRouteInput {
  origin: RouteEndpoint;
  destination: RouteEndpoint;
  mode: RouteMode;
}

export interface RouteMatrixPoint {
  id: string;
  endpoint: RouteEndpoint;
}

export interface EstimateRouteMatrixInput {
  points: RouteMatrixPoint[];
  mode: RouteMode;
}

export interface RouteMatrixCell {
  originId: string;
  destinationId: string;
  estimate?: RouteEstimate;
  status: 'available' | 'unavailable';
}

export interface RouteMatrixResult {
  points: RouteMatrixPoint[];
  mode: RouteMode;
  cells: RouteMatrixCell[];
  generatedAt: string;
}

export interface EstimateRouteOrderInput {
  points: RouteMatrixPoint[];
  mode: RouteMode;
  startId?: string;
  endId?: string;
}

export interface RouteOrderLeg {
  originId: string;
  destinationId: string;
  estimate: RouteEstimate;
}

export interface RouteOrderResult {
  orderedPointIds: string[];
  legs: RouteOrderLeg[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  mode: RouteMode;
  algorithm: 'nearest_neighbor';
  isOptimal: false;
  generatedAt: string;
  warnings: string[];
}

export type RouteOrderCandidateStatus = 'available' | 'unavailable';

export type RouteOrderDecisionReason =
  'shortest_duration' | 'shortest_distance_tiebreaker' | 'destination_id_tiebreaker' | 'fixed_end';

export interface RouteOrderCandidateExplanation {
  destinationId: string;
  status: RouteOrderCandidateStatus;
  durationSeconds?: number;
  distanceMeters?: number;
  rejectionReason?: string;
}

export interface RouteOrderDecisionExplanation {
  /** One-based decision number, matching the corresponding route leg. */
  step: number;
  originId: string;
  selectedDestinationId: string;
  reason: RouteOrderDecisionReason;
  candidates: RouteOrderCandidateExplanation[];
}

export interface RouteOrderUnavailablePair {
  originId: string;
  destinationId: string;
}

export interface RouteOrderExplanationResult {
  order: RouteOrderResult;
  decisions: RouteOrderDecisionExplanation[];
  unavailablePairs: RouteOrderUnavailablePair[];
  algorithmNotice: string;
}

export interface RouteEstimateBase {
  origin: RouteEndpoint;
  destination: RouteEndpoint;
  mode: RouteMode;
  dataSource: RouteDataSource;
  provider: string;
  fetchedAt: string;
}

export interface AvailableRouteEstimate extends RouteEstimateBase {
  distanceMeters: number;
  durationSeconds: number;
  tollsCny?: number;
  dataSource: 'map_provider' | 'cache';
}

export interface UnavailableRouteEstimate extends RouteEstimateBase {
  dataSource: 'unavailable';
  distanceMeters?: never;
  durationSeconds?: never;
  tollsCny?: never;
}

export type RouteEstimate = AvailableRouteEstimate | UnavailableRouteEstimate;
