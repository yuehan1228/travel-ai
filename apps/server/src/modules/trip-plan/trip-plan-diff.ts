/**
 * Server-facing re-export for the shared, provider-free TripPlan comparison
 * implementation. Keeping this module small makes the pure function convenient
 * to test from the server package without duplicating comparison semantics.
 */
export {
  compareTripPlanVersions,
  withTripPlanVersionDiffVersions,
  TripPlanDiffValidationError,
} from '@travel-guide/shared-types';
export type {
  TripPlanVersionDiffInput,
  TripPlanVersionDiffResult,
  TripPlanDayChange,
  TripPlanItemChange,
  TripPlanBudgetDiff,
} from '@travel-guide/shared-types';
