import type { PaginationMeta } from './api';

export const TRAVEL_PREFERENCES = [
  'nature',
  'history',
  'museum',
  'city_walk',
  'food',
  'trendy',
  'photography',
  'family',
  'couple',
  'leisure',
  'hiking',
  'hidden_gems',
  'nightlife',
  'shopping',
] as const;

export type TravelPreference = (typeof TRAVEL_PREFERENCES)[number];

export const TRAVEL_PACES = ['relaxed', 'moderate', 'intensive'] as const;

export type TravelPace = (typeof TRAVEL_PACES)[number];

export const TRANSPORT_PREFERENCES = [
  'public_transport',
  'taxi',
  'driving',
  'walk_and_public_transport',
] as const;

export type TransportPreference = (typeof TRANSPORT_PREFERENCES)[number];

export const BUDGET_LEVELS = ['economy', 'comfortable', 'premium'] as const;

export type BudgetLevel = (typeof BUDGET_LEVELS)[number];

export type TripBudgetInput =
  | {
      type: 'level';
      level: BudgetLevel;
      currency: 'CNY';
    }
  | {
      type: 'custom';
      totalCny: number;
      currency: 'CNY';
    };

export interface DestinationInput {
  cityName: string;
  cityCode?: string;
}

export interface CreateTripInput {
  destination: DestinationInput;
  origin?: string;
  startDate: string;
  endDate: string;
  travelerCount: number;
  preferences: TravelPreference[];
  pace: TravelPace;
  budget?: TripBudgetInput;
  transportPreference: TransportPreference;
  extraRequirements?: string;
}

/** Lifecycle state persisted for a travel request. */
export const TRIP_STATUSES = ['draft', 'generating', 'ready', 'failed', 'deleted'] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

/** Fields a caller may change on an existing travel request. */
export type UpdateTripInput = Partial<CreateTripInput>;

export interface ListTripsInput {
  page?: number;
  pageSize?: number;
  status?: TripStatus;
}

export interface TripSummary {
  id: string;
  status: TripStatus;
  destination: DestinationInput;
  startDate: string;
  endDate: string;
  travelerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TripDetail extends TripSummary, CreateTripInput {}

export interface TripListResult {
  items: TripSummary[];
  pagination: PaginationMeta;
}

export interface TripDeleteResult {
  id: string;
  deleted: true;
}
