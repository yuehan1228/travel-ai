import { describe, expect, it } from 'vitest';

import { CreateTripInputSchema, TripPlanSchema } from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  DailyWeather,
  Place,
  TripPlan,
  TripPlanDay,
} from '@travel-guide/shared-types';

import { createTestLlmEnvironment } from '../src/modules/trip-plan/config/llm-environment';
import { FakeLLMProvider } from '../src/modules/trip-plan/providers';
import { TripPlanGenerationService } from '../src/modules/trip-plan/trip-plan-generation.service';
import type { TripPlanClock } from '../src/modules/trip-plan/trip-plan.clock';
import { TripPlanService } from '../src/modules/trip-plan/trip-plan.service';
import type {
  TripPlanGenerationReservation,
  TripPlanGenerationReservationResult,
  TripPlanRepository,
  TripPlanVersionRecord,
  TripPlanDayRegenerationReservationResult,
} from '../src/modules/trip-plan/repositories/trip-plan.repository';
import type { TripRecord, TripRepository } from '../src/modules/trips/repositories/trip.repository';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const userId = '223e4567-e89b-12d3-a456-426614174000';
const versionId = '323e4567-e89b-12d3-a456-426614174000';
const generatedVersionId = '423e4567-e89b-12d3-a456-426614174000';
const generatedAt = '2026-08-11T00:00:00.000Z';

const input: CreateTripInput = {
  destination: { cityName: '杭州' },
  startDate: '2026-08-12',
  endDate: '2026-08-12',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'relaxed',
  transportPreference: 'public_transport',
};

const threeDayInput: CreateTripInput = {
  ...input,
  endDate: '2026-08-14',
};

const weather: DailyWeather = {
  date: '2026-08-12',
  condition: 'clear',
  conditionText: '晴',
  minTemperatureC: 20,
  maxTemperatureC: 30,
  source: 'forecast',
  isReference: false,
};

const weatherFor = (date: string): DailyWeather => ({ ...weather, date });

const place: Place = {
  id: '523e4567-e89b-12d3-a456-426614174000',
  provider: 'fake-map',
  providerPlaceId: 'poi-1',
  name: '西湖',
  category: 'attraction',
  categoryText: '景点',
  address: '杭州市西湖区',
  location: { longitude: 120.15, latitude: 30.25 },
  verifiedAt: generatedAt,
  dataSource: 'map_provider',
};

const day = (
  summary: string,
  items: TripPlanDay['items'] = [],
  dayNumber = 1,
  dayWeather: DailyWeather = weather,
): TripPlanDay => ({
  dayNumber,
  date: dayWeather.date,
  summary,
  weather: dayWeather,
  items,
  estimatedCostCny: items.reduce((total, item) => total + item.estimatedCostCny, 0),
  warnings: [],
});

const plan = (summary: string): TripPlan =>
  TripPlanSchema.parse({
    schemaVersion: '1.0',
    tripId,
    cityName: input.destination.cityName,
    startDate: input.startDate,
    endDate: input.endDate,
    travelerCount: input.travelerCount,
    summary: '原攻略',
    days: [day(summary)],
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
    generatedAt,
  });

const restItem = (id: string, estimatedCostCny: number): TripPlanDay['items'][number] => ({
  id,
  type: 'rest',
  startTime: '09:00',
  endTime: '10:00',
  name: '自由活动',
  description: '适度休息。',
  recommendationReason: '保持轻松节奏。',
  estimatedCostCny,
  tips: [],
  dataSources: ['ai_generated'],
});

const threeDayPlan = (): TripPlan =>
  TripPlanSchema.parse({
    schemaVersion: '1.0',
    tripId,
    cityName: threeDayInput.destination.cityName,
    startDate: threeDayInput.startDate,
    endDate: threeDayInput.endDate,
    travelerCount: threeDayInput.travelerCount,
    summary: '三日原攻略',
    days: [
      day(
        '原第一天',
        [restItem('723e4567-e89b-12d3-a456-426614174001', 10)],
        1,
        weatherFor('2026-08-12'),
      ),
      day(
        '原第二天',
        [restItem('723e4567-e89b-12d3-a456-426614174002', 20)],
        2,
        weatherFor('2026-08-13'),
      ),
      day(
        '原第三天',
        [restItem('723e4567-e89b-12d3-a456-426614174003', 30)],
        3,
        weatherFor('2026-08-14'),
      ),
    ],
    hotelRecommendations: [],
    foodRecommendations: [],
    budget: {
      currency: 'CNY',
      totalCny: 60,
      accommodationCny: 0,
      transportationCny: 0,
      foodCny: 0,
      attractionsCny: 0,
      otherCny: 60,
    },
    transportationTips: [],
    generalTips: [],
    generatedAt,
  });

const trip = (tripInput: CreateTripInput = input): TripRecord => ({
  id: tripId,
  userId,
  cityName: tripInput.destination.cityName,
  startDate: tripInput.startDate,
  endDate: tripInput.endDate,
  travelerCount: tripInput.travelerCount,
  status: 'ready',
  inputSnapshot: CreateTripInputSchema.parse(tripInput),
  createdAt: new Date(generatedAt),
  updatedAt: new Date(generatedAt),
  deletedAt: null,
});

class FakeRepository implements TripPlanRepository {
  public busy = false;
  public readonly sourceInput: CreateTripInput;
  public readonly sourcePlan: TripPlan;
  public readonly records: TripPlanVersionRecord[];

  public constructor(sourcePlan: TripPlan = plan('旧安排'), sourceInput: CreateTripInput = input) {
    this.sourcePlan = sourcePlan;
    this.sourceInput = sourceInput;
    this.records = [
      {
        id: versionId,
        tripId,
        version: 1,
        schemaVersion: '1.0',
        status: 'ready',
        plan: sourcePlan,
        generatedAt: new Date(generatedAt),
        createdAt: new Date(generatedAt),
      },
    ];
  }

  public async reserveGeneration(
    requestedUserId: string,
    requestedTripId: string,
    createdAt: Date,
  ): Promise<TripPlanGenerationReservationResult> {
    if (requestedUserId !== userId || requestedTripId !== tripId) return { status: 'not_found' };
    if (this.busy) return { status: 'in_progress' };
    this.busy = true;
    const reservation: TripPlanGenerationReservation = {
      versionId: generatedVersionId,
      version: 2,
      tripId,
      userId,
      input: this.sourceInput,
      createdAt,
      operation: 'generate',
      previousTripStatus: 'ready',
    };
    this.records.unshift({
      id: generatedVersionId,
      tripId,
      version: 2,
      schemaVersion: '1.0',
      status: 'generating',
      createdAt,
    });
    return { status: 'reserved', reservation };
  }

  public async reserveDayRegeneration(
    requestedUserId: string,
    requestedTripId: string,
    sourceVersion: number,
    dayNumber: number,
    instruction: string | undefined,
    createdAt: Date,
  ): Promise<TripPlanDayRegenerationReservationResult> {
    if (requestedUserId !== userId || requestedTripId !== tripId) return { status: 'not_found' };
    if (this.busy) return { status: 'in_progress' };
    this.busy = true;
    const reservation: TripPlanGenerationReservation = {
      versionId: generatedVersionId,
      version: 2,
      tripId,
      userId,
      input: this.sourceInput,
      createdAt,
      operation: 'regenerate-day',
      sourceVersion,
      dayNumber,
      instruction,
      previousTripStatus: 'ready',
    };
    this.records.unshift({
      id: generatedVersionId,
      tripId,
      version: 2,
      schemaVersion: '1.0',
      status: 'generating',
      createdAt,
    });
    return { status: 'reserved', reservation };
  }

  public async saveReady(
    _requestedUserId: string,
    _requestedTripId: string,
    reservation: TripPlanGenerationReservation,
    nextPlan: TripPlan,
    readyAt: Date,
  ): Promise<TripPlanVersionRecord> {
    const index = this.records.findIndex((record) => record.id === reservation.versionId);
    if (index < 0) throw new Error('missing reservation');
    const ready: TripPlanVersionRecord = {
      ...this.records[index]!,
      status: 'ready',
      plan: nextPlan,
      generatedAt: readyAt,
    };
    this.records[index] = ready;
    this.busy = false;
    return ready;
  }

  public async markFailed(
    _requestedUserId: string,
    _requestedTripId: string,
    reservation: TripPlanGenerationReservation,
    failedAt: Date,
  ): Promise<void> {
    const index = this.records.findIndex((record) => record.id === reservation.versionId);
    if (index >= 0) {
      this.records[index] = { ...this.records[index]!, status: 'failed', generatedAt: failedAt };
    }
    this.busy = false;
  }

  public async listVersionsForUser(): Promise<TripPlanVersionRecord[]> {
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

const createService = (provider: FakeLLMProvider, repository: FakeRepository): TripPlanService => {
  const serviceInput = repository.sourceInput;
  const serviceWeather = repository.sourcePlan.days.map((sourceDay) => sourceDay.weather);
  const tripRepository: TripRepository = {
    create: async () => trip(serviceInput),
    listByUserId: async () => ({ items: [], total: 0 }),
    findByIdForUser: async (requestedUserId, requestedTripId) =>
      requestedUserId === userId && requestedTripId === tripId ? trip(serviceInput) : undefined,
    updateByIdForUser: async () => undefined,
    softDeleteByIdForUser: async () => false,
  };
  const weatherService = {
    getWeather: async () => ({
      destination: serviceInput.destination,
      days: serviceWeather,
      source: 'forecast' as const,
      fetchedAt: generatedAt,
    }),
  };
  const placeService = {
    searchPlaces: async () => ({
      items: [place],
      pagination: { page: 1, pageSize: 30, total: 1, totalPages: 1 },
      fetchedAt: generatedAt,
    }),
  };
  const routeService = {
    estimateRoute: async () => ({
      origin: { location: place.location },
      destination: { location: place.location },
      mode: 'walking' as const,
      dataSource: 'unavailable' as const,
      provider: 'fake-route',
      fetchedAt: generatedAt,
    }),
  };
  const routeOrderService = {
    estimateRouteOrder: async () => {
      throw { code: 'ROUTE_ORDER_UNAVAILABLE' };
    },
  };
  const clock: TripPlanClock = { now: () => new Date(generatedAt) };
  return new TripPlanService(
    tripRepository,
    repository,
    new TripPlanGenerationService(provider, createTestLlmEnvironment()),
    weatherService,
    placeService,
    routeService,
    routeOrderService,
    clock,
  );
};

describe('TripPlan day regeneration', () => {
  it('replaces one day once, recalculates the complete budget and keeps the source immutable', async () => {
    const regenerated = day('新的安排', [
      {
        id: '623e4567-e89b-12d3-a456-426614174000',
        type: 'attraction',
        startTime: '09:00',
        endTime: '10:00',
        name: place.name,
        description: '新的描述',
        recommendationReason: '符合偏好',
        place,
        estimatedCostCny: 88,
        tips: [],
        dataSources: ['map_provider', 'ai_generated'],
      },
    ]);
    const llm = new FakeLLMProvider(() => regenerated);
    const repository = new FakeRepository();
    const service = createService(llm, repository);

    const result = await service.regenerateDay(userId, tripId, {
      sourceVersion: 1,
      dayNumber: 1,
      instruction: '  更轻松  ',
    });

    expect(result).toMatchObject({ version: 2, sourceVersion: 1, dayNumber: 1, status: 'ready' });
    expect(result.plan?.days[0]?.summary).toBe('新的安排');
    expect(result.plan?.budget.totalCny).toBe(88);
    expect(repository.records[1]?.plan?.days[0]?.summary).toBe('旧安排');
    expect(repository.records[1]?.status).toBe('ready');
    expect(llm.calls).toBe(1);
    expect(llm.lastInput?.userPrompt).toContain('更轻松');
  });

  it('replaces only the middle day, supplies only immediate neighbors, and recalculates all days', async () => {
    const sourcePlan = threeDayPlan();
    const regenerated = day(
      '新的第二天安排',
      [
        {
          id: '623e4567-e89b-12d3-a456-426614174009',
          type: 'attraction',
          startTime: '09:00',
          endTime: '10:00',
          name: place.name,
          description: '新的第二天描述',
          recommendationReason: '符合偏好',
          place,
          estimatedCostCny: 88,
          tips: [],
          dataSources: ['map_provider', 'ai_generated'],
        },
      ],
      2,
      weatherFor('2026-08-13'),
    );
    const llm = new FakeLLMProvider(() => regenerated);
    const repository = new FakeRepository(sourcePlan, threeDayInput);
    const service = createService(llm, repository);

    const result = await service.regenerateDay(userId, tripId, {
      sourceVersion: 1,
      dayNumber: 2,
    });

    const promptPayload = JSON.parse(llm.lastInput?.userPrompt.split('\n').at(-1) ?? '{}') as {
      replacement?: { adjacentDays?: Array<{ dayNumber: number }> };
    };
    expect(promptPayload.replacement?.adjacentDays?.map((item) => item.dayNumber)).toEqual([1, 3]);
    expect(result.plan?.days[1]?.summary).toBe('新的第二天安排');
    expect(result.plan?.days[0]).toEqual(sourcePlan.days[0]);
    expect(result.plan?.days[2]).toEqual(sourcePlan.days[2]);
    expect(result.plan?.days[0]?.estimatedCostCny).toBe(10);
    expect(result.plan?.days[1]?.estimatedCostCny).toBe(88);
    expect(result.plan?.days[2]?.estimatedCostCny).toBe(30);
    expect(result.plan?.budget.totalCny).toBe(128);
    expect(result.plan?.budget.otherCny).toBe(40);
    expect(repository.records[1]?.plan).toEqual(sourcePlan);
    expect(repository.records[1]?.status).toBe('ready');
    expect(llm.calls).toBe(1);

    const firstDayLlm = new FakeLLMProvider(() =>
      day('新的第一天安排', [], 1, weatherFor('2026-08-12')),
    );
    const firstDayRepository = new FakeRepository(sourcePlan, threeDayInput);
    await createService(firstDayLlm, firstDayRepository).regenerateDay(userId, tripId, {
      sourceVersion: 1,
      dayNumber: 1,
    });
    const firstDayPrompt = JSON.parse(
      firstDayLlm.lastInput?.userPrompt.split('\n').at(-1) ?? '{}',
    ) as { replacement?: { adjacentDays?: Array<{ dayNumber: number }> } };
    expect(firstDayPrompt.replacement?.adjacentDays?.map((item) => item.dayNumber)).toEqual([2]);
  });

  it('maps an entity-tampered day to a stable error and leaves the source ready', async () => {
    const tampered = day('篡改', [
      {
        id: '623e4567-e89b-12d3-a456-426614174000',
        type: 'attraction',
        startTime: '09:00',
        endTime: '10:00',
        name: '伪造地点',
        description: '不可信',
        recommendationReason: '不可信',
        place: { ...place, providerPlaceId: 'forged' },
        estimatedCostCny: 0,
        tips: [],
        dataSources: ['map_provider', 'ai_generated'],
      },
    ]);
    const repository = new FakeRepository();
    const service = createService(new FakeLLMProvider(() => tampered), repository);

    await expect(
      service.regenerateDay(userId, tripId, { sourceVersion: 1, dayNumber: 1 }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_ENTITY_MISMATCH' });
    expect(repository.records.find((record) => record.version === 1)?.status).toBe('ready');
    expect(repository.records.find((record) => record.version === 2)?.status).toBe('failed');
  });

  it('shares the atomic in-progress guard with concurrent operations', async () => {
    const repository = new FakeRepository();
    repository.busy = true;
    const service = createService(new FakeLLMProvider(() => day('不会调用')), repository);
    await expect(
      service.regenerateDay(userId, tripId, { sourceVersion: 1, dayNumber: 1 }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_GENERATION_IN_PROGRESS' });
  });

  it('uses the same reservation guard for whole-plan generation and day regeneration', async () => {
    const repository = new FakeRepository();
    await expect(
      repository.reserveGeneration(userId, tripId, new Date(generatedAt)),
    ).resolves.toMatchObject({ status: 'reserved' });
    await expect(
      repository.reserveDayRegeneration(userId, tripId, 1, 1, undefined, new Date(generatedAt)),
    ).resolves.toEqual({ status: 'in_progress' });
  });

  it('does not reveal a cross-user Trip', async () => {
    const service = createService(new FakeLLMProvider(() => day('不会调用')), new FakeRepository());
    await expect(
      service.regenerateDay('723e4567-e89b-12d3-a456-426614174000', tripId, {
        sourceVersion: 1,
        dayNumber: 1,
      }),
    ).rejects.toMatchObject({ code: 'TRIP_NOT_FOUND' });
  });

  it('uses a stable day-not-found error when the source snapshot has no requested day', async () => {
    const service = createService(new FakeLLMProvider(() => day('不会调用')), new FakeRepository());
    await expect(
      service.regenerateDay(userId, tripId, { sourceVersion: 1, dayNumber: 2 }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_DAY_NOT_FOUND' });
  });
});
