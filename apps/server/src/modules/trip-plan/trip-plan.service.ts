import { Inject, Injectable } from '@nestjs/common';

import {
  CreateTripInputSchema,
  GenerateTripPlanInputSchema,
  PlaceListResultSchema,
  TripIdSchema,
  TripPlanGenerationResultSchema,
  TripPlanSchema,
  TripPlanVersionListResultSchema,
  WeatherResultSchema,
  MAX_TRIP_PLAN_VERSIONS,
} from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  EstimateRouteInput,
  EstimateRouteOrderInput,
  GetWeatherInput,
  GenerateTripPlanInput,
  PlaceCategory,
  PlaceListResult,
  SearchPlacesInput,
  TripPlan,
  TripPlanGenerationResult,
  TripPlanVersionListResult,
  RouteEstimate,
  RouteOrderResult,
  WeatherResult,
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
import { TripPlanGenerationService } from './trip-plan-generation.service';
import { TRIP_PLAN_CLOCK, TRIP_PLAN_REPOSITORY } from './trip-plan.tokens';
import { systemTripPlanClock, type TripPlanClock } from './trip-plan.clock';
import {
  tripPlanVersionSummary,
  type TripPlanGenerationReservation,
  type TripPlanRepository,
  type TripPlanVersionRecord,
} from './repositories/trip-plan.repository';

export interface TripPlanGenerator {
  generate(context: TripPlanGenerationContext): Promise<TripPlan>;
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

const asCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

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
