/** Injection token for the replaceable LLM implementation. */
export const TRIP_PLAN_LLM_PROVIDER = Symbol('TRIP_PLAN_LLM_PROVIDER');

export const TRIP_PLAN_REPOSITORY = Symbol('TRIP_PLAN_REPOSITORY');
export const TRIP_PLAN_CLOCK = Symbol('TRIP_PLAN_CLOCK');

// Naming aliases retained for callers that model the table as a version repository.
export const TRIP_PLAN_VERSION_REPOSITORY = TRIP_PLAN_REPOSITORY;

export const TRIP_PLAN_LLM_PROVIDER_TOKEN = TRIP_PLAN_LLM_PROVIDER;
export const LLM_PROVIDER = TRIP_PLAN_LLM_PROVIDER;
export const LLM_PROVIDER_TOKEN = TRIP_PLAN_LLM_PROVIDER;
