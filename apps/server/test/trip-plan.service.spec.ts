import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateTripInputSchema, TripPlanSchema } from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  DailyWeather,
  Place,
  PlaceListResult,
  RouteEstimate,
  TripPlan,
  WeatherResult,
} from '@travel-guide/shared-types';

import { TripPlanException } from '../src/modules/trip-plan/trip-plan.errors';
import type { TripPlanGenerationContext } from '../src/modules/trip-plan/trip-plan-generation.types';
import { TripPlanService } from '../src/modules/trip-plan/trip-plan.service';
import type {
  TripPlanGenerationReservation,
  TripPlanGenerationReservationResult,
  TripPlanRepository,
  TripPlanVersionRecord,
} from '../src/modules/trip-plan/repositories/trip-plan.repository';
import type {
  TripPlanGenerator,
  TripPlanPlaceReader,
  TripPlanRouteOrderReader,
  TripPlanRouteReader,
  TripPlanWeatherReader,
} from '../src/modules/trip-plan/trip-plan.service';
import type { TripRepository, TripRecord } from '../src/modules/trips/repositories/trip.repository';

const UUID = (index: number): string =>
  `123e4567-e89b-12d3-a456-42661417${String(index).padStart(4, '0')}`;

const now = new Date('2026-08-11T00:00:00.000Z');
const tripId = UUID(900);
const userId = UUID(901);

const input: CreateTripInput = {
  destination: { cityName: '杭州' },
  startDate: '2026-08-12',
  endDate: '2026-08-14',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'relaxed',
  transportPreference: 'public_transport',
};

// Keep this fixture at the service boundary: providers are fakes and no remote data is used.
const weatherFor = (date: string): DailyWeather => ({
  date,
  condition: 'clear',
  conditionText: '晴',
  minTemperatureC: 20,
  maxTemperatureC: 30,
  source: 'forecast',
  isReference: false,
});

const placeFor = (index: number): Place => ({
  id: UUID(index),
  provider: 'fake-map',
  providerPlaceId: `place-${index}`,
  name: `地点 ${index}`,
  category: 'attraction',
  categoryText: '景点',
  address: '杭州市西湖区',
  location: { longitude: 120.15 + index / 10_000, latitude: 30.25 + index / 10_000 },
  verifiedAt: now.toISOString(),
  dataSource: 'cache',
});

const weatherResult: WeatherResult = {
  destination: input.destination,
  days: [weatherFor('2026-08-12'), weatherFor('2026-08-13'), weatherFor('2026-08-14')],
  source: 'forecast',
  fetchedAt: now.toISOString(),
};

const placeResult: PlaceListResult = {
  items: [placeFor(1), placeFor(2)],
  pagination: { page: 1, pageSize: 30, total: 2, totalPages: 1 },
  fetchedAt: now.toISOString(),
};

const validPlan = (context: TripPlanGenerationContext): TripPlan => ({
  schemaVersion: '1.0',
  tripId: context.tripId,
  cityName: context.input.destination.cityName,
  startDate: context.input.startDate,
  endDate: context.input.endDate,
  travelerCount: context.input.travelerCount,
  summary: '轻松安排。',
  days: context.weather.map((weather, index) => ({
    dayNumber: index + 1,
    date: weather.date,
    summary: `第${index + 1}天`,
    weather,
    items: [],
    estimatedCostCny: 0,
    warnings: [],
  })),
  hotelRecommendations: [],
  foodRecommendations: [],
  budget: {
    currency: 'CNY',
    totalCny: 0,
    accommodationCny: 0,
    transportationCny: 0,
    foodCny: 0,
    attractionsCny: 0,
    otherCny: 0,
  },
  transportationTips: [],
  generalTips: [],
  generatedAt: context.generatedAt,
});

const tripRecord = (): TripRecord => ({
  id: tripId,
  userId,
  cityName: input.destination.cityName,
  startDate: input.startDate,
  endDate: input.endDate,
  travelerCount: input.travelerCount,
  status: 'draft',
  inputSnapshot: CreateTripInputSchema.parse(input),
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});

class FakePlanRepository implements TripPlanRepository {
  public busy = false;
  public failSave = false;
  public readonly records: TripPlanVersionRecord[] = [];
  private nextVersion = 1;

  public async reserveGeneration(
    requestedUserId: string,
    requestedTripId: string,
    createdAt: Date,
  ): Promise<TripPlanGenerationReservationResult> {
    if (requestedUserId !== userId || requestedTripId !== tripId) return { status: 'not_found' };
    if (this.busy) return { status: 'in_progress' };
    this.busy = true;
    const reservation: TripPlanGenerationReservation = {
      versionId: UUID(1000 + this.nextVersion),
      version: this.nextVersion,
      tripId,
      userId,
      input,
      createdAt,
    };
    this.nextVersion += 1;
    this.records.unshift({
      id: reservation.versionId,
      tripId,
      version: reservation.version,
      schemaVersion: '1.0',
      status: 'generating',
      createdAt,
      generatedAt: createdAt,
    });
    return { status: 'reserved', reservation };
  }

  public async saveReady(
    _requestedUserId: string,
    _requestedTripId: string,
    reservation: TripPlanGenerationReservation,
    plan: TripPlan,
    generatedAt: Date,
  ): Promise<TripPlanVersionRecord> {
    if (this.failSave) throw new Error('transaction failed');
    const index = this.records.findIndex((record) => record.id === reservation.versionId);
    if (index < 0) throw new Error('missing reservation');
    const record: TripPlanVersionRecord = {
      ...this.records[index]!,
      status: 'ready',
      plan: TripPlanSchema.parse(plan),
      generatedAt,
    };
    this.records[index] = record;
    this.busy = false;
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
    this.busy = false;
  }

  public async listVersionsForUser(
    requestedUserId: string,
    requestedTripId: string,
  ): Promise<TripPlanVersionRecord[]> {
    if (requestedUserId !== userId || requestedTripId !== tripId) return [];
    return [...this.records];
  }

  public async findVersionForUser(
    requestedUserId: string,
    requestedTripId: string,
    version: number,
  ): Promise<TripPlanVersionRecord | undefined> {
    if (requestedUserId !== userId || requestedTripId !== tripId) return undefined;
    return this.records.find((record) => record.version === version);
  }
}

const createService = () => {
  const planRepository = new FakePlanRepository();
  const tripRepository: TripRepository = {
    create: vi.fn(),
    listByUserId: vi.fn(),
    findByIdForUser: vi.fn(async (requestedUserId, requestedTripId) =>
      requestedUserId === userId && requestedTripId === tripId ? tripRecord() : undefined,
    ),
    updateByIdForUser: vi.fn(),
    softDeleteByIdForUser: vi.fn(),
  };
  const generationService: TripPlanGenerator = {
    generate: vi.fn(async (context: TripPlanGenerationContext) => validPlan(context)),
  };
  const weatherService: TripPlanWeatherReader = {
    getWeather: vi.fn(async () => weatherResult),
  };
  const placeService: TripPlanPlaceReader = {
    searchPlaces: vi.fn(async () => placeResult),
  };
  const unavailableRoute: RouteEstimate = {
    origin: { location: placeResult.items[0]!.location, placeId: placeResult.items[0]!.id },
    destination: { location: placeResult.items[1]!.location, placeId: placeResult.items[1]!.id },
    mode: 'walking',
    dataSource: 'unavailable',
    provider: 'fake-route',
    fetchedAt: now.toISOString(),
  };
  const routeService: TripPlanRouteReader = {
    estimateRoute: vi.fn(async () => unavailableRoute),
  };
  const routeOrderService: TripPlanRouteOrderReader = {
    estimateRouteOrder: vi.fn(async () => {
      throw { code: 'ROUTE_ORDER_UNAVAILABLE' };
    }),
  };
  const service = new TripPlanService(
    tripRepository,
    planRepository,
    generationService,
    weatherService,
    placeService,
    routeService,
    routeOrderService,
    { now: () => now },
  );
  return { service, planRepository, generationService, weatherService, placeService };
};

describe('TripPlanService', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('generates a valid three-day plan once and increments versions', async () => {
    const { service, planRepository, generationService } = createService();
    const first = await service.generate(userId, tripId, {});
    const second = await service.generate(userId, tripId, {});

    expect(first.status).toBe('ready');
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(planRepository.records.map((record) => record.version)).toEqual([2, 1]);
    expect(generationService.generate).toHaveBeenCalledTimes(2);
    expect(TripPlanSchema.safeParse(first.plan).success).toBe(true);
    await expect(service.getVersion(userId, tripId, 1)).resolves.toMatchObject({ version: 1 });
    await expect(service.getLatest(userId, tripId)).resolves.toMatchObject({
      latestVersion: 2,
    });
  });

  it('rejects a no-op edit before reserving a new version', async () => {
    const { service, planRepository } = createService();
    await service.generate(userId, tripId, {});
    const reserveSpy = vi.spyOn(planRepository, 'reserveGeneration');
    const recordCount = planRepository.records.length;

    await expect(
      service.edit(userId, tripId, 1, {
        sourceVersion: 1,
        summary: '轻松安排。',
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_VALIDATION_ERROR' });
    expect(reserveSpy).not.toHaveBeenCalled();
    expect(planRepository.records).toHaveLength(recordCount);
    expect(planRepository.records[0]?.status).toBe('ready');
  });

  it('rejects a concurrent reservation and marks provider failures as failed', async () => {
    const { service, planRepository, generationService } = createService();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(generationService.generate).mockImplementationOnce(async (context) => {
      await wait;
      return validPlan(context);
    });

    const first = service.generate(userId, tripId, {});
    await vi.waitFor(() => expect(generationService.generate).toHaveBeenCalledTimes(1));
    await expect(service.generate(userId, tripId, {})).rejects.toMatchObject({
      code: 'TRIP_PLAN_GENERATION_IN_PROGRESS',
    });
    release();
    await expect(first).resolves.toMatchObject({ status: 'ready' });
    expect(planRepository.records[0]?.status).toBe('ready');

    vi.mocked(generationService.generate).mockRejectedValueOnce(
      new TripPlanException('TRIP_PLAN_PROVIDER_ERROR', 502, 'provider failed'),
    );
    await expect(service.generate(userId, tripId, {})).rejects.toMatchObject({
      code: 'TRIP_PLAN_PROVIDER_ERROR',
    });
    expect(planRepository.records[0]?.status).toBe('failed');
    expect(planRepository.records[0]?.plan).toBeUndefined();
  });

  it('maps a transaction failure and keeps the failed version without a partial plan', async () => {
    const { service, planRepository } = createService();
    planRepository.failSave = true;
    await expect(service.generate(userId, tripId, {})).rejects.toMatchObject({
      code: 'TRIP_PLAN_PERSISTENCE_ERROR',
    });
    expect(planRepository.records).toHaveLength(1);
    expect(planRepository.records[0]?.status).toBe('failed');
    expect(planRepository.records[0]?.plan).toBeUndefined();
  });

  it('does not reveal another user or invalid trip/version identifiers', async () => {
    const { service } = createService();
    await expect(service.getLatest(UUID(999), tripId)).rejects.toMatchObject({
      code: 'TRIP_PLAN_NOT_FOUND',
    });
    await expect(service.generate(userId, 'not-a-uuid', {})).rejects.toMatchObject({
      code: 'TRIP_PLAN_VALIDATION_ERROR',
    });
    await expect(service.getVersion(userId, tripId, 0)).rejects.toMatchObject({
      code: 'TRIP_PLAN_VALIDATION_ERROR',
    });
  });
});
