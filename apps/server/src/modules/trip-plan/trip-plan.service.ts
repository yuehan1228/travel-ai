import { Inject, Injectable } from '@nestjs/common';

import {
  CreateTripInputSchema,
  EditTripPlanInputSchema,
  EditTripPlanResultSchema,
  GenerateTripPlanInputSchema,
  PlaceListResultSchema,
  PlaceSchema,
  ListTripPlanItemReplacementCandidatesInputSchema,
  TripPlanItemReplacementCandidateListSchema,
  ReplaceTripPlanItemInputSchema,
  ReplaceTripPlanItemResultSchema,
  ReorderTripPlanItemsInputSchema,
  ReorderTripPlanItemsResultSchema,
  RegenerateTripPlanDayInputSchema,
  RegenerateTripPlanDayResultSchema,
  RestoreTripPlanVersionInputSchema,
  RestoreTripPlanVersionResultSchema,
  TripPlanVersionDiffInputSchema,
  TripPlanVersionDiffResultSchema,
  TripIdSchema,
  TripPlanGenerationResultSchema,
  TripPlanSchema,
  TripPlanVersionListResultSchema,
  WeatherResultSchema,
  MAX_TRIP_PLAN_VERSIONS,
  MAX_TRIP_PLAN_ITEM_REPLACEMENT_CANDIDATES,
} from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  EditTripPlanInput,
  EditTripPlanResult,
  EstimateRouteInput,
  EstimateRouteOrderInput,
  GetWeatherInput,
  GenerateTripPlanInput,
  RegenerateTripPlanDayInput,
  RegenerateTripPlanDayResult,
  RestoreTripPlanVersionInput,
  RestoreTripPlanVersionResult,
  TripPlanVersionDiffInput,
  TripPlanVersionDiffResult,
  PlaceCategory,
  PlaceListResult,
  SearchPlacesInput,
  TripPlan,
  TripPlanGenerationResult,
  TripPlanVersionListResult,
  RouteEstimate,
  RouteOrderResult,
  WeatherResult,
  TripPlanItemReplacementCandidateList,
  ListTripPlanItemReplacementCandidatesInput,
  ReplaceTripPlanItemInput,
  ReplaceTripPlanItemResult,
  ReorderTripPlanItemsInput,
  ReorderTripPlanItemsResult,
  Place,
  TripPlanItem,
} from '@travel-guide/shared-types';

import { PlaceService } from '../places/place.service';
import { RouteOrderService } from '../routes/route-order.service';
import { RouteService } from '../routes/route.service';
import { WeatherService } from '../weather/weather.service';
import { TRIP_REPOSITORY } from '../trips/trip.tokens';
import type { TripRecord, TripRepository } from '../trips/repositories/trip.repository';
import { TripPlanException } from './trip-plan.errors';
import { TripPlanGenerationContextSchema } from './trip-plan-generation.schema';
import type { TripPlanGenerationContext } from './trip-plan-generation.types';
import { TripPlanDayRegenerationContextSchema } from './trip-plan-day-regeneration.schema';
import type { TripPlanDayRegenerationContext } from './trip-plan-day-regeneration.types';
import { TripPlanGenerationService } from './trip-plan-generation.service';
import { applyTripPlanEdits, TripPlanEditError } from './trip-plan-edit';
import { reorderTripPlanDayItems, TripPlanReorderError } from './trip-plan-reorder';
import {
  compareTripPlanVersions,
  TripPlanDiffValidationError,
  withTripPlanVersionDiffVersions,
} from './trip-plan-diff';
import { TRIP_PLAN_CLOCK, TRIP_PLAN_REPOSITORY } from './trip-plan.tokens';
import { systemTripPlanClock, type TripPlanClock } from './trip-plan.clock';
import {
  tripPlanVersionSummary,
  type TripPlanGenerationReservation,
  type TripPlanRepository,
  type TripPlanVersionRecord,
  type TripPlanRestoreReservationResult,
  type TripPlanEditReservationResult,
} from './repositories/trip-plan.repository';

export interface TripPlanGenerator {
  generate(context: TripPlanGenerationContext): Promise<TripPlan>;
  regenerateDay?(context: TripPlanDayRegenerationContext): Promise<TripPlan['days'][number]>;
  generateDay?(context: TripPlanDayRegenerationContext): Promise<TripPlan['days'][number]>;
}

export interface TripPlanWeatherReader {
  getWeather(input: GetWeatherInput): Promise<WeatherResult>;
}

export interface TripPlanPlaceReader {
  searchPlaces(input: SearchPlacesInput): Promise<PlaceListResult>;
}

export interface TripPlanRouteReader {
  estimateRoute(input: EstimateRouteInput): Promise<RouteEstimate>;
}

export interface TripPlanRouteOrderReader {
  estimateRouteOrder(input: EstimateRouteOrderInput): Promise<RouteOrderResult>;
}

const validationError = (): TripPlanException =>
  new TripPlanException('TRIP_PLAN_VALIDATION_ERROR', 400, 'The TripPlan request is invalid');

const tripNotFoundError = (): TripPlanException =>
  new TripPlanException('TRIP_NOT_FOUND', 404, 'The requested trip was not found');

const planNotFoundError = (): TripPlanException =>
  new TripPlanException('TRIP_PLAN_NOT_FOUND', 404, 'The requested TripPlan was not found');

const dayNotFoundError = (): TripPlanException =>
  new TripPlanException('TRIP_PLAN_DAY_NOT_FOUND', 404, 'The requested TripPlan day was not found');

const entityMismatchError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_ENTITY_MISMATCH',
    422,
    'The requested TripPlan entity does not belong to the source snapshot',
  );

const inProgressError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_GENERATION_IN_PROGRESS',
    409,
    'TripPlan generation is already in progress',
  );

const providerError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_PROVIDER_ERROR',
    502,
    'TripPlan generation is temporarily unavailable',
  );

const persistenceError = (): TripPlanException =>
  new TripPlanException('TRIP_PLAN_PERSISTENCE_ERROR', 500, 'TripPlan data could not be persisted');

const unavailableError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_UNAVAILABLE',
    422,
    'There is not enough verified data to generate a TripPlan',
  );

const replacementUnavailableError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_REPLACEMENT_UNAVAILABLE',
    422,
    'A real route for the replacement is unavailable',
  );

const reorderUnavailableError = (): TripPlanException =>
  new TripPlanException(
    'TRIP_PLAN_REORDER_UNAVAILABLE',
    422,
    'A real route for the reordered timeline is unavailable',
  );

const MAX_REPLACEMENT_CANDIDATE_PAGES = 50;

const asCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const mapEditError = (error: unknown): TripPlanException => {
  if (error instanceof TripPlanException) return error;
  if (error instanceof TripPlanEditError) {
    if (error.code === 'TRIP_PLAN_ENTITY_MISMATCH') return entityMismatchError();
    return validationError();
  }
  return persistenceError();
};

const mapReorderError = (error: unknown): TripPlanException => {
  if (error instanceof TripPlanException) return error;
  if (error instanceof TripPlanReorderError) {
    if (error.code === 'TRIP_PLAN_ENTITY_MISMATCH') return entityMismatchError();
    if (error.code === 'TRIP_PLAN_REORDER_UNAVAILABLE') return reorderUnavailableError();
    return validationError();
  }
  return persistenceError();
};

const preferenceCategories = (input: CreateTripInput): PlaceCategory[] => {
  const categories = new Set<PlaceCategory>(['attraction', 'museum', 'park', 'restaurant', 'cafe']);
  for (const preference of input.preferences) {
    if (preference === 'food') categories.add('local_food');
    if (preference === 'shopping') categories.add('shopping');
    if (preference === 'nightlife') categories.add('nightlife');
    if (preference === 'history') categories.add('museum');
    if (preference === 'nature' || preference === 'hiking') categories.add('park');
  }
  return [...categories];
};

const replacementCategories = (type: TripPlanItem['type']): PlaceCategory[] => {
  switch (type) {
    case 'attraction':
      return ['attraction', 'museum', 'park'];
    case 'food':
      return ['restaurant', 'local_food', 'cafe'];
    case 'hotel':
      return ['hotel_area'];
    default:
      return [];
  }
};

const isReplacementItemType = (
  item: TripPlanItem,
): item is TripPlanItem & { type: 'attraction' | 'food' | 'hotel'; place: Place } =>
  (item.type === 'attraction' || item.type === 'food' || item.type === 'hotel') &&
  item.place !== undefined;

const hasUsablePlaceLocation = (place: Place): boolean =>
  typeof place.location === 'object' &&
  place.location !== null &&
  Number.isFinite(place.location.longitude) &&
  Number.isFinite(place.location.latitude);

const itemById = (
  plan: TripPlan,
  itemId: string,
  dayNumber?: number,
): { day: TripPlan['days'][number]; item: TripPlanItem; index: number } | undefined => {
  for (const day of plan.days) {
    if (dayNumber !== undefined && day.dayNumber !== dayNumber) continue;
    const index = day.items.findIndex((item) => item.id === itemId);
    if (index >= 0) {
      const item = day.items[index];
      if (item !== undefined) return { day, item, index };
    }
  }
  return undefined;
};

const generationResult = (record: TripPlanVersionRecord): TripPlanGenerationResult => {
  const summary = tripPlanVersionSummary(record);
  return {
    version: record.version,
    status: record.status,
    tripId: record.tripId,
    ...(record.plan === undefined ? {} : { plan: record.plan }),
    summary,
  };
};

const dayRegenerationResult = (
  record: TripPlanVersionRecord,
  sourceVersion: number,
  dayNumber: number,
): RegenerateTripPlanDayResult => ({
  ...generationResult(record),
  sourceVersion,
  dayNumber,
});

const editResult = (record: TripPlanVersionRecord, sourceVersion: number): EditTripPlanResult => {
  if (record.status !== 'ready' || record.plan === undefined) {
    throw persistenceError();
  }
  return {
    tripId: record.tripId,
    sourceVersion,
    version: record.version,
    status: 'ready',
    plan: record.plan,
    summary: tripPlanVersionSummary(record),
  };
};

const budgetCategoryForItem: Record<
  TripPlan['days'][number]['items'][number]['type'],
  'accommodationCny' | 'transportationCny' | 'foodCny' | 'attractionsCny' | 'otherCny'
> = {
  attraction: 'attractionsCny',
  food: 'foodCny',
  transport: 'transportationCny',
  hotel: 'accommodationCny',
  rest: 'otherCny',
};

const recomputePlanBudget = (plan: TripPlan, generatedAt: string): TripPlan => {
  const categoryCents = {
    accommodationCny: 0,
    transportationCny: 0,
    foodCny: 0,
    attractionsCny: 0,
    otherCny: 0,
  };
  const days = plan.days.map((day) => {
    const estimatedCostCents = day.items.reduce(
      (total, item) => total + Math.round(item.estimatedCostCny * 100),
      0,
    );
    day.items.forEach((item) => {
      categoryCents[budgetCategoryForItem[item.type]] += Math.round(item.estimatedCostCny * 100);
    });
    return {
      ...day,
      estimatedCostCny: estimatedCostCents / 100,
    };
  });
  const totalCents = Object.values(categoryCents).reduce((total, value) => total + value, 0);
  return {
    ...plan,
    days,
    budget: {
      currency: 'CNY',
      totalCny: totalCents / 100,
      accommodationCny: categoryCents.accommodationCny / 100,
      transportationCny: categoryCents.transportationCny / 100,
      foodCny: categoryCents.foodCny / 100,
      attractionsCny: categoryCents.attractionsCny / 100,
      otherCny: categoryCents.otherCny / 100,
    },
    generatedAt,
  };
};

const timeToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (value: number): string => {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const reorderTimelineWithRoutes = (
  plan: TripPlan,
  dayNumber: number,
  routeMap: ReadonlyMap<string, RouteEstimate>,
  generatedAt: string,
): TripPlan => {
  const dayIndex = plan.days.findIndex((day) => day.dayNumber === dayNumber);
  if (dayIndex < 0) throw entityMismatchError();
  const sourceDay = plan.days[dayIndex]!;
  const earliestStart = Math.min(...sourceDay.items.map((item) => timeToMinutes(item.startTime)));
  let cursor = earliestStart;
  let previous: TripPlan['days'][number]['items'][number] | undefined;
  const items = sourceDay.items.map((item) => {
    const duration = timeToMinutes(item.endTime) - timeToMinutes(item.startTime);
    if (duration <= 0) {
      throw validationError();
    }
    const routeKey =
      previous?.place === undefined || item.place === undefined
        ? undefined
        : `place:${previous.place.id}->place:${item.place.id}`;
    const route = routeKey === undefined ? undefined : routeMap.get(routeKey);
    if (routeKey !== undefined && route === undefined) throw reorderUnavailableError();
    const travelMinutes =
      route === undefined || route.dataSource === 'unavailable'
        ? 0
        : Math.ceil(route.durationSeconds / 60);
    const start = cursor + travelMinutes;
    const end = start + duration;
    if (start < 0 || end > 24 * 60 || end <= start) throw validationError();
    cursor = end;
    previous = item;
    const dataSources = route
      ? item.dataSources.includes('route_provider')
        ? [...item.dataSources]
        : [...item.dataSources, 'route_provider' as const]
      : item.dataSources.filter((source) => source !== 'route_provider');
    return {
      ...item,
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
      ...(route === undefined ? { route: undefined } : { route }),
      dataSources,
    };
  });
  const nextPlan = {
    ...plan,
    generatedAt,
    days: plan.days.map((day, index) => (index === dayIndex ? { ...day, items } : day)),
  };
  const validated = TripPlanSchema.safeParse(nextPlan);
  if (!validated.success) throw validationError();
  return validated.data;
};

const mapContextError = (error: unknown): TripPlanException => {
  if (error instanceof TripPlanException) return error;
  const code = asCode(error);
  if (code === 'PLACE_VALIDATION_ERROR' || code === 'WEATHER_VALIDATION_ERROR') {
    return validationError();
  }
  if (code === 'WEATHER_PERSISTENCE_ERROR' || code === 'PLACE_PERSISTENCE_ERROR') {
    return persistenceError();
  }
  if (
    code === 'WEATHER_PROVIDER_ERROR' ||
    code === 'ROUTE_PROVIDER_ERROR' ||
    code === 'ROUTE_MATRIX_PROVIDER_ERROR' ||
    code === 'ROUTE_ORDER_PROVIDER_ERROR' ||
    code === 'PLACE_PROVIDER_ERROR'
  ) {
    return providerError();
  }
  if (
    code === 'ROUTE_ORDER_UNAVAILABLE' ||
    code === 'ROUTE_MATRIX_UNAVAILABLE' ||
    code === 'ROUTE_UNAVAILABLE'
  ) {
    return unavailableError();
  }
  return providerError();
};

@Injectable()
export class TripPlanService {
  public constructor(
    @Inject(TRIP_REPOSITORY) private readonly tripRepository: TripRepository,
    @Inject(TRIP_PLAN_REPOSITORY) private readonly repository: TripPlanRepository,
    @Inject(TripPlanGenerationService)
    private readonly generationService: TripPlanGenerator,
    @Inject(WeatherService) private readonly weatherService: TripPlanWeatherReader,
    @Inject(PlaceService) private readonly placeService: TripPlanPlaceReader,
    @Inject(RouteService) private readonly routeService: TripPlanRouteReader,
    @Inject(RouteOrderService) private readonly routeOrderService: TripPlanRouteOrderReader,
    @Inject(TRIP_PLAN_CLOCK) private readonly clock: TripPlanClock = systemTripPlanClock,
  ) {}

  public async generate(
    userId: string,
    tripId: string,
    input: GenerateTripPlanInput = {},
  ): Promise<TripPlanGenerationResult> {
    this.assertTripId(tripId);
    const parsedInput = GenerateTripPlanInputSchema.safeParse(input);
    if (!parsedInput.success) throw validationError();
    const now = this.clock.now();
    if (Number.isNaN(now.getTime())) throw validationError();

    // Resolve ownership before touching the version repository so missing and cross-user
    // trips are indistinguishable even when the persistence adapter is not configured.
    try {
      const trip = await this.tripRepository.findByIdForUser(userId, tripId);
      if (trip === undefined) throw tripNotFoundError();
    } catch (error: unknown) {
      if (error instanceof TripPlanException) throw error;
      throw persistenceError();
    }

    let reserved: Awaited<ReturnType<TripPlanRepository['reserveGeneration']>>;
    try {
      reserved = await this.repository.reserveGeneration(userId, tripId, now);
    } catch (error: unknown) {
      throw error instanceof TripPlanException ? error : persistenceError();
    }
    if (reserved.status === 'not_found') throw tripNotFoundError();
    if (reserved.status === 'in_progress') throw inProgressError();
    const reservation: TripPlanGenerationReservation = reserved.reservation;

    try {
      const context = await this.buildContext(reservation, now.toISOString());
      const contextValidation = TripPlanGenerationContextSchema.safeParse(context);
      if (!contextValidation.success) throw validationError();
      const plan = await this.generationService.generate(contextValidation.data);
      const validatedPlan = TripPlanSchema.safeParse(plan);
      if (!validatedPlan.success)
        throw new TripPlanException(
          'TRIP_PLAN_OUTPUT_INVALID',
          502,
          'The generated TripPlan is invalid',
        );

      let saved: TripPlanVersionRecord;
      try {
        saved = await this.repository.saveReady(
          userId,
          tripId,
          reservation,
          validatedPlan.data,
          new Date(validatedPlan.data.generatedAt),
        );
      } catch {
        throw persistenceError();
      }
      return generationResult(saved);
    } catch (error: unknown) {
      const mapped = error instanceof TripPlanException ? error : mapContextError(error);
      try {
        const failedAt = this.clock.now();
        if (Number.isNaN(failedAt.getTime())) throw persistenceError();
        await this.repository.markFailed(userId, tripId, reservation, failedAt);
      } catch {
        throw persistenceError();
      }
      throw mapped;
    }
  }

  public async regenerateDay(
    userId: string,
    tripId: string,
    input: RegenerateTripPlanDayInput,
  ): Promise<RegenerateTripPlanDayResult> {
    this.assertTripId(tripId);
    const parsedInput = RegenerateTripPlanDayInputSchema.safeParse(input);
    if (!parsedInput.success) throw validationError();
    const now = this.clock.now();
    if (Number.isNaN(now.getTime())) throw validationError();

    let trip: TripRecord;
    try {
      const found = await this.tripRepository.findByIdForUser(userId, tripId);
      if (found === undefined) throw tripNotFoundError();
      trip = found;
    } catch (error: unknown) {
      if (error instanceof TripPlanException) throw error;
      throw persistenceError();
    }

    let sourceRecord: TripPlanVersionRecord | undefined;
    try {
      sourceRecord = await this.repository.findVersionForUser(
        userId,
        tripId,
        parsedInput.data.sourceVersion,
      );
    } catch {
      throw persistenceError();
    }
    if (
      sourceRecord === undefined ||
      sourceRecord.status !== 'ready' ||
      sourceRecord.plan === undefined
    ) {
      if (trip.status === 'generating') throw inProgressError();
      throw planNotFoundError();
    }
    const sourcePlan = TripPlanSchema.safeParse(sourceRecord.plan);
    if (!sourcePlan.success) throw persistenceError();
    const sourceDay = sourcePlan.data.days.find(
      (day) => day.dayNumber === parsedInput.data.dayNumber,
    );
    if (sourceDay === undefined) throw dayNotFoundError();

    let reserved: Awaited<ReturnType<NonNullable<TripPlanRepository['reserveDayRegeneration']>>>;
    try {
      if (this.repository.reserveDayRegeneration !== undefined) {
        reserved = await this.repository.reserveDayRegeneration(
          userId,
          tripId,
          parsedInput.data.sourceVersion,
          parsedInput.data.dayNumber,
          parsedInput.data.instruction,
          now,
        );
      } else {
        const fallback = await this.repository.reserveGeneration(userId, tripId, now);
        reserved =
          fallback.status === 'reserved'
            ? {
                status: 'reserved',
                reservation: {
                  ...fallback.reservation,
                  operation: 'regenerate-day',
                  sourceVersion: parsedInput.data.sourceVersion,
                  dayNumber: parsedInput.data.dayNumber,
                  ...(parsedInput.data.instruction === undefined
                    ? {}
                    : { instruction: parsedInput.data.instruction }),
                },
              }
            : fallback;
      }
    } catch {
      throw persistenceError();
    }
    if (reserved.status === 'not_found') throw tripNotFoundError();
    if (reserved.status === 'in_progress') throw inProgressError();
    if (reserved.status === 'source_not_ready') throw planNotFoundError();
    if (reserved.status === 'day_not_found') throw dayNotFoundError();
    const reservation = reserved.reservation;

    try {
      const contextParts = await this.buildContext(reservation, now.toISOString());
      const context: TripPlanDayRegenerationContext = {
        tripId,
        input: CreateTripInputSchema.parse(reservation.input),
        sourceVersion: parsedInput.data.sourceVersion,
        sourcePlan: sourcePlan.data,
        dayNumber: parsedInput.data.dayNumber,
        targetDay: sourceDay,
        adjacentDays: sourcePlan.data.days
          .filter(
            (day) =>
              day.dayNumber === parsedInput.data.dayNumber - 1 ||
              day.dayNumber === parsedInput.data.dayNumber + 1,
          )
          .sort((left, right) => left.dayNumber - right.dayNumber),
        ...(parsedInput.data.instruction === undefined
          ? {}
          : { instruction: parsedInput.data.instruction }),
        weather: contextParts.weather,
        candidatePlaces: contextParts.candidatePlaces,
        routeEstimates: contextParts.routeEstimates,
        ...(contextParts.routeOrders === undefined
          ? {}
          : { routeOrders: contextParts.routeOrders }),
        generatedAt: now.toISOString(),
      };
      const contextValidation = TripPlanDayRegenerationContextSchema.safeParse(context);
      if (!contextValidation.success) throw validationError();

      let regeneratedDay: TripPlan['days'][number];
      if (this.generationService.regenerateDay !== undefined) {
        regeneratedDay = await this.generationService.regenerateDay(contextValidation.data);
      } else if (this.generationService.generateDay !== undefined) {
        regeneratedDay = await this.generationService.generateDay(contextValidation.data);
      } else {
        const generatedPlan = await this.generationService.generate(contextParts);
        const generatedTarget = generatedPlan.days.find(
          (day) => day.dayNumber === parsedInput.data.dayNumber,
        );
        if (generatedTarget === undefined) {
          throw new TripPlanException(
            'TRIP_PLAN_OUTPUT_INVALID',
            502,
            'The generated TripPlan is invalid',
          );
        }
        regeneratedDay = generatedTarget;
      }

      const mergedPlan = recomputePlanBudget(
        {
          ...sourcePlan.data,
          days: sourcePlan.data.days.map((day) =>
            day.dayNumber === parsedInput.data.dayNumber ? regeneratedDay : day,
          ),
        },
        now.toISOString(),
      );
      const validatedPlan = TripPlanSchema.safeParse(mergedPlan);
      if (!validatedPlan.success) {
        throw new TripPlanException(
          'TRIP_PLAN_OUTPUT_INVALID',
          502,
          'The generated TripPlan is invalid',
        );
      }

      let saved: TripPlanVersionRecord;
      try {
        saved = await this.repository.saveReady(
          userId,
          tripId,
          reservation,
          validatedPlan.data,
          new Date(validatedPlan.data.generatedAt),
        );
      } catch {
        throw persistenceError();
      }
      const result = dayRegenerationResult(
        saved,
        parsedInput.data.sourceVersion,
        parsedInput.data.dayNumber,
      );
      const validatedResult = RegenerateTripPlanDayResultSchema.safeParse(result);
      if (!validatedResult.success) throw persistenceError();
      return validatedResult.data;
    } catch (error: unknown) {
      const mapped = error instanceof TripPlanException ? error : mapContextError(error);
      try {
        const failedAt = this.clock.now();
        if (Number.isNaN(failedAt.getTime())) throw persistenceError();
        await this.repository.markFailed(userId, tripId, reservation, failedAt);
      } catch {
        throw persistenceError();
      }
      throw mapped;
    }
  }

  /** List only server-verified POIs that may replace one concrete itinerary place. */
  public async listReplacementCandidates(
    userId: string,
    tripId: string,
    version: number,
    input: ListTripPlanItemReplacementCandidatesInput,
  ): Promise<TripPlanItemReplacementCandidateList> {
    this.assertTripId(tripId);
    const parsedInput = ListTripPlanItemReplacementCandidatesInputSchema.safeParse(input);
    if (!parsedInput.success) throw validationError();
    if (parsedInput.data.sourceVersion !== version) throw validationError();
    const trip = await this.requireTripForVersionOperation(userId, tripId);
    if (trip.status === 'generating') throw inProgressError();

    let sourceRecord: TripPlanVersionRecord | undefined;
    try {
      sourceRecord = await this.repository.findVersionForUser(
        userId,
        tripId,
        parsedInput.data.sourceVersion,
      );
    } catch {
      throw persistenceError();
    }
    if (
      sourceRecord === undefined ||
      sourceRecord.status !== 'ready' ||
      sourceRecord.plan === undefined
    ) {
      throw planNotFoundError();
    }
    const sourcePlan = TripPlanSchema.safeParse(sourceRecord.plan);
    if (!sourcePlan.success || sourcePlan.data.tripId !== tripId) throw persistenceError();
    const located = itemById(sourcePlan.data, parsedInput.data.itemId, parsedInput.data.dayNumber);
    if (located === undefined || !isReplacementItemType(located.item)) {
      throw entityMismatchError();
    }

    const categories = replacementCategories(located.item.type);
    if (categories.length === 0) throw entityMismatchError();
    let places: PlaceListResult;
    try {
      const fetched = await this.placeService.searchPlaces({
        cityName: sourcePlan.data.cityName,
        ...(trip.inputSnapshot.destination.cityCode === undefined
          ? {}
          : { cityCode: trip.inputSnapshot.destination.cityCode }),
        categories,
        page: parsedInput.data.page ?? 1,
        pageSize: parsedInput.data.pageSize ?? MAX_TRIP_PLAN_ITEM_REPLACEMENT_CANDIDATES,
      });
      const parsed = PlaceListResultSchema.safeParse(fetched);
      if (parsed.success) {
        places = parsed.data;
      } else {
        // Keep the replacement boundary defensive even when a fake/legacy adapter
        // returns a partially malformed list: invalid or coordinate-less POIs are skipped.
        const rawItems =
          typeof fetched === 'object' && fetched !== null && 'items' in fetched
            ? (fetched as { items?: unknown }).items
            : undefined;
        const validItems = Array.isArray(rawItems)
          ? rawItems.flatMap((item) => {
              const valid = PlaceSchema.safeParse(item);
              return valid.success ? [valid.data] : [];
            })
          : [];
        places = {
          items: validItems,
          pagination: {
            page: parsedInput.data.page ?? 1,
            pageSize: parsedInput.data.pageSize ?? MAX_TRIP_PLAN_ITEM_REPLACEMENT_CANDIDATES,
            total: validItems.length,
            totalPages:
              validItems.length === 0
                ? 0
                : Math.ceil(
                    validItems.length /
                      (parsedInput.data.pageSize ?? MAX_TRIP_PLAN_ITEM_REPLACEMENT_CANDIDATES),
                  ),
          },
          fetchedAt: sourceRecord.createdAt.toISOString(),
        };
      }
    } catch (error: unknown) {
      throw mapContextError(error);
    }

    const seen = new Set<string>();
    const original = located.item.place;
    const existingPlaceKeys = new Set<string>();
    for (const day of sourcePlan.data.days) {
      for (const item of day.items) {
        if (item.place !== undefined) {
          existingPlaceKeys.add(item.place.id);
          existingPlaceKeys.add(`${item.place.provider}\u0000${item.place.providerPlaceId}`);
        }
      }
    }
    const candidates = places.items
      .filter((place) => hasUsablePlaceLocation(place))
      .filter((place) => place.category === undefined || categories.includes(place.category))
      .filter(
        (place) =>
          place.id !== original.id &&
          place.providerPlaceId !== original.providerPlaceId &&
          !existingPlaceKeys.has(place.id) &&
          !existingPlaceKeys.has(`${place.provider}\u0000${place.providerPlaceId}`),
      )
      .filter((place) => {
        const key = `${place.provider}\u0000${place.providerPlaceId}`;
        if (seen.has(key) || seen.has(place.id)) return false;
        seen.add(key);
        seen.add(place.id);
        return true;
      })
      .slice(0, MAX_TRIP_PLAN_ITEM_REPLACEMENT_CANDIDATES)
      .map((place) => ({
        place,
        recommendationReason: `与原地点同属${place.categoryText}，且已通过地点数据校验`,
      }));
    const result: TripPlanItemReplacementCandidateList = {
      items: candidates,
      pagination: places.pagination,
    };
    const validated = TripPlanItemReplacementCandidateListSchema.safeParse(result);
    if (!validated.success) throw persistenceError();
    return validated.data;
  }

  /** Replace one verified POI and materialise a new immutable version without invoking LLM. */
  public async replaceTripPlanItem(
    userId: string,
    tripId: string,
    version: number,
    input: ReplaceTripPlanItemInput,
  ): Promise<ReplaceTripPlanItemResult> {
    this.assertTripId(tripId);
    const parsedInput = ReplaceTripPlanItemInputSchema.safeParse(input);
    if (!parsedInput.success || parsedInput.data.sourceVersion !== version) {
      throw validationError();
    }
    const now = this.clock.now();
    if (Number.isNaN(now.getTime())) throw validationError();
    const trip = await this.requireTripForVersionOperation(userId, tripId);
    if (trip.status === 'generating') throw inProgressError();

    let sourceRecord: TripPlanVersionRecord | undefined;
    try {
      sourceRecord = await this.repository.findVersionForUser(
        userId,
        tripId,
        parsedInput.data.sourceVersion,
      );
    } catch {
      throw persistenceError();
    }
    if (
      sourceRecord === undefined ||
      sourceRecord.status !== 'ready' ||
      sourceRecord.plan === undefined
    ) {
      throw planNotFoundError();
    }
    const sourcePlan = TripPlanSchema.safeParse(sourceRecord.plan);
    if (!sourcePlan.success || sourcePlan.data.tripId !== tripId) throw persistenceError();
    const located = itemById(sourcePlan.data, parsedInput.data.itemId, parsedInput.data.dayNumber);
    if (located === undefined || !isReplacementItemType(located.item)) {
      throw entityMismatchError();
    }

    // Re-read candidates at mutation time. The submitted ID is accepted only when it
    // belongs to this server-generated, schema-validated allowlist.
    const candidateInput = {
      sourceVersion: parsedInput.data.sourceVersion,
      dayNumber: parsedInput.data.dayNumber,
      itemId: parsedInput.data.itemId,
      page: 1,
      pageSize: MAX_TRIP_PLAN_ITEM_REPLACEMENT_CANDIDATES,
    };
    let candidateList = await this.listReplacementCandidates(
      userId,
      tripId,
      parsedInput.data.sourceVersion,
      candidateInput,
    );
    let candidate = candidateList.items.find(
      (item) => item.place.id === parsedInput.data.replacementPlaceId,
    );
    const lastPage = Math.min(candidateList.pagination.totalPages, MAX_REPLACEMENT_CANDIDATE_PAGES);
    for (let page = 2; candidate === undefined && page <= lastPage; page += 1) {
      candidateList = await this.listReplacementCandidates(userId, tripId, version, {
        ...candidateInput,
        page,
      });
      candidate = candidateList.items.find(
        (item) => item.place.id === parsedInput.data.replacementPlaceId,
      );
    }
    if (candidate === undefined) throw entityMismatchError();

    const replacementPlace = candidate.place;
    const mode = trip.inputSnapshot.transportPreference === 'driving' ? 'driving' : 'walking';
    const dayItems = located.day.items;
    const previous = located.index > 0 ? dayItems[located.index - 1] : undefined;
    const next = located.index + 1 < dayItems.length ? dayItems[located.index + 1] : undefined;
    const routeFor = async (
      origin: Place | undefined,
      destination: Place | undefined,
    ): Promise<RouteEstimate | undefined> => {
      if (origin === undefined || destination === undefined) return undefined;
      try {
        const estimate = await this.routeService.estimateRoute({
          origin: { location: origin.location, placeId: origin.id },
          destination: { location: destination.location, placeId: destination.id },
          mode,
        });
        if (estimate.dataSource === 'unavailable') throw replacementUnavailableError();
        return estimate;
      } catch (error: unknown) {
        if (error instanceof TripPlanException) throw error;
        if (asCode(error) === 'ROUTE_UNAVAILABLE') throw replacementUnavailableError();
        throw mapContextError(error);
      }
    };

    let reserved: TripPlanEditReservationResult;
    try {
      if (this.repository.reserveReplaceItem !== undefined) {
        reserved = await this.repository.reserveReplaceItem(
          userId,
          tripId,
          parsedInput.data.sourceVersion,
          parsedInput.data.itemId,
          now,
        );
      } else if (this.repository.reserveItemReplacement !== undefined) {
        reserved = await this.repository.reserveItemReplacement(
          userId,
          tripId,
          parsedInput.data.sourceVersion,
          parsedInput.data.itemId,
          now,
        );
      } else {
        const fallback = await this.repository.reserveGeneration(userId, tripId, now);
        reserved =
          fallback.status === 'reserved'
            ? {
                status: 'reserved',
                reservation: {
                  ...fallback.reservation,
                  operation: 'replace-item' as const,
                  sourceVersion: parsedInput.data.sourceVersion,
                  itemId: parsedInput.data.itemId,
                  previousTripStatus: fallback.reservation.previousTripStatus ?? trip.status,
                },
              }
            : fallback;
      }
    } catch {
      throw persistenceError();
    }
    if (reserved.status === 'not_found') throw tripNotFoundError();
    if (reserved.status === 'in_progress') throw inProgressError();
    if (reserved.status === 'source_not_ready') throw planNotFoundError();
    const reservation = {
      ...reserved.reservation,
      operation: 'replace-item' as const,
      sourceVersion: parsedInput.data.sourceVersion,
      itemId: parsedInput.data.itemId,
      previousTripStatus: reserved.reservation.previousTripStatus ?? trip.status,
    };

    try {
      const replacementItem: TripPlanItem = {
        ...located.item,
        name: replacementPlace.name,
        place: replacementPlace,
      };
      const beforeRoute = await routeFor(previous?.place, replacementPlace);
      const afterRoute = await routeFor(replacementPlace, next?.place);
      const replacedDays = sourcePlan.data.days.map((day) => {
        if (day.dayNumber !== located.day.dayNumber) return day;
        return {
          ...day,
          items: day.items.map((item, index) => {
            if (index === located.index) {
              return {
                ...replacementItem,
                ...(beforeRoute === undefined ? { route: undefined } : { route: beforeRoute }),
              };
            }
            if (index === located.index + 1 && next !== undefined) {
              return {
                ...item,
                ...(afterRoute === undefined ? { route: undefined } : { route: afterRoute }),
              };
            }
            return item;
          }),
        };
      });
      const replacedPlan = TripPlanSchema.parse({
        ...sourcePlan.data,
        days: replacedDays,
        generatedAt: now.toISOString(),
      });
      let saved: TripPlanVersionRecord;
      try {
        saved = await this.repository.saveReady(userId, tripId, reservation, replacedPlan, now);
      } catch {
        throw persistenceError();
      }
      const result: ReplaceTripPlanItemResult = {
        tripId,
        sourceVersion: parsedInput.data.sourceVersion,
        dayNumber: parsedInput.data.dayNumber,
        itemId: parsedInput.data.itemId,
        version: saved.version,
        status: 'ready',
        plan: replacedPlan,
        summary: tripPlanVersionSummary(saved),
      };
      const validated = ReplaceTripPlanItemResultSchema.safeParse(result);
      if (!validated.success) throw persistenceError();
      return validated.data;
    } catch (error: unknown) {
      const mapped = error instanceof TripPlanException ? error : mapContextError(error);
      try {
        const failedAt = this.clock.now();
        if (Number.isNaN(failedAt.getTime())) throw persistenceError();
        await this.repository.markFailed(userId, tripId, reservation, failedAt);
      } catch {
        throw persistenceError();
      }
      throw mapped;
    }
  }

  /** Reorder one day's complete timeline using fresh real-route durations. */
  public async reorderTripPlanItems(
    userId: string,
    tripId: string,
    version: number,
    input: ReorderTripPlanItemsInput,
  ): Promise<ReorderTripPlanItemsResult> {
    this.assertTripId(tripId);
    const parsedInput = ReorderTripPlanItemsInputSchema.safeParse(input);
    if (!parsedInput.success || parsedInput.data.sourceVersion !== version) {
      throw validationError();
    }
    const now = this.clock.now();
    if (Number.isNaN(now.getTime())) throw validationError();

    const trip = await this.requireTripForVersionOperation(userId, tripId);
    if (trip.status === 'generating') throw inProgressError();

    let sourceRecord: TripPlanVersionRecord | undefined;
    try {
      sourceRecord = await this.repository.findVersionForUser(userId, tripId, version);
    } catch {
      throw persistenceError();
    }
    if (
      sourceRecord === undefined ||
      sourceRecord.status !== 'ready' ||
      sourceRecord.plan === undefined
    ) {
      throw planNotFoundError();
    }
    const sourcePlan = TripPlanSchema.safeParse(sourceRecord.plan);
    if (!sourcePlan.success || sourcePlan.data.tripId !== tripId) throw persistenceError();

    const generatedAt = now.toISOString();
    let validationPlan: TripPlan;
    try {
      // Validate entities and no-op before creating a failed reservation record.
      validationPlan = reorderTripPlanDayItems(sourcePlan.data, parsedInput.data, generatedAt);
    } catch (error: unknown) {
      throw mapReorderError(error);
    }
    const targetDay = sourcePlan.data.days.find(
      (candidate) => candidate.dayNumber === parsedInput.data.dayNumber,
    );
    if (targetDay === undefined) throw entityMismatchError();
    const orderedItems = validationPlan.days.find(
      (candidate) => candidate.dayNumber === parsedInput.data.dayNumber,
    )?.items;
    if (orderedItems === undefined) throw entityMismatchError();

    let reserved: TripPlanEditReservationResult;
    try {
      if (this.repository.reserveReorderItems !== undefined) {
        reserved = await this.repository.reserveReorderItems(
          userId,
          tripId,
          version,
          parsedInput.data.dayNumber,
          parsedInput.data.orderedItemIds,
          now,
        );
      } else {
        const fallback = await this.repository.reserveGeneration(userId, tripId, now);
        reserved =
          fallback.status === 'reserved'
            ? {
                status: 'reserved',
                reservation: {
                  ...fallback.reservation,
                  operation: 'reorder-items' as const,
                  sourceVersion: version,
                  dayNumber: parsedInput.data.dayNumber,
                  orderedItemIds: [...parsedInput.data.orderedItemIds],
                  previousTripStatus: fallback.reservation.previousTripStatus ?? trip.status,
                },
              }
            : fallback;
      }
    } catch {
      throw persistenceError();
    }
    if (reserved.status === 'not_found') throw tripNotFoundError();
    if (reserved.status === 'in_progress') throw inProgressError();
    if (reserved.status === 'source_not_ready') throw planNotFoundError();
    const reservation = {
      ...reserved.reservation,
      operation: 'reorder-items' as const,
      sourceVersion: version,
      dayNumber: parsedInput.data.dayNumber,
      orderedItemIds: [...parsedInput.data.orderedItemIds],
      previousTripStatus: reserved.reservation.previousTripStatus ?? trip.status,
    };

    try {
      const mode = trip.inputSnapshot.transportPreference === 'driving' ? 'driving' : 'walking';
      const routeMap = new Map<string, RouteEstimate>();
      for (let index = 1; index < orderedItems.length; index += 1) {
        const origin = orderedItems[index - 1]?.place;
        const destination = orderedItems[index]?.place;
        if (origin === undefined || destination === undefined) continue;
        try {
          const estimate = await this.routeService.estimateRoute({
            origin: { location: origin.location, placeId: origin.id },
            destination: { location: destination.location, placeId: destination.id },
            mode,
          });
          if (estimate.dataSource === 'unavailable') throw reorderUnavailableError();
          routeMap.set(`place:${origin.id}->place:${destination.id}`, estimate);
        } catch (error: unknown) {
          if (error instanceof TripPlanException) throw error;
          if (asCode(error) === 'ROUTE_UNAVAILABLE') throw reorderUnavailableError();
          throw mapContextError(error);
        }
      }

      const reorderedOrder = reorderTripPlanDayItems(
        sourcePlan.data,
        parsedInput.data,
        generatedAt,
      );
      const reorderedPlan = reorderTimelineWithRoutes(
        reorderedOrder,
        parsedInput.data.dayNumber,
        routeMap,
        generatedAt,
      );
      let saved: TripPlanVersionRecord;
      try {
        saved = await this.repository.saveReady(userId, tripId, reservation, reorderedPlan, now);
      } catch {
        throw persistenceError();
      }
      const result: ReorderTripPlanItemsResult = {
        tripId,
        sourceVersion: version,
        dayNumber: parsedInput.data.dayNumber,
        version: saved.version,
        status: 'ready',
        plan: reorderedPlan,
        summary: tripPlanVersionSummary(saved),
      };
      const validated = ReorderTripPlanItemsResultSchema.safeParse(result);
      if (!validated.success) throw persistenceError();
      return validated.data;
    } catch (error: unknown) {
      const mapped = mapReorderError(error);
      try {
        const failedAt = this.clock.now();
        if (Number.isNaN(failedAt.getTime())) throw persistenceError();
        await this.repository.markFailed(userId, tripId, reservation, failedAt);
      } catch {
        throw persistenceError();
      }
      throw mapped;
    }
  }

  /** Apply a controlled edit to a ready snapshot without invoking any Provider. */
  public edit(
    userId: string,
    tripId: string,
    version: number,
    input: EditTripPlanInput,
  ): Promise<EditTripPlanResult>;
  public edit(
    userId: string,
    tripId: string,
    input: EditTripPlanInput,
  ): Promise<EditTripPlanResult>;
  public async edit(
    userId: string,
    tripId: string,
    versionOrInput: number | EditTripPlanInput,
    input?: EditTripPlanInput,
  ): Promise<EditTripPlanResult> {
    this.assertTripId(tripId);
    const urlVersion =
      typeof versionOrInput === 'number' ? versionOrInput : versionOrInput.sourceVersion;
    const parsedInput = EditTripPlanInputSchema.safeParse(
      typeof versionOrInput === 'number' ? input : versionOrInput,
    );
    if (!parsedInput.success || parsedInput.data.sourceVersion !== urlVersion) {
      throw validationError();
    }
    if (!Number.isSafeInteger(urlVersion) || urlVersion < 1 || urlVersion > 2_147_483_647) {
      throw validationError();
    }
    const now = this.clock.now();
    if (Number.isNaN(now.getTime())) throw validationError();

    const trip = await this.requireTripForVersionOperation(userId, tripId);
    if (trip.status === 'generating') throw inProgressError();

    let sourceRecord: TripPlanVersionRecord | undefined;
    try {
      sourceRecord = await this.repository.findVersionForUser(userId, tripId, urlVersion);
    } catch {
      throw persistenceError();
    }
    if (
      sourceRecord === undefined ||
      sourceRecord.status !== 'ready' ||
      sourceRecord.plan === undefined
    ) {
      throw planNotFoundError();
    }
    const sourcePlan = TripPlanSchema.safeParse(sourceRecord.plan);
    if (!sourcePlan.success) throw planNotFoundError();
    if (sourcePlan.data.tripId !== tripId) {
      throw new TripPlanException(
        'TRIP_PLAN_ENTITY_MISMATCH',
        422,
        'The TripPlan snapshot does not belong to the requested trip',
      );
    }

    const generatedAt = now.toISOString();
    let editedPlan: TripPlan;
    try {
      // Validate and materialise before reserving a version. No-op and entity errors
      // must not leave a failed generating record behind.
      editedPlan = applyTripPlanEdits(sourcePlan.data, parsedInput.data, generatedAt);
    } catch (error: unknown) {
      throw mapEditError(error);
    }

    let reserved: TripPlanEditReservationResult;
    try {
      if (this.repository.reserveEdit !== undefined) {
        reserved = await this.repository.reserveEdit(userId, tripId, urlVersion, now);
      } else {
        const fallback = await this.repository.reserveGeneration(userId, tripId, now);
        reserved =
          fallback.status === 'reserved'
            ? {
                status: 'reserved',
                reservation: {
                  ...fallback.reservation,
                  operation: 'edit' as const,
                  sourceVersion: urlVersion,
                },
              }
            : fallback;
      }
    } catch {
      throw persistenceError();
    }
    if (reserved.status === 'not_found') throw tripNotFoundError();
    if (reserved.status === 'in_progress') throw inProgressError();
    if (reserved.status === 'source_not_ready') throw planNotFoundError();
    const reservation = reserved.reservation;

    try {
      let saved: TripPlanVersionRecord;
      try {
        saved = await this.repository.saveReady(
          userId,
          tripId,
          reservation,
          editedPlan,
          new Date(editedPlan.generatedAt),
        );
      } catch {
        throw persistenceError();
      }
      const result = editResult(saved, urlVersion);
      const validated = EditTripPlanResultSchema.safeParse(result);
      if (!validated.success) throw persistenceError();
      return validated.data;
    } catch (error: unknown) {
      const mapped = mapEditError(error);
      try {
        const failedAt = this.clock.now();
        if (Number.isNaN(failedAt.getTime())) throw persistenceError();
        await this.repository.markFailed(userId, tripId, reservation, failedAt);
      } catch {
        throw persistenceError();
      }
      throw mapped;
    }
  }

  /** Compare two ready immutable snapshots without invoking any provider. */
  public async diff(
    userId: string,
    tripId: string,
    input: TripPlanVersionDiffInput,
  ): Promise<TripPlanVersionDiffResult> {
    this.assertTripId(tripId);
    const parsedInput = TripPlanVersionDiffInputSchema.safeParse(input);
    if (!parsedInput.success) throw validationError();
    await this.requireTripForVersionOperation(userId, tripId);

    let fromRecord: TripPlanVersionRecord | undefined;
    let toRecord: TripPlanVersionRecord | undefined;
    try {
      [fromRecord, toRecord] = await Promise.all([
        this.repository.findVersionForUser(userId, tripId, parsedInput.data.fromVersion),
        this.repository.findVersionForUser(userId, tripId, parsedInput.data.toVersion),
      ]);
    } catch {
      throw persistenceError();
    }
    if (
      fromRecord === undefined ||
      toRecord === undefined ||
      fromRecord.status !== 'ready' ||
      toRecord.status !== 'ready' ||
      fromRecord.plan === undefined ||
      toRecord.plan === undefined
    ) {
      throw planNotFoundError();
    }

    const fromPlan = TripPlanSchema.safeParse(fromRecord.plan);
    const toPlan = TripPlanSchema.safeParse(toRecord.plan);
    if (!fromPlan.success || !toPlan.success) throw planNotFoundError();
    if (fromPlan.data.tripId !== tripId || toPlan.data.tripId !== tripId) {
      throw persistenceError();
    }

    let result: TripPlanVersionDiffResult;
    try {
      result = withTripPlanVersionDiffVersions(
        compareTripPlanVersions(fromPlan.data, toPlan.data),
        parsedInput.data,
      );
    } catch (error: unknown) {
      if (error instanceof TripPlanDiffValidationError) throw validationError();
      throw persistenceError();
    }
    const validated = TripPlanVersionDiffResultSchema.safeParse(result);
    if (!validated.success) throw persistenceError();
    return validated.data;
  }

  public compareVersions(
    userId: string,
    tripId: string,
    input: TripPlanVersionDiffInput,
  ): Promise<TripPlanVersionDiffResult> {
    return this.diff(userId, tripId, input);
  }

  /** Restore a ready source snapshot into a new immutable version. */
  public restore(
    userId: string,
    tripId: string,
    sourceVersion: number,
    input?: RestoreTripPlanVersionInput,
  ): Promise<RestoreTripPlanVersionResult>;
  public restore(
    userId: string,
    tripId: string,
    input: RestoreTripPlanVersionInput,
    sourceVersion: number,
  ): Promise<RestoreTripPlanVersionResult>;
  public async restore(
    userId: string,
    tripId: string,
    inputOrSourceVersion: RestoreTripPlanVersionInput | number,
    sourceVersionOrInput?: RestoreTripPlanVersionInput | number,
  ): Promise<RestoreTripPlanVersionResult> {
    this.assertTripId(tripId);
    const sourceVersion =
      typeof inputOrSourceVersion === 'number'
        ? inputOrSourceVersion
        : typeof sourceVersionOrInput === 'number'
          ? sourceVersionOrInput
          : undefined;
    const input: RestoreTripPlanVersionInput =
      typeof inputOrSourceVersion === 'number'
        ? typeof sourceVersionOrInput === 'object' && sourceVersionOrInput !== null
          ? sourceVersionOrInput
          : {}
        : inputOrSourceVersion;
    const parsedInput = RestoreTripPlanVersionInputSchema.safeParse(input);
    if (!parsedInput.success) throw validationError();
    if (
      sourceVersion === undefined ||
      !Number.isSafeInteger(sourceVersion) ||
      sourceVersion < 1 ||
      sourceVersion > 2_147_483_647
    ) {
      throw validationError();
    }
    const now = this.clock.now();
    if (Number.isNaN(now.getTime())) throw validationError();

    const trip = await this.requireTripForVersionOperation(userId, tripId);
    let sourceRecord: TripPlanVersionRecord | undefined;
    try {
      sourceRecord = await this.repository.findVersionForUser(userId, tripId, sourceVersion);
    } catch {
      throw persistenceError();
    }
    if (
      sourceRecord === undefined ||
      sourceRecord.status !== 'ready' ||
      sourceRecord.plan === undefined
    ) {
      throw planNotFoundError();
    }
    const sourcePlan = TripPlanSchema.safeParse(sourceRecord.plan);
    if (!sourcePlan.success) throw planNotFoundError();
    if (sourcePlan.data.tripId !== tripId) throw persistenceError();

    let reserved: TripPlanRestoreReservationResult;
    try {
      if (this.repository.reserveRestore !== undefined) {
        reserved = await this.repository.reserveRestore(userId, tripId, sourceVersion, now);
      } else {
        const fallback = await this.repository.reserveGeneration(userId, tripId, now);
        reserved =
          fallback.status === 'reserved'
            ? {
                status: 'reserved',
                reservation: {
                  ...fallback.reservation,
                  operation: 'restore' as const,
                  sourceVersion,
                  previousTripStatus: fallback.reservation.previousTripStatus ?? trip.status,
                },
              }
            : fallback.status === 'in_progress'
              ? { status: 'in_progress' }
              : { status: 'not_found' };
      }
    } catch {
      throw persistenceError();
    }
    if (reserved.status === 'not_found') throw tripNotFoundError();
    if (reserved.status === 'in_progress') throw inProgressError();
    if (reserved.status === 'source_not_ready') throw planNotFoundError();
    const reservation: TripPlanGenerationReservation = {
      ...reserved.reservation,
      operation: 'restore',
      sourceVersion,
      previousTripStatus: reserved.reservation.previousTripStatus ?? trip.status,
    };

    try {
      const restoredPlan = TripPlanSchema.parse({
        ...sourcePlan.data,
        generatedAt: now.toISOString(),
      });
      let saved: TripPlanVersionRecord;
      try {
        saved = await this.repository.saveReady(userId, tripId, reservation, restoredPlan, now);
      } catch {
        throw persistenceError();
      }
      const result: RestoreTripPlanVersionResult = {
        tripId,
        sourceVersion,
        version: saved.version,
        status: 'ready',
        plan: restoredPlan,
        summary: tripPlanVersionSummary(saved),
      };
      const validated = RestoreTripPlanVersionResultSchema.safeParse(result);
      if (!validated.success) throw persistenceError();
      return validated.data;
    } catch (error: unknown) {
      const mapped = error instanceof TripPlanException ? error : persistenceError();
      try {
        const failedAt = this.clock.now();
        if (Number.isNaN(failedAt.getTime())) throw persistenceError();
        await this.repository.markFailed(userId, tripId, reservation, failedAt);
      } catch {
        throw persistenceError();
      }
      throw mapped;
    }
  }

  public async getLatest(userId: string, tripId: string): Promise<TripPlanVersionListResult> {
    this.assertTripId(tripId);
    await this.requireTrip(userId, tripId);
    let records: TripPlanVersionRecord[];
    try {
      records = await this.repository.listVersionsForUser(userId, tripId);
    } catch {
      throw persistenceError();
    }
    if (records.length === 0) throw planNotFoundError();
    const latestReady = records.find((record) => record.status === 'ready');
    if (latestReady !== undefined && latestReady.plan === undefined) throw persistenceError();
    const visibleRecords = records.slice(0, MAX_TRIP_PLAN_VERSIONS);
    if (
      latestReady !== undefined &&
      !visibleRecords.some((record) => record.version === latestReady.version)
    ) {
      visibleRecords[visibleRecords.length - 1] = latestReady;
      visibleRecords.sort((left, right) => right.version - left.version);
    }
    const result: TripPlanVersionListResult = {
      items: visibleRecords.map(tripPlanVersionSummary),
      ...(latestReady === undefined
        ? {}
        : { latestVersion: latestReady.version, plan: latestReady.plan }),
    };
    const validated = TripPlanVersionListResultSchema.safeParse(result);
    if (!validated.success) throw persistenceError();
    return validated.data;
  }

  public async getVersion(
    userId: string,
    tripId: string,
    version: number,
  ): Promise<TripPlanGenerationResult> {
    this.assertTripId(tripId);
    if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
      throw validationError();
    }
    await this.requireTrip(userId, tripId);
    let record: TripPlanVersionRecord | undefined;
    try {
      record = await this.repository.findVersionForUser(userId, tripId, version);
    } catch {
      throw persistenceError();
    }
    if (record === undefined || (record.status === 'ready' && record.plan === undefined)) {
      throw planNotFoundError();
    }
    const result = generationResult(record);
    const parsedPlan = TripPlanSchema.safeParse(result.plan);
    if (record.status === 'ready' && !parsedPlan.success) throw persistenceError();
    const parsedResult = TripPlanGenerationResultSchema.safeParse(result);
    if (!parsedResult.success) throw persistenceError();
    return parsedResult.data;
  }

  public generateTripPlan(
    userId: string,
    tripId: string,
    input: GenerateTripPlanInput = {},
  ): Promise<TripPlanGenerationResult> {
    return this.generate(userId, tripId, input);
  }

  public regenerateTripPlanDay(
    userId: string,
    tripId: string,
    input: RegenerateTripPlanDayInput,
  ): Promise<RegenerateTripPlanDayResult> {
    return this.regenerateDay(userId, tripId, input);
  }

  public reorderTripPlanDayItems(
    userId: string,
    tripId: string,
    version: number,
    input: ReorderTripPlanItemsInput,
  ): Promise<ReorderTripPlanItemsResult> {
    return this.reorderTripPlanItems(userId, tripId, version, input);
  }

  public editTripPlanVersion(
    userId: string,
    tripId: string,
    version: number,
    input: EditTripPlanInput,
  ): Promise<EditTripPlanResult> {
    return this.edit(userId, tripId, version, input);
  }

  public editTripPlan(
    userId: string,
    tripId: string,
    version: number,
    input: EditTripPlanInput,
  ): Promise<EditTripPlanResult> {
    return this.editTripPlanVersion(userId, tripId, version, input);
  }

  public getLatestTripPlan(userId: string, tripId: string): Promise<TripPlanVersionListResult> {
    return this.getLatest(userId, tripId);
  }

  public getTripPlanVersion(
    userId: string,
    tripId: string,
    version: number,
  ): Promise<TripPlanGenerationResult> {
    return this.getVersion(userId, tripId, version);
  }

  public getTripPlanDiff(
    userId: string,
    tripId: string,
    input: TripPlanVersionDiffInput,
  ): Promise<TripPlanVersionDiffResult> {
    return this.diff(userId, tripId, input);
  }

  public restoreTripPlanVersion(
    userId: string,
    tripId: string,
    sourceVersion: number,
    input: RestoreTripPlanVersionInput = {},
  ): Promise<RestoreTripPlanVersionResult> {
    return this.restore(userId, tripId, input, sourceVersion);
  }

  public restoreVersion(
    userId: string,
    tripId: string,
    sourceVersion: number,
    input: RestoreTripPlanVersionInput = {},
  ): Promise<RestoreTripPlanVersionResult> {
    return this.restoreTripPlanVersion(userId, tripId, sourceVersion, input);
  }

  private async requireTrip(userId: string, tripId: string): Promise<TripRecord> {
    try {
      const trip = await this.tripRepository.findByIdForUser(userId, tripId);
      if (trip === undefined) throw planNotFoundError();
      return trip;
    } catch (error: unknown) {
      if (error instanceof TripPlanException) throw error;
      throw persistenceError();
    }
  }

  private async requireTripForVersionOperation(
    userId: string,
    tripId: string,
  ): Promise<TripRecord> {
    try {
      const trip = await this.tripRepository.findByIdForUser(userId, tripId);
      if (trip === undefined) throw tripNotFoundError();
      return trip;
    } catch (error: unknown) {
      if (error instanceof TripPlanException) throw error;
      throw persistenceError();
    }
  }

  private async buildContext(
    reservation: TripPlanGenerationReservation,
    generatedAt: string,
  ): Promise<{
    tripId: string;
    input: CreateTripInput;
    weather: ReturnType<typeof WeatherResultSchema.parse>['days'];
    candidatePlaces: ReturnType<typeof PlaceListResultSchema.parse>['items'];
    routeEstimates: RouteEstimate[];
    routeOrders?: RouteOrderResult[];
    generatedAt: string;
  }> {
    const parsedInput = CreateTripInputSchema.safeParse(reservation.input);
    if (!parsedInput.success) throw validationError();
    const input = parsedInput.data;
    let weather: ReturnType<typeof WeatherResultSchema.parse>;
    let places: ReturnType<typeof PlaceListResultSchema.parse>;
    try {
      weather = WeatherResultSchema.parse(
        await this.weatherService.getWeather({
          destination: input.destination,
          startDate: input.startDate,
          endDate: input.endDate,
        }),
      );
      places = PlaceListResultSchema.parse(
        await this.placeService.searchPlaces({
          cityName: input.destination.cityName,
          ...(input.destination.cityCode === undefined
            ? {}
            : { cityCode: input.destination.cityCode }),
          categories: preferenceCategories(input),
          page: 1,
          pageSize: 30,
        }),
      );
    } catch (error: unknown) {
      throw mapContextError(error);
    }
    if (places.items.length === 0) throw unavailableError();
    if (weather.days.length === 0 || weather.days.every((day) => day.source === 'unavailable')) {
      throw unavailableError();
    }

    const selectedPlaces = places.items.slice(0, 30);
    const routeEstimates: RouteEstimate[] = [];
    const routeOrders: RouteOrderResult[] = [];
    if (selectedPlaces.length >= 2) {
      const points = selectedPlaces.slice(0, 10).map((place) => ({
        id: place.id,
        endpoint: { location: place.location, placeId: place.id },
      }));
      try {
        const order = await this.routeOrderService.estimateRouteOrder({
          points,
          mode: input.transportPreference === 'driving' ? 'driving' : 'walking',
        });
        routeOrders.push(order);
        for (const leg of order.legs) routeEstimates.push(leg.estimate);
      } catch (error: unknown) {
        const code = asCode(error);
        if (
          code !== 'ROUTE_ORDER_UNAVAILABLE' &&
          code !== 'ROUTE_MATRIX_UNAVAILABLE' &&
          code !== 'ROUTE_UNAVAILABLE'
        ) {
          throw mapContextError(error);
        }
      }

      // Keep RouteService in the orchestration boundary for deployments that provide
      // a route-order implementation without embedded estimates.
      if (routeEstimates.length === 0) {
        try {
          const fallback = await this.routeService.estimateRoute({
            origin: { location: selectedPlaces[0]!.location, placeId: selectedPlaces[0]!.id },
            destination: {
              location: selectedPlaces[1]!.location,
              placeId: selectedPlaces[1]!.id,
            },
            mode: input.transportPreference === 'driving' ? 'driving' : 'walking',
          });
          if (fallback.dataSource !== 'unavailable') routeEstimates.push(fallback);
        } catch (error: unknown) {
          const code = asCode(error);
          if (code !== 'ROUTE_UNAVAILABLE') throw mapContextError(error);
        }
      }
    }

    return {
      tripId: reservation.tripId,
      input,
      weather: weather.days,
      candidatePlaces: selectedPlaces,
      routeEstimates,
      ...(routeOrders.length === 0 ? {} : { routeOrders }),
      generatedAt,
    };
  }

  private assertTripId(tripId: string): void {
    if (!TripIdSchema.safeParse(tripId).success) throw validationError();
  }
}
