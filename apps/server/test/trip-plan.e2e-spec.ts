import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  ApiFailureSchema,
  CreateTripInputSchema,
  LoginResultSchema,
  createApiSuccessSchema,
  PlaceSchema,
  TripPlanGenerationResultSchema,
  RegenerateTripPlanDayResultSchema,
  RestoreTripPlanVersionResultSchema,
  TripPlanVersionDiffResultSchema,
  TripPlanSchema,
  TripPlanVersionListResultSchema,
  ReorderTripPlanItemsResultSchema,
  OptimizeTripPlanDayResultSchema,
} from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  DailyWeather,
  EstimateRouteInput,
  Place,
  PlaceListResult,
  RouteEstimate,
  TripPlan,
  WeatherResult,
} from '@travel-guide/shared-types';

import { createApp } from '../src/create-app';
import { createTestAuthEnvironment } from '../src/modules/auth/config/auth-environment';
import type { UserRecord, UserRepository } from '../src/modules/auth/repositories/user.repository';
import type { WechatProvider } from '../src/modules/auth/providers/wechat.provider';
import type { TripRecord, TripRepository } from '../src/modules/trips/repositories/trip.repository';
import type { WeatherClock } from '../src/modules/weather/weather.clock';
import type {
  ClimateReferenceProvider,
  WeatherProvider,
  WeatherProviderInput,
  WeatherProviderResult,
} from '../src/modules/weather/providers/weather.provider';
import type {
  WeatherCacheRecordInput,
  WeatherCacheRepository,
} from '../src/modules/weather/repositories/weather-cache.repository';
import type { PlaceClock } from '../src/modules/places/place.clock';
import type { PlaceProvider, ProviderPlace } from '../src/modules/places/providers/place.provider';
import type { NormalizedPlaceSearch, PlaceRepository } from '../src/modules/places';
import type { RouteClock } from '../src/modules/routes/route.clock';
import type {
  RouteProvider,
  RouteProviderResult,
} from '../src/modules/routes/providers/route.provider';
import type {
  RouteCacheRecordInput,
  RouteCacheRepository,
} from '../src/modules/routes/repositories/route-cache.repository';
import { FakeLLMProvider } from '../src/modules/trip-plan/providers';
import type { TripPlanClock } from '../src/modules/trip-plan/trip-plan.clock';
import type {
  TripPlanGenerationReservation,
  TripPlanGenerationReservationResult,
  TripPlanRepository,
  TripPlanVersionRecord,
} from '../src/modules/trip-plan/repositories/trip-plan.repository';

const userId = '123e4567-e89b-12d3-a456-426614174000';
const validTripId = '223e4567-e89b-12d3-a456-426614174000';

const tripInput: CreateTripInput = {
  destination: { cityName: '杭州' },
  startDate: '2026-08-12',
  endDate: '2026-08-14',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'relaxed',
  transportPreference: 'public_transport',
};

const generatedAt = '2026-08-11T00:00:00.000Z';
const reorderFirstItemId = '423e4567-e89b-12d3-a456-426614174000';
const reorderSecondItemId = '523e4567-e89b-12d3-a456-426614174000';

const weatherFor = (date: string): DailyWeather => ({
  date,
  condition: 'clear',
  conditionText: '晴',
  minTemperatureC: 20,
  maxTemperatureC: 30,
  source: 'forecast',
  isReference: false,
});

const placeFor = (index: number): Place =>
  PlaceSchema.parse({
    id: `323e4567-e89b-12d3-a456-42661417${String(index).padStart(4, '0')}`,
    provider: 'fake-place',
    providerPlaceId: `fake-place-${index}`,
    name: `地点 ${index}`,
    category: 'attraction',
    categoryText: '景点',
    address: '杭州市西湖区',
    location: { longitude: 120.15 + index / 10_000, latitude: 30.25 + index / 10_000 },
    verifiedAt: generatedAt,
    dataSource: 'map_provider',
  });

const validPlan = (): TripPlan =>
  TripPlanSchema.parse({
    schemaVersion: '1.0',
    tripId: validTripId,
    cityName: tripInput.destination.cityName,
    startDate: tripInput.startDate,
    endDate: tripInput.endDate,
    travelerCount: tripInput.travelerCount,
    summary: '轻松安排。',
    days: ['2026-08-12', '2026-08-13', '2026-08-14'].map((date, index) => ({
      dayNumber: index + 1,
      date,
      summary: `第${index + 1}天`,
      weather: weatherFor(date),
      items:
        index === 0
          ? [
              {
                id: reorderFirstItemId,
                type: 'attraction',
                startTime: '09:00',
                endTime: '10:00',
                name: placeFor(1).name,
                description: '第一段休息',
                recommendationReason: '节奏舒缓',
                place: placeFor(1),
                estimatedCostCny: 1,
                tips: [],
                dataSources: ['map_provider'],
              },
              {
                id: reorderSecondItemId,
                type: 'attraction',
                startTime: '10:30',
                endTime: '11:30',
                name: placeFor(2).name,
                description: '第二段休息',
                recommendationReason: '节奏舒缓',
                place: placeFor(2),
                estimatedCostCny: 2,
                tips: [],
                dataSources: ['map_provider'],
              },
            ]
          : [],
      estimatedCostCny: index === 0 ? 3 : 0,
      warnings: [],
    })),
    hotelRecommendations: [],
    foodRecommendations: [],
    budget: {
      currency: 'CNY',
      totalCny: 3,
      accommodationCny: 0,
      transportationCny: 0,
      foodCny: 0,
      attractionsCny: 3,
      otherCny: 0,
    },
    transportationTips: [],
    generalTips: [],
    generatedAt,
  });

class FixedClock implements WeatherClock, PlaceClock, RouteClock, TripPlanClock {
  public now(): Date {
    return new Date(generatedAt);
  }
}

class FakeWeatherProvider implements WeatherProvider {
  public readonly name = 'fake-weather';
  public readonly forecastHorizonDays = 14;
  public calls = 0;

  public async getForecast(input: WeatherProviderInput): Promise<WeatherProviderResult> {
    this.calls += 1;
    const start = new Date(`${input.startDate}T00:00:00.000Z`);
    const end = new Date(`${input.endDate}T00:00:00.000Z`);
    const days: DailyWeather[] = [];
    for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      days.push(weatherFor(date.toISOString().slice(0, 10)));
    }
    return { source: 'forecast', days, fetchedAt: generatedAt };
  }
}

class FakeClimateProvider implements ClimateReferenceProvider {
  public async getClimateReference(): Promise<undefined> {
    return undefined;
  }
}

class FakeWeatherCacheRepository implements WeatherCacheRepository {
  public async findValid(): Promise<WeatherResult | undefined> {
    return undefined;
  }

  public async save(input: WeatherCacheRecordInput): Promise<void> {
    void input;
    return undefined;
  }
}

class FakePlaceProvider implements PlaceProvider {
  public readonly name = 'fake-place';
  public calls = 0;

  public async searchPlaces(): Promise<{
    items: ProviderPlace[];
    total: number;
    fetchedAt: string;
  }> {
    this.calls += 1;
    return {
      items: [1, 2].map((index) => ({
        provider: this.name,
        providerPlaceId: `fake-place-${index}`,
        name: `地点 ${index}`,
        category: 'attraction',
        categoryText: '景点',
        address: '杭州市西湖区',
        location: { longitude: 120.15 + index / 10_000, latitude: 30.25 + index / 10_000 },
      })),
      total: 2,
      fetchedAt: generatedAt,
    };
  }
}

class FakePlaceRepository implements PlaceRepository {
  public async findFreshSearch(
    input: NormalizedPlaceSearch,
    now: Date,
  ): Promise<PlaceListResult | undefined> {
    void input;
    void now;
    return undefined;
  }

  public async upsertProviderPlaces(input: ProviderPlace[]): Promise<Place[]> {
    return input.map((_place, index) => placeFor(index + 1));
  }

  public async saveSearchResult(): Promise<void> {
    return undefined;
  }
}

class FakeRouteProvider implements RouteProvider {
  public readonly name = 'fake-route';
  public calls = 0;

  public async estimateRoute(input: EstimateRouteInput): Promise<RouteProviderResult> {
    void input;
    this.calls += 1;
    return {
      distanceMeters: 1_000,
      durationSeconds: 600,
      fetchedAt: generatedAt,
    };
  }
}

class FakeRouteCacheRepository implements RouteCacheRepository {
  public async findFresh(): Promise<RouteEstimate | undefined> {
    return undefined;
  }

  public async findStale(): Promise<RouteEstimate | undefined> {
    return undefined;
  }

  public async save(input: RouteCacheRecordInput): Promise<void> {
    void input;
    return undefined;
  }
}

class FakeTripPlanRepository implements TripPlanRepository {
  private nextVersion = 1;
  private reserved = false;
  public readonly records: TripPlanVersionRecord[] = [];

  public async reserveGeneration(
    requestedUserId: string,
    requestedTripId: string,
    createdAt: Date,
  ): Promise<TripPlanGenerationReservationResult> {
    if (requestedUserId !== userId || requestedTripId !== validTripId)
      return { status: 'not_found' };
    if (this.reserved) return { status: 'in_progress' };
    this.reserved = true;
    const version = this.nextVersion;
    this.nextVersion += 1;
    const reservation: TripPlanGenerationReservation = {
      versionId: `423e4567-e89b-12d3-a456-42661417${String(version).padStart(4, '0')}`,
      version,
      tripId: validTripId,
      userId,
      input: tripInput,
      createdAt,
    };
    this.records.unshift({
      id: reservation.versionId,
      tripId: validTripId,
      version,
      schemaVersion: '1.0',
      status: 'generating',
      generatedAt: createdAt,
      createdAt,
    });
    return { status: 'reserved', reservation };
  }

  public async saveReady(
    _requestedUserId: string,
    _requestedTripId: string,
    reservation: TripPlanGenerationReservation,
    plan: TripPlan,
    generatedAtDate: Date,
  ): Promise<TripPlanVersionRecord> {
    const index = this.records.findIndex((record) => record.id === reservation.versionId);
    if (index < 0) throw new Error('reservation missing');
    const record = {
      ...this.records[index]!,
      status: 'ready' as const,
      plan: TripPlanSchema.parse(plan),
      generatedAt: generatedAtDate,
    };
    this.records[index] = record;
    this.reserved = false;
    return record;
  }

  public async markFailed(
    _requestedUserId: string,
    _requestedTripId: string,
    reservation: TripPlanGenerationReservation,
    failedAt: Date,
  ): Promise<void> {
    const index = this.records.findIndex((record) => record.id === reservation.versionId);
    if (index >= 0)
      this.records[index] = { ...this.records[index]!, status: 'failed', generatedAt: failedAt };
    this.reserved = false;
  }

  public async listVersionsForUser(
    requestedUserId: string,
    requestedTripId: string,
  ): Promise<TripPlanVersionRecord[]> {
    if (requestedUserId !== userId || requestedTripId !== validTripId) return [];
    return [...this.records];
  }

  public async findVersionForUser(
    requestedUserId: string,
    requestedTripId: string,
    version: number,
  ): Promise<TripPlanVersionRecord | undefined> {
    if (requestedUserId !== userId || requestedTripId !== validTripId) return undefined;
    return this.records.find((record) => record.version === version);
  }
}

class FakeWechatProvider implements WechatProvider {
  public async exchangeCode(code: string): Promise<{ openid: string }> {
    return { openid: code };
  }
}

class FakeUserRepository implements UserRepository {
  public async findOrCreateByWechatIdentity(): Promise<UserRecord> {
    return { id: userId, nickname: '', avatarUrl: '', status: 'active' };
  }
}

class FakeTripRepository implements TripRepository {
  public async create(): Promise<TripRecord> {
    throw new Error('not used');
  }

  public async listByUserId(): Promise<{ items: TripRecord[]; total: number }> {
    return { items: [], total: 0 };
  }

  public async findByIdForUser(
    requestedUserId: string,
    requestedTripId: string,
  ): Promise<TripRecord | undefined> {
    if (requestedUserId !== userId || requestedTripId !== validTripId) return undefined;
    const now = new Date(generatedAt);
    return {
      id: validTripId,
      userId,
      cityName: tripInput.destination.cityName,
      startDate: tripInput.startDate,
      endDate: tripInput.endDate,
      travelerCount: tripInput.travelerCount,
      status: 'draft',
      inputSnapshot: tripInput,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  public async updateByIdForUser(): Promise<TripRecord | undefined> {
    return undefined;
  }

  public async softDeleteByIdForUser(): Promise<boolean> {
    return false;
  }
}

describe('TripPlan API boundary', () => {
  let app: NestFastifyApplication;
  let llm: FakeLLMProvider;
  let weatherProvider: FakeWeatherProvider;
  let placeProvider: FakePlaceProvider;
  let routeProvider: FakeRouteProvider;
  let planRepository: FakeTripPlanRepository;

  beforeAll(async () => {
    llm = new FakeLLMProvider(() => validPlan());
    weatherProvider = new FakeWeatherProvider();
    placeProvider = new FakePlaceProvider();
    routeProvider = new FakeRouteProvider();
    planRepository = new FakeTripPlanRepository();
    app = await createApp(
      { nodeEnv: 'test', port: 0 },
      {
        authEnvironment: createTestAuthEnvironment(),
        wechatProvider: new FakeWechatProvider(),
        userRepository: new FakeUserRepository(),
        tripRepository: new FakeTripRepository(),
        weatherProvider,
        climateReferenceProvider: new FakeClimateProvider(),
        weatherCacheRepository: new FakeWeatherCacheRepository(),
        weatherClock: new FixedClock(),
        placeProvider,
        placeRepository: new FakePlaceRepository(),
        placeClock: new FixedClock(),
        routeProvider,
        routeCacheRepository: new FakeRouteCacheRepository(),
        routeClock: new FixedClock(),
        llmProvider: llm,
        tripPlanRepository: planRepository,
        tripPlanClock: new FixedClock(),
      },
    );
    await app.init();
  });

  afterAll(async () => app.close());

  const login = async (): Promise<string> => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/auth/login',
        payload: { code: 'trip-plan-user' },
      });
    return createApiSuccessSchema(LoginResultSchema).parse(JSON.parse(response.payload)).data
      .accessToken;
  };

  it('requires authentication and preserves request IDs on auth failures', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/generate`,
        headers: { 'x-request-id': 'trip-plan-auth-1' },
        payload: {},
      });
    expect(response.statusCode).toBe(401);
    expect(response.headers['x-request-id']).toBe('trip-plan-auth-1');
    expect(ApiFailureSchema.parse(JSON.parse(response.payload)).error.code).toBe(
      'AUTH_TOKEN_INVALID',
    );
  });

  it('protects optimize-order with authentication, strict URL/body versions, and request-id parity', async () => {
    const unauthenticated = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/plan/1/optimize-order`,
        headers: { 'x-request-id': 'trip-plan-optimize-auth-1' },
        payload: { sourceVersion: 1, dayNumber: 1 },
      });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.headers['x-request-id']).toBe('trip-plan-optimize-auth-1');
    expect(ApiFailureSchema.parse(JSON.parse(unauthenticated.payload)).error.code).toBe(
      'AUTH_TOKEN_INVALID',
    );

    const token = await login();
    const mismatch = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/plan/1/optimize-order`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-plan-optimize-400-1' },
        payload: { sourceVersion: 2, dayNumber: 1 },
      });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.headers['x-request-id']).toBe('trip-plan-optimize-400-1');
    expect(ApiFailureSchema.parse(JSON.parse(mismatch.payload)).error.code).toBe(
      'TRIP_PLAN_VALIDATION_ERROR',
    );

    const invalidVersion = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/plan/not-a-version/optimize-order`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-plan-optimize-400-2' },
        payload: { sourceVersion: 1, dayNumber: 1 },
      });
    expect(invalidVersion.statusCode).toBe(400);
    expect(invalidVersion.headers['x-request-id']).toBe('trip-plan-optimize-400-2');
  });

  it('validates strict body/id and does not reveal a missing trip or plan', async () => {
    const token = await login();
    const invalidBody = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/generate`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-plan-body-1' },
        payload: { provider: 'client-must-not-control' },
      });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.headers['x-request-id']).toBe('trip-plan-body-1');
    expect(ApiFailureSchema.parse(JSON.parse(invalidBody.payload)).error.code).toBe(
      'TRIP_PLAN_VALIDATION_ERROR',
    );

    const invalidId = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/trips/not-a-uuid/plan',
        headers: { authorization: `Bearer ${token}` },
      });
    expect(invalidId.statusCode).toBe(400);
    expect(ApiFailureSchema.parse(JSON.parse(invalidId.payload)).error.code).toBe(
      'TRIP_PLAN_VALIDATION_ERROR',
    );

    const missingPlan = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/trips/${validTripId}/plan/1`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-plan-read-1' },
      });
    expect(missingPlan.statusCode).toBe(404);
    expect(missingPlan.headers['x-request-id']).toBe('trip-plan-read-1');
    expect(ApiFailureSchema.parse(JSON.parse(missingPlan.payload)).error.code).toBe(
      'TRIP_PLAN_NOT_FOUND',
    );
  });

  it('generates and reads the latest and selected version through the authenticated envelope', async () => {
    const token = await login();
    const requestId = 'trip-plan-success-1';
    const generated = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/generate`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': requestId },
        payload: {},
      });

    expect(generated.statusCode).toBe(200);
    expect(generated.headers['x-request-id']).toBe(requestId);
    const generatedEnvelope = createApiSuccessSchema(TripPlanGenerationResultSchema).parse(
      JSON.parse(generated.payload),
    );
    expect(generatedEnvelope.requestId).toBe(requestId);
    expect(generatedEnvelope.data).toMatchObject({
      tripId: validTripId,
      version: 1,
      status: 'ready',
    });
    expect(generatedEnvelope.data.plan?.tripId).toBe(validTripId);
    expect(llm.calls).toBe(1);
    expect(weatherProvider.calls).toBe(1);
    expect(placeProvider.calls).toBe(1);
    expect(routeProvider.calls).toBeGreaterThan(0);

    const latest = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/trips/${validTripId}/plan`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-plan-success-2' },
      });
    expect(latest.statusCode).toBe(200);
    expect(latest.headers['x-request-id']).toBe('trip-plan-success-2');
    const latestEnvelope = createApiSuccessSchema(TripPlanVersionListResultSchema).parse(
      JSON.parse(latest.payload),
    );
    expect(latestEnvelope.data.latestVersion).toBe(1);
    expect(latestEnvelope.data.plan?.tripId).toBe(validTripId);
    expect(latestEnvelope.data.items[0]?.status).toBe('ready');

    const selected = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/trips/${validTripId}/plan/1`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-plan-success-3' },
      });
    expect(selected.statusCode).toBe(200);
    expect(selected.headers['x-request-id']).toBe('trip-plan-success-3');
    const selectedEnvelope = createApiSuccessSchema(TripPlanGenerationResultSchema).parse(
      JSON.parse(selected.payload),
    );
    expect(selectedEnvelope.data).toEqual(generatedEnvelope.data);
  });

  it('keeps the existing trip input schema strict at the test boundary', () => {
    expect(CreateTripInputSchema.safeParse(tripInput).success).toBe(true);
  });

  it('regenerates one day through the authenticated API and returns a new version', async () => {
    const token = await login();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/regenerate-day`,
        headers: { authorization: `Bearer ${token}` },
        payload: { sourceVersion: 1, dayNumber: 1, instruction: '  更轻松  ' },
      });

    expect(response.statusCode).toBe(200);
    const envelope = createApiSuccessSchema(RegenerateTripPlanDayResultSchema).parse(
      JSON.parse(response.payload),
    );
    expect(envelope.data).toMatchObject({
      sourceVersion: 1,
      dayNumber: 1,
      version: 2,
      status: 'ready',
    });
    expect(envelope.data.plan?.days).toHaveLength(3);
  });

  it('compares ready versions and restores an immutable source without provider calls', async () => {
    const token = await login();
    const beforeLlm = llm.calls;
    const beforeWeather = weatherProvider.calls;
    const beforePlaces = placeProvider.calls;
    const beforeRoutes = routeProvider.calls;
    const diffResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/trips/${validTripId}/plan/diff?fromVersion=1&toVersion=2`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-plan-diff-1' },
      });
    expect(diffResponse.statusCode).toBe(200);
    expect(diffResponse.headers['x-request-id']).toBe('trip-plan-diff-1');
    const diff = createApiSuccessSchema(TripPlanVersionDiffResultSchema).parse(
      JSON.parse(diffResponse.payload),
    );
    expect(diff.data).toMatchObject({ tripId: validTripId, fromVersion: 1, toVersion: 2 });

    const restoreResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/plan/1/restore`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-plan-restore-1' },
        payload: {},
      });
    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.headers['x-request-id']).toBe('trip-plan-restore-1');
    const restored = createApiSuccessSchema(RestoreTripPlanVersionResultSchema).parse(
      JSON.parse(restoreResponse.payload),
    );
    expect(restored.data).toMatchObject({
      tripId: validTripId,
      sourceVersion: 1,
      version: 3,
      status: 'ready',
    });
    expect(restored.data.plan).toEqual(validPlan());
    expect(llm.calls).toBe(beforeLlm);
    expect(weatherProvider.calls).toBe(beforeWeather);
    expect(placeProvider.calls).toBe(beforePlaces);
    expect(routeProvider.calls).toBe(beforeRoutes);
  });

  it('protects reorder-items with AuthGuard, strict URL/body versions, and request-id envelope parity', async () => {
    const unauthenticated = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/plan/3/reorder-items`,
        headers: { 'x-request-id': 'trip-plan-reorder-auth-1' },
        payload: {
          sourceVersion: 3,
          dayNumber: 1,
          orderedItemIds: [reorderSecondItemId, reorderFirstItemId],
        },
      });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.headers['x-request-id']).toBe('trip-plan-reorder-auth-1');
    expect(ApiFailureSchema.parse(JSON.parse(unauthenticated.payload)).error.code).toBe(
      'AUTH_TOKEN_INVALID',
    );

    const token = await login();
    const mismatch = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/plan/3/reorder-items`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-plan-reorder-400-1' },
        payload: {
          sourceVersion: 2,
          dayNumber: 1,
          orderedItemIds: [reorderSecondItemId, reorderFirstItemId],
        },
      });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.headers['x-request-id']).toBe('trip-plan-reorder-400-1');
    expect(ApiFailureSchema.parse(JSON.parse(mismatch.payload)).error.code).toBe(
      'TRIP_PLAN_VALIDATION_ERROR',
    );

    const invalidUrl = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/plan/not-a-version/reorder-items`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          sourceVersion: 3,
          dayNumber: 1,
          orderedItemIds: [reorderSecondItemId, reorderFirstItemId],
        },
      });
    expect(invalidUrl.statusCode).toBe(400);
    expect(ApiFailureSchema.parse(JSON.parse(invalidUrl.payload)).error.code).toBe(
      'TRIP_PLAN_VALIDATION_ERROR',
    );

    const requestId = 'trip-plan-reorder-success-1';
    const success = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/plan/3/reorder-items`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': requestId },
        payload: {
          sourceVersion: 3,
          dayNumber: 1,
          orderedItemIds: [reorderSecondItemId, reorderFirstItemId],
        },
      });
    expect(success.statusCode).toBe(200);
    expect(success.headers['x-request-id']).toBe(requestId);
    const envelope = createApiSuccessSchema(ReorderTripPlanItemsResultSchema).parse(
      JSON.parse(success.payload),
    );
    expect(envelope.requestId).toBe(requestId);
    expect(envelope.data).toMatchObject({
      tripId: validTripId,
      sourceVersion: 3,
      dayNumber: 1,
      version: 4,
      status: 'ready',
    });
    expect(envelope.data.plan.days[0]?.items.map((item) => item.id)).toEqual([
      reorderSecondItemId,
      reorderFirstItemId,
    ]);
  });

  it('optimizes a ready day with real fake matrix/order and keeps request-id parity', async () => {
    const token = await login();
    const requestId = 'trip-plan-optimize-success-1';
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/trips/${validTripId}/plan/3/optimize-order`,
        headers: { authorization: `Bearer ${token}`, 'x-request-id': requestId },
        payload: {
          sourceVersion: 3,
          dayNumber: 1,
          startItemId: reorderSecondItemId,
          endItemId: reorderFirstItemId,
        },
      });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe(requestId);
    const envelope = createApiSuccessSchema(OptimizeTripPlanDayResultSchema).parse(
      JSON.parse(response.payload),
    );
    expect(envelope.requestId).toBe(requestId);
    expect(envelope.data).toMatchObject({
      tripId: validTripId,
      sourceVersion: 3,
      version: 5,
      dayNumber: 1,
      status: 'ready',
    });
    expect(envelope.data.plan.days[0]?.items.map((item) => item.id)).toEqual([
      reorderSecondItemId,
      reorderFirstItemId,
    ]);
  });
});
