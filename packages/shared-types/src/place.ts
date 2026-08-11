/** Supported public place categories. */
export type PlaceCategory =
  | 'attraction'
  | 'museum'
  | 'park'
  | 'restaurant'
  | 'local_food'
  | 'cafe'
  | 'shopping'
  | 'nightlife'
  | 'hotel_area'
  | 'other';

export const PLACE_CATEGORIES = [
  'attraction',
  'museum',
  'park',
  'restaurant',
  'local_food',
  'cafe',
  'shopping',
  'nightlife',
  'hotel_area',
  'other',
] as const;

export type PlaceDataSource = 'map_provider' | 'cache';

export const PLACE_DATA_SOURCES = ['map_provider', 'cache'] as const;

export interface GeoPoint {
  longitude: number;
  latitude: number;
}

export interface SearchPlacesInput {
  cityName: string;
  cityCode?: string;
  keyword?: string;
  categories: PlaceCategory[];
  page?: number;
  pageSize?: number;
}

export interface Place {
  id: string;
  provider: string;
  providerPlaceId: string;
  name: string;
  category: PlaceCategory;
  categoryText: string;
  address: string;
  location: GeoPoint;
  rating?: number;
  openingHours?: string;
  telephone?: string;
  verifiedAt: string;
  dataSource: PlaceDataSource;
}

import type { PaginationMeta } from './api';

export interface PlaceListResult {
  items: Place[];
  pagination: PaginationMeta;
  fetchedAt: string;
}
