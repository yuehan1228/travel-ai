export const TRIP_PLAN_ERROR_CODES = [
  'TRIP_PLAN_VALIDATION_ERROR',
  'TRIP_PLAN_PROVIDER_ERROR',
  'TRIP_PLAN_OUTPUT_INVALID',
  'TRIP_PLAN_ENTITY_MISMATCH',
  'TRIP_PLAN_UNAVAILABLE',
] as const;

export type TripPlanErrorCode = (typeof TRIP_PLAN_ERROR_CODES)[number];

/** A stable, sanitized error usable by a future HTTP adapter without exposing provider details. */
export class TripPlanException extends Error {
  public constructor(
    public readonly code: TripPlanErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'TripPlanException';
  }
}

export class TripPlanProviderError extends Error {
  public constructor() {
    super('TripPlan provider request failed');
    this.name = 'TripPlanProviderError';
  }
}
