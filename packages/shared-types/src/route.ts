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
