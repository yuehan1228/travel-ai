import type {
  CreateTripInput,
  DailyWeather,
  Place,
  RouteEstimate,
  RouteOrderResult,
} from '@travel-guide/shared-types';

import {
  MAX_TRIP_PLAN_USER_PROMPT_LENGTH,
  TRIP_PLAN_PROMPT_VERSION,
} from './trip-plan.prompt-version';

export interface TripPlanPromptContext {
  readonly tripId: string;
  readonly input: CreateTripInput;
  readonly weather: readonly DailyWeather[];
  readonly candidatePlaces: readonly Place[];
  readonly routeEstimates: readonly RouteEstimate[];
  readonly routeOrders?: readonly RouteOrderResult[];
  readonly generatedAt: string;
}

const json = (value: unknown): string => JSON.stringify(value) ?? '';

/** Build a bounded, deterministic user prompt. Never log the returned string. */
export const buildTripPlanUserPrompt = (context: TripPlanPromptContext): string => {
  const payload = {
    promptVersion: TRIP_PLAN_PROMPT_VERSION,
    trip: {
      tripId: context.tripId,
      destination: context.input.destination,
      origin: context.input.origin,
      startDate: context.input.startDate,
      endDate: context.input.endDate,
      travelerCount: context.input.travelerCount,
      preferences: context.input.preferences,
      pace: context.input.pace,
      budget: context.input.budget,
      transportPreference: context.input.transportPreference,
      extraRequirements: context.input.extraRequirements,
    },
    verifiedContext: {
      weather: context.weather,
      candidatePlaces: context.candidatePlaces,
      routeEstimates: context.routeEstimates,
      routeOrders: context.routeOrders,
    },
    outputRules: {
      generatedAt: context.generatedAt,
      schemaName: 'trip_plan',
      onlyUseCandidatePlaceIds: context.candidatePlaces.map(
        (place) => `${place.provider}:${place.providerPlaceId}`,
      ),
    },
  };

  const result = [
    'Create a personalized itinerary from this verified context.',
    'The candidatePlaces, weather, and routeEstimates arrays are the complete factual allowlist.',
    'Do not add factual entities or values that are absent from those arrays.',
    'Return JSON only; do not use Markdown fences or explanatory text.',
    json(payload),
  ].join('\n');

  if (result.length > MAX_TRIP_PLAN_USER_PROMPT_LENGTH) {
    throw new Error('TripPlan user prompt exceeds its safety length limit');
  }
  return result;
};
