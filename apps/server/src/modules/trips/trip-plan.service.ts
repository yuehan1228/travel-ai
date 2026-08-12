// Compatibility export for callers that keep all trip-facing services under the trips module.
export { TripPlanService, type TripPlanClock } from '../trip-plan';
export type {
  TripPlanRepository,
  TripPlanGenerationReservation,
  TripPlanGenerationReservationResult,
  TripPlanEditReservationResult,
  TripPlanVersionRecord,
} from '../trip-plan';
export { applyTripPlanEdits, TripPlanEditError } from '../trip-plan';
