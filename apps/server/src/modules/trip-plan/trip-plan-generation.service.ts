import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { TripPlanDaySchema, TripPlanSchema } from '@travel-guide/shared-schemas';
import {
  buildTripPlanDayUserPrompt,
  buildTripPlanUserPrompt,
  TRIP_PLAN_PROMPT_SCHEMA_NAME,
  TRIP_PLAN_DAY_SYSTEM_PROMPT,
  TRIP_PLAN_SYSTEM_PROMPT,
  type TripPlanPromptContext,
} from '@travel-guide/prompts';
import type { Place, RouteEstimate, RouteOrderResult, TripPlan } from '@travel-guide/shared-types';

import { LLM_ENVIRONMENT } from './config/tokens';
import { createTestLlmEnvironment, type LlmEnvironment } from './config/llm-environment';
import {
  LLMProviderError,
  LLMStructuredOutputError,
  type LLMProvider,
} from './providers/llm.provider';
import { TripPlanException } from './trip-plan.errors';
import { TripPlanGenerationContextSchema } from './trip-plan-generation.schema';
import type { TripPlanGenerationContext } from './trip-plan-generation.types';
import { TripPlanDayRegenerationContextSchema } from './trip-plan-day-regeneration.schema';
import type { TripPlanDayRegenerationContext } from './trip-plan-day-regeneration.types';
import { TRIP_PLAN_LLM_PROVIDER } from './trip-plan.tokens';

export const MAX_MODEL_CANDIDATE_PLACES = 30;
export const MAX_MODEL_ROUTE_ESTIMATES = 200;

const validationError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_VALIDATION_ERROR',
    400,
    'The TripPlan generation context is invalid',
  );

const providerError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_PROVIDER_ERROR',
    502,
    'TripPlan generation is temporarily unavailable',
  );

const outputError = (): TripPlanException =>
  new TripPlanException('TRIP_PLAN_OUTPUT_INVALID', 502, 'The generated TripPlan is invalid');

const entityMismatchError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_ENTITY_MISMATCH',
    422,
    'The generated TripPlan references unverified data',
  );

const unavailableError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_UNAVAILABLE',
    422,
    'There is not enough verified data to generate a TripPlan',
  );

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameValue(value, right[index]));
  }
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (leftRecord === undefined || rightRecord === undefined) return false;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (
    leftKeys.length !== rightKeys.length ||
    !leftKeys.every((key, index) => key === rightKeys[index])
  ) {
    return false;
  }
  return leftKeys.every((key) => sameValue(leftRecord[key], rightRecord[key]));
};

const placeKey = (place: Place): string => `${place.provider}\u0000${place.providerPlaceId}`;

const routeMatches = (candidate: RouteEstimate, route: RouteEstimate): boolean =>
  candidate.dataSource !== 'unavailable' &&
  route.dataSource !== 'unavailable' &&
  sameValue(candidate, route);

const routeOrderMatchesPlaces = (
  routeOrder: RouteOrderResult,
  modelPlaceIds: ReadonlySet<string>,
  availableModelRoutes: readonly RouteEstimate[],
): boolean =>
  routeOrder.legs.every((leg) => {
    // RouteOrderResult point/leg ids are caller-owned matrix ids. They are
    // deliberately not compared with Place.id; only the verified endpoint
    // place ids embedded in each route estimate form the allowlist boundary.
    const originPlaceId = leg.estimate.origin.placeId;
    const destinationPlaceId = leg.estimate.destination.placeId;
    return (
      originPlaceId !== undefined &&
      destinationPlaceId !== undefined &&
      modelPlaceIds.has(originPlaceId) &&
      modelPlaceIds.has(destinationPlaceId) &&
      availableModelRoutes.some((route) => sameValue(route, leg.estimate))
    );
  });

const placesInPlan = (plan: TripPlan): Place[] => {
  const places: Place[] = [];
  for (const day of plan.days) {
    for (const item of day.items) {
      if (item.place !== undefined) places.push(item.place);
    }
  }
  for (const recommendation of plan.hotelRecommendations) {
    if (recommendation.place !== undefined) places.push(recommendation.place);
  }
  for (const recommendation of plan.foodRecommendations) {
    if (recommendation.place !== undefined) places.push(recommendation.place);
  }
  return places;
};

const placesInDay = (day: TripPlan['days'][number]): Place[] =>
  day.items.flatMap((item) => (item.place === undefined ? [] : [item.place]));

@Injectable()
export class TripPlanGenerationService {
  public constructor(
    @Inject(TRIP_PLAN_LLM_PROVIDER) private readonly provider: LLMProvider,
    @Inject(LLM_ENVIRONMENT)
    private readonly environment: LlmEnvironment = createTestLlmEnvironment(),
  ) {}

  /** Generate once from verified context; this method never calls a map/weather/route service. */
  public async generate(context: TripPlanGenerationContext): Promise<TripPlan> {
    const parsedContext = TripPlanGenerationContextSchema.safeParse(context);
    if (!parsedContext.success) throw validationError();
    if (parsedContext.data.candidatePlaces.length === 0) throw unavailableError();

    const modelPlaces = parsedContext.data.candidatePlaces.slice(0, MAX_MODEL_CANDIDATE_PLACES);
    const modelPlaceIds = new Set(modelPlaces.map((place) => place.id));
    const modelRoutes = parsedContext.data.routeEstimates
      .filter((route) => {
        const endpointPlaceIds = [route.origin.placeId, route.destination.placeId].filter(
          (placeId): placeId is string => placeId !== undefined,
        );
        return endpointPlaceIds.every((placeId) => modelPlaceIds.has(placeId));
      })
      .slice(0, MAX_MODEL_ROUTE_ESTIMATES);
    const availableModelRoutes = modelRoutes.filter((route) => route.dataSource !== 'unavailable');
    const modelRouteOrders = (parsedContext.data.routeOrders ?? []).filter((routeOrder) =>
      routeOrderMatchesPlaces(routeOrder, modelPlaceIds, availableModelRoutes),
    );
    const promptContext: TripPlanPromptContext = {
      tripId: parsedContext.data.tripId,
      input: parsedContext.data.input,
      weather: parsedContext.data.weather,
      candidatePlaces: modelPlaces,
      routeEstimates: modelRoutes,
      routeOrders: modelRouteOrders,
      generatedAt: parsedContext.data.generatedAt,
    };

    let userPrompt: string;
    try {
      userPrompt = buildTripPlanUserPrompt(promptContext);
    } catch {
      throw validationError();
    }

    let generated: TripPlan;
    try {
      generated = await this.provider.generateStructured({
        systemPrompt: TRIP_PLAN_SYSTEM_PROMPT,
        userPrompt,
        schemaName: TRIP_PLAN_PROMPT_SCHEMA_NAME,
        schema: TripPlanSchema,
        timeoutMs: this.environment.requestTimeoutMs,
      });
    } catch (error: unknown) {
      if (error instanceof LLMStructuredOutputError) throw outputError();
      if (error instanceof LLMProviderError) throw providerError();
      throw providerError();
    }

    const parsedPlan = TripPlanSchema.safeParse(generated);
    if (!parsedPlan.success) throw outputError();
    this.assertPlanMatchesContext(parsedPlan.data, parsedContext.data, modelPlaces, modelRoutes);
    return TripPlanSchema.parse(parsedPlan.data);
  }

  public generateTripPlan(context: TripPlanGenerationContext): Promise<TripPlan> {
    return this.generate(context);
  }

  /**
   * Generate one untrusted day object from verified facts. The caller is
   * responsible for merging it into a new immutable TripPlan version.
   */
  public async regenerateDay(
    context: TripPlanDayRegenerationContext,
  ): Promise<TripPlan['days'][number]> {
    const parsedContext = TripPlanDayRegenerationContextSchema.safeParse(context);
    if (!parsedContext.success) throw validationError();
    if (parsedContext.data.candidatePlaces.length === 0) throw unavailableError();

    const modelPlaces = parsedContext.data.candidatePlaces.slice(0, MAX_MODEL_CANDIDATE_PLACES);
    const modelPlaceIds = new Set(modelPlaces.map((place) => place.id));
    const modelRoutes = parsedContext.data.routeEstimates
      .filter((route) => {
        const endpointPlaceIds = [route.origin.placeId, route.destination.placeId].filter(
          (placeId): placeId is string => placeId !== undefined,
        );
        return endpointPlaceIds.every((placeId) => modelPlaceIds.has(placeId));
      })
      .slice(0, MAX_MODEL_ROUTE_ESTIMATES);
    const availableModelRoutes = modelRoutes.filter((route) => route.dataSource !== 'unavailable');
    const modelRouteOrders = (parsedContext.data.routeOrders ?? []).filter((routeOrder) =>
      routeOrderMatchesPlaces(routeOrder, modelPlaceIds, availableModelRoutes),
    );
    const targetDay = parsedContext.data.sourcePlan.days.find(
      (day) => day.dayNumber === parsedContext.data.dayNumber,
    );
    if (targetDay === undefined) throw validationError();

    let userPrompt: string;
    try {
      userPrompt = buildTripPlanDayUserPrompt({
        tripId: parsedContext.data.tripId,
        input: parsedContext.data.input,
        weather: parsedContext.data.weather,
        candidatePlaces: modelPlaces,
        routeEstimates: modelRoutes,
        routeOrders: modelRouteOrders,
        generatedAt: parsedContext.data.generatedAt,
        sourceVersion: parsedContext.data.sourceVersion,
        sourcePlan: parsedContext.data.sourcePlan,
        dayNumber: parsedContext.data.dayNumber,
        targetDay,
        adjacentDays: parsedContext.data.adjacentDays,
        ...(parsedContext.data.instruction === undefined
          ? {}
          : { instruction: parsedContext.data.instruction }),
      });
    } catch {
      throw validationError();
    }

    const dayOutputSchema = z.union([TripPlanDaySchema, TripPlanSchema]);
    let generated: TripPlan['days'][number];
    try {
      const generatedOutput = await this.provider.generateStructured({
        systemPrompt: TRIP_PLAN_DAY_SYSTEM_PROMPT,
        userPrompt,
        schemaName: 'trip_plan_day',
        schema: dayOutputSchema,
        timeoutMs: this.environment.requestTimeoutMs,
      });
      if ('days' in generatedOutput) {
        const generatedTarget = generatedOutput.days.find(
          (day) => day.dayNumber === parsedContext.data.dayNumber,
        );
        if (generatedTarget === undefined) throw outputError();
        generated = generatedTarget;
      } else {
        generated = generatedOutput;
      }
    } catch (error: unknown) {
      if (error instanceof LLMStructuredOutputError) throw outputError();
      if (error instanceof LLMProviderError) throw providerError();
      throw providerError();
    }

    const parsedDay = TripPlanDaySchema.safeParse(generated);
    if (!parsedDay.success) throw outputError();
    this.assertDayMatchesContext(parsedDay.data, parsedContext.data, modelPlaces, modelRoutes);
    return TripPlanDaySchema.parse(parsedDay.data);
  }

  public regenerateTripPlanDay(
    context: TripPlanDayRegenerationContext,
  ): Promise<TripPlan['days'][number]> {
    return this.regenerateDay(context);
  }

  public generateDay(context: TripPlanDayRegenerationContext): Promise<TripPlan['days'][number]> {
    return this.regenerateDay(context);
  }

  private assertPlanMatchesContext(
    plan: TripPlan,
    context: TripPlanGenerationContext,
    allowedPlaces: Place[],
    allowedRoutes: RouteEstimate[],
  ): void {
    if (
      plan.tripId !== context.tripId ||
      plan.cityName !== context.input.destination.cityName ||
      plan.startDate !== context.input.startDate ||
      plan.endDate !== context.input.endDate ||
      plan.travelerCount !== context.input.travelerCount ||
      plan.generatedAt !== context.generatedAt
    ) {
      throw entityMismatchError();
    }

    const placesByKey = new Map(allowedPlaces.map((place) => [placeKey(place), place]));
    for (const place of placesInPlan(plan)) {
      const canonical = placesByKey.get(placeKey(place));
      if (canonical === undefined || canonical.id !== place.id || !sameValue(canonical, place)) {
        throw entityMismatchError();
      }
    }

    for (const day of plan.days) {
      const canonicalWeather = context.weather.find((weather) => weather.date === day.date);
      if (canonicalWeather === undefined || !sameValue(canonicalWeather, day.weather)) {
        throw entityMismatchError();
      }
      for (const item of day.items) {
        if (item.route !== undefined) {
          const routeFound = allowedRoutes.some((route) => routeMatches(route, item.route!));
          if (!routeFound) throw entityMismatchError();
        }
      }
      for (const item of day.items) {
        if (
          item.place !== undefined &&
          (item.type === 'attraction' || item.type === 'food' || item.type === 'hotel') &&
          item.name !== item.place.name
        ) {
          throw entityMismatchError();
        }
      }
    }
    for (const recommendation of plan.foodRecommendations) {
      if (recommendation.place !== undefined && recommendation.name !== recommendation.place.name) {
        throw entityMismatchError();
      }
    }

    if (
      context.weather.some((weather) => weather.source === 'climate_reference') &&
      !plan.days.some((day) =>
        day.warnings.some((warning) => warning.code === 'WEATHER_CLIMATE_REFERENCE'),
      )
    ) {
      throw outputError();
    }
  }

  private assertDayMatchesContext(
    day: TripPlan['days'][number],
    context: TripPlanDayRegenerationContext,
    allowedPlaces: Place[],
    allowedRoutes: RouteEstimate[],
  ): void {
    if (
      day.dayNumber !== context.dayNumber ||
      day.date !== context.targetDay.date ||
      day.weather.date !== context.targetDay.date
    ) {
      throw entityMismatchError();
    }

    const canonicalWeather = context.weather.find((weather) => weather.date === day.date);
    if (canonicalWeather === undefined || !sameValue(canonicalWeather, day.weather)) {
      throw entityMismatchError();
    }

    const placesByKey = new Map(allowedPlaces.map((place) => [placeKey(place), place]));
    for (const place of placesInDay(day)) {
      const canonical = placesByKey.get(placeKey(place));
      if (canonical === undefined || canonical.id !== place.id || !sameValue(canonical, place)) {
        throw entityMismatchError();
      }
    }

    for (const item of day.items) {
      if (item.route !== undefined) {
        const routeFound = allowedRoutes.some((route) => routeMatches(route, item.route!));
        if (!routeFound) throw entityMismatchError();
      }
      if (
        item.place !== undefined &&
        (item.type === 'attraction' || item.type === 'food' || item.type === 'hotel') &&
        item.name !== item.place.name
      ) {
        throw entityMismatchError();
      }
    }

    if (
      day.weather.source === 'climate_reference' &&
      !day.warnings.some((warning) => warning.code === 'WEATHER_CLIMATE_REFERENCE')
    ) {
      throw outputError();
    }
  }
}
