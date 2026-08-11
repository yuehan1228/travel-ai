import type { DailyWeather } from './weather';
import type { Place } from './place';
import type { RouteEstimate } from './route';

/** Kinds of entries that may appear in a generated itinerary. */
export const TRIP_PLAN_ITEM_TYPES = ['attraction', 'food', 'transport', 'hotel', 'rest'] as const;

export type TripPlanItemType = (typeof TRIP_PLAN_ITEM_TYPES)[number];

/** Data origins are intentionally coarser than provider-specific responses. */
export const TRIP_PLAN_DATA_SOURCES = [
  'map_provider',
  'weather_provider',
  'route_provider',
  'user_input',
  'ai_generated',
] as const;

export type TripPlanDataSource = (typeof TRIP_PLAN_DATA_SOURCES)[number];

export const TRIP_PLAN_WARNING_SEVERITIES = ['info', 'warning'] as const;

export type TripPlanWarningSeverity = (typeof TRIP_PLAN_WARNING_SEVERITIES)[number];

/** A stable, user-visible warning attached to a day or to the whole plan. */
export interface TripPlanWarning {
  code: string;
  severity: TripPlanWarningSeverity;
  message: string;
  dayNumber?: number;
}

/** A single timed itinerary entry. */
export interface TripPlanItem {
  id: string;
  type: TripPlanItemType;
  startTime: string;
  endTime: string;
  name: string;
  description: string;
  recommendationReason: string;
  place?: Place;
  route?: RouteEstimate;
  estimatedCostCny: number;
  tips: string[];
  dataSources: TripPlanDataSource[];
}

export interface TripPlanDay {
  dayNumber: number;
  date: string;
  summary: string;
  weather: DailyWeather;
  items: TripPlanItem[];
  estimatedCostCny: number;
  warnings: TripPlanWarning[];
}

/** A recommendation for an area to use as a base; it is not a hotel quote. */
export interface HotelAreaRecommendation {
  id: string;
  areaName: string;
  description: string;
  recommendationReason: string;
  place?: Place;
  tips: string[];
  dataSources: TripPlanDataSource[];
}

/** A food recommendation may be generic or tied to a verified Place. */
export interface FoodRecommendation {
  id: string;
  name: string;
  description: string;
  recommendationReason: string;
  cuisine?: string;
  place?: Place;
  tips: string[];
  dataSources: TripPlanDataSource[];
}

/** Category totals are derived from the item costs, not supplier quotations. */
export interface TripBudgetEstimate {
  currency: 'CNY';
  totalCny: number;
  accommodationCny: number;
  transportationCny: number;
  foodCny: number;
  attractionsCny: number;
  otherCny: number;
}

export interface TripPlan {
  schemaVersion: '1.0';
  tripId: string;
  cityName: string;
  startDate: string;
  endDate: string;
  travelerCount: number;
  summary: string;
  days: TripPlanDay[];
  hotelRecommendations: HotelAreaRecommendation[];
  foodRecommendations: FoodRecommendation[];
  budget: TripBudgetEstimate;
  transportationTips: string[];
  generalTips: string[];
  generatedAt: string;
}
