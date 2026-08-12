import type {
  CreateTripInput,
  DailyWeather,
  Place,
  RouteEstimate,
  RouteOrderResult,
  TripPlan,
  TripPlanDay,
} from '@travel-guide/shared-types';

/**
 * Server-owned facts used when replacing one day.  The source snapshot is kept
 * in the context so the generator can see adjacent days without allowing the
 * caller to submit or alter any plan data.
 */
export interface TripPlanDayRegenerationContext {
  readonly tripId: string;
  readonly input: CreateTripInput;
  readonly sourceVersion: number;
  readonly sourcePlan: TripPlan;
  readonly dayNumber: number;
  readonly targetDay: TripPlanDay;
  readonly adjacentDays: TripPlanDay[];
  readonly instruction?: string;
  readonly weather: DailyWeather[];
  readonly candidatePlaces: Place[];
  readonly routeEstimates: RouteEstimate[];
  readonly routeOrders?: RouteOrderResult[];
  readonly generatedAt: string;
}

/** Compatibility aliases for callers that use the shorter regeneration name. */
export type RegenerateTripPlanDayContext = TripPlanDayRegenerationContext;
