// Compatibility export for callers that keep all trip-facing services under the trips module.
export { TripPlanService, type TripPlanClock } from '../trip-plan';
export type {
  TripPlanRepository,
  TripPlanGenerationReservation,
  TripPlanGenerationReservationResult,
  TripPlanVersionRecord,
} from '../trip-plan';
