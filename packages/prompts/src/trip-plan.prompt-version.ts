/** Version of the TripPlan prompt contract sent to a structured-output model. */
export const TRIP_PLAN_PROMPT_VERSION = 'trip-plan-v1.0.0' as const;

export const TRIP_PLAN_PROMPT_SCHEMA_NAME = 'trip_plan' as const;

export const MAX_TRIP_PLAN_SYSTEM_PROMPT_LENGTH = 8_000;
export const MAX_TRIP_PLAN_USER_PROMPT_LENGTH = 60_000;
