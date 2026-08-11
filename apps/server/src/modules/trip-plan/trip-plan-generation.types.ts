import type {
  CreateTripInput,
  DailyWeather,
  Place,
  RouteEstimate,
  RouteOrderResult,
} from '@travel-guide/shared-types';

/** Verified, server-only facts supplied to a TripPlan generator. */
export interface TripPlanGenerationContext {
  readonly tripId: string;
  readonly input: CreateTripInput;
  readonly weather: DailyWeather[];
  readonly candidatePlaces: Place[];
  readonly routeEstimates: RouteEstimate[];
  readonly routeOrders?: RouteOrderResult[];
  readonly generatedAt: string;
}
