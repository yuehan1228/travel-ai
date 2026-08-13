import { describe, expect, it, vi } from 'vitest';

import { CreateTripInputSchema, TripPlanSchema } from '@travel-guide/shared-schemas';
import type { CreateTripInput, Place, RouteEstimate, TripPlan } from '@travel-guide/shared-types';

import {
  reorderTripPlanDayItems,
  TripPlanReorderError,
} from '../src/modules/trip-plan/trip-plan-reorder';
import { TripPlanService } from '../src/modules/trip-plan/trip-plan.service';
import type {
  TripPlanEditReservationResult,
  TripPlanGenerationReservation,
  TripPlanGenerationReservationResult,
  TripPlanRepository,
  TripPlanVersionRecord,
} from '../src/modules/trip-plan/repositories/trip-plan.repository';
import type { TripRepository, TripRecord } from '../src/modules/trips/repositories/trip.repository';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const firstId = '223e4567-e89b-12d3-a456-426614174000';
const secondId = '323e4567-e89b-12d3-a456-426614174000';
const generatedAt = '2026-08-11T00:00:00.000Z';

const makePlan = (): TripPlan =>
  TripPlanSchema.parse({
    schemaVersion: '1.0',
    tripId,
    cityName: '杭州',
    startDate: '2026-08-12',
    endDate: '2026-08-12',
    travelerCount: 2,
    summary: '行程',
    days: [
      {
        dayNumber: 1,
        date: '2026-08-12',
        summary: '第一天',
        weather: {
          date: '2026-08-12',
          condition: 'clear',
          conditionText: '晴',
          source: 'forecast',
          isReference: false,
        },
        items: [
          {
            id: firstId,
            type: 'rest',
            startTime: '09:00',
            endTime: '10:00',
            name: '一',
            description: '一',
            recommendationReason: '一',
            estimatedCostCny: 1,
            tips: [],
            dataSources: ['ai_generated'],
          },
          {
            id: secondId,
            type: 'rest',
            startTime: '10:30',
            endTime: '11:30',
            name: '二',
            description: '二',
            recommendationReason: '二',
            estimatedCostCny: 2,
            tips: [],
            dataSources: ['ai_generated'],
          },
        ],
        estimatedCostCny: 3,
        warnings: [],
      },
    ],
    hotelRecommendations: [],
    foodRecommendations: [],
    budget: {
      currency: 'CNY',
      totalCny: 3,
      accommodationCny: 0,
      transportationCny: 0,
      foodCny: 0,
      attractionsCny: 0,
      otherCny: 3,
    },
    transportationTips: [],
    generalTips: [],
    generatedAt,
  });

describe('reorderTripPlanDayItems', () => {
  it('reorders a complete day without mutating the source snapshot', () => {
    const source = makePlan();
    const result = reorderTripPlanDayItems(
      source,
      { sourceVersion: 1, dayNumber: 1, orderedItemIds: [secondId, firstId] },
      generatedAt,
    );
    expect(result.days[0]?.items.map((item) => item.id)).toEqual([secondId, firstId]);
    expect(source.days[0]?.items.map((item) => item.id)).toEqual([firstId, secondId]);
  });

  it('rejects incomplete collections and no-op order deterministically', () => {
    const source = makePlan();
    expect(() =>
      reorderTripPlanDayItems(source, {
        sourceVersion: 1,
        dayNumber: 1,
        orderedItemIds: [firstId],
      }),
    ).toThrowError(TripPlanReorderError);
    expect(() =>
      reorderTripPlanDayItems(source, {
        sourceVersion: 1,
        dayNumber: 1,
        orderedItemIds: [firstId, secondId],
      }),
    ).toThrow('does not change');
  });
});

const serviceUserId = '423e4567-e89b-12d3-a456-426614174000';
const firstPlaceId = '523e4567-e89b-12d3-a456-426614174000';
const secondPlaceId = '623e4567-e89b-12d3-a456-426614174000';
const serviceNow = new Date('2026-08-11T00:00:00.000Z');

const serviceInput: CreateTripInput = {
  destination: { cityName: '杭州' },
  startDate: '2026-08-12',
  endDate: '2026-08-12',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'relaxed',
  transportPreference: 'public_transport',
};

const servicePlace = (id: string, name: string, longitude: number): Place => ({
  id,
  provider: 'fake-map',
  providerPlaceId: id,
  name,
  category: 'attraction',
  categoryText: '景点',
  address: '杭州',
  location: { longitude, latitude: 30.25 },
  verifiedAt: serviceNow.toISOString(),
  dataSource: 'cache',
});

const servicePlan = (): TripPlan => {
  const firstPlace = servicePlace(firstPlaceId, '一', 120.15);
  const secondPlace = servicePlace(secondPlaceId, '二', 120.16);
  return TripPlanSchema.parse({
    schemaVersion: '1.0',
    tripId,
    cityName: '杭州',
    startDate: '2026-08-12',
    endDate: '2026-08-12',
    travelerCount: 2,
    summary: '行程',
    days: [
      {
        dayNumber: 1,
        date: '2026-08-12',
        summary: '第一天',
        weather: {
          date: '2026-08-12',
          condition: 'clear',
          conditionText: '晴',
          source: 'forecast',
          isReference: false,
        },
        items: [
          {
            id: firstId,
            type: 'attraction',
            startTime: '09:00',
            endTime: '10:00',
            name: '一',
            description: '一',
            recommendationReason: '一',
            place: firstPlace,
            estimatedCostCny: 1,
            tips: [],
            dataSources: ['map_provider'],
          },
          {
            id: secondId,
            type: 'attraction',
            startTime: '10:30',
            endTime: '11:30',
            name: '二',
            description: '二',
            recommendationReason: '二',
            place: secondPlace,
            estimatedCostCny: 2,
            tips: [],
            dataSources: ['map_provider'],
          },
        ],
        estimatedCostCny: 3,
        warnings: [],
      },
    ],
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
    generatedAt: serviceNow.toISOString(),
  });
};

class ReorderRepositoryFake implements TripPlanRepository {
  public readonly source = servicePlan();
  public busy = false;
  public reserveCalls = 0;
  public failedCalls = 0;

  public async reserveGeneration(): Promise<TripPlanGenerationReservationResult> {
    return { status: 'not_found' };
  }

  public async reserveReorderItems(
    requestedUserId: string,
    requestedTripId: string,
    sourceVersion: number,
    _dayNumber: number,
    _orderedItemIds: readonly string[],
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult> {
    this.reserveCalls += 1;
    if (requestedUserId !== serviceUserId || requestedTripId !== tripId || sourceVersion !== 1) {
      return { status: 'not_found' };
    }
    if (this.busy) return { status: 'in_progress' };
    this.busy = true;
    return {
      status: 'reserved',
      reservation: {
        versionId: '723e4567-e89b-12d3-a456-426614174000',
        version: 2,
        tripId,
        userId: serviceUserId,
        input: CreateTripInputSchema.parse(serviceInput),
        createdAt,
        operation: 'reorder-items',
        sourceVersion: 1,
        previousTripStatus: 'ready',
      },
    };
  }

  public async saveReady(
    _userId: string,
    _tripId: string,
    _reservation: TripPlanGenerationReservation,
    nextPlan: TripPlan,
    generatedAt: Date,
  ): Promise<TripPlanVersionRecord> {
    this.busy = false;
    return {
      id: '723e4567-e89b-12d3-a456-426614174000',
      tripId,
      version: 2,
      schemaVersion: '1.0',
      status: 'ready',
      plan: nextPlan,
      generatedAt,
      createdAt: serviceNow,
    };
  }

  public async markFailed(): Promise<void> {
    this.failedCalls += 1;
    this.busy = false;
  }

  public async listVersionsForUser(): Promise<TripPlanVersionRecord[]> {
    return [];
  }

  public async findVersionForUser(): Promise<TripPlanVersionRecord> {
    return {
      id: '823e4567-e89b-12d3-a456-426614174000',
      tripId,
      version: 1,
      schemaVersion: '1.0',
      status: 'ready',
      plan: this.source,
      generatedAt: serviceNow,
      createdAt: serviceNow,
    };
  }
}

const serviceTrip = (): TripRecord => ({
  id: tripId,
  userId: serviceUserId,
  cityName: '杭州',
  startDate: serviceInput.startDate,
  endDate: serviceInput.endDate,
  travelerCount: serviceInput.travelerCount,
  status: 'ready',
  inputSnapshot: CreateTripInputSchema.parse(serviceInput),
  createdAt: serviceNow,
  updatedAt: serviceNow,
  deletedAt: null,
});

const createReorderService = () => {
  const repository = new ReorderRepositoryFake();
  const events: string[] = [];
  let releaseRoute: (() => void) | undefined;
  let blockRoute = false;
  const routeReader = {
    estimateRoute: vi.fn(async (): Promise<RouteEstimate> => {
      events.push('route');
      if (blockRoute) await new Promise<void>((resolve) => (releaseRoute = resolve));
      return {
        origin: { location: { longitude: 120.16, latitude: 30.25 }, placeId: secondPlaceId },
        destination: { location: { longitude: 120.15, latitude: 30.25 }, placeId: firstPlaceId },
        mode: 'walking',
        distanceMeters: 100,
        durationSeconds: 120,
        dataSource: 'map_provider',
        provider: 'fake-route',
        fetchedAt: serviceNow.toISOString(),
      };
    }),
  };
  const tripRepository: TripRepository = {
    create: vi.fn(),
    listByUserId: vi.fn(),
    findByIdForUser: vi.fn(async () => serviceTrip()),
    updateByIdForUser: vi.fn(),
    softDeleteByIdForUser: vi.fn(),
  };
  const service = new TripPlanService(
    tripRepository,
    repository,
    { generate: vi.fn() },
    { getWeather: vi.fn() },
    { searchPlaces: vi.fn() },
    routeReader,
    { estimateRouteOrder: vi.fn() },
    { now: () => serviceNow },
  );
  const reserve = repository.reserveReorderItems.bind(repository);
  repository.reserveReorderItems = async (...args) => {
    events.push('reserve');
    return reserve(...args);
  };
  return {
    service,
    repository,
    routeReader,
    events,
    blockRoute,
    setBlock: (value: boolean) => (blockRoute = value),
    release: () => releaseRoute?.(),
  };
};

describe('TripPlan reorder service reservation boundary', () => {
  it('reserves the Trip before querying real routes', async () => {
    const { service, events } = createReorderService();
    await service.reorderTripPlanItems(serviceUserId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      orderedItemIds: [secondId, firstId],
    });
    expect(events.slice(0, 2)).toEqual(['reserve', 'route']);
  });

  it('marks the reserved version failed and releases the lock on route failure', async () => {
    const { service, repository, routeReader } = createReorderService();
    routeReader.estimateRoute.mockRejectedValueOnce({ code: 'ROUTE_UNAVAILABLE' });
    await expect(
      service.reorderTripPlanItems(serviceUserId, tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
        orderedItemIds: [secondId, firstId],
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_REORDER_UNAVAILABLE' });
    expect(repository.failedCalls).toBe(1);
    expect(repository.busy).toBe(false);
  });

  it('rejects a concurrent reorder while the first reservation is generating', async () => {
    const setup = createReorderService();
    setup.setBlock(true);
    const first = setup.service.reorderTripPlanItems(serviceUserId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      orderedItemIds: [secondId, firstId],
    });
    await vi.waitFor(() => expect(setup.repository.reserveCalls).toBe(1));
    await expect(
      setup.service.reorderTripPlanItems(serviceUserId, tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
        orderedItemIds: [secondId, firstId],
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_GENERATION_IN_PROGRESS' });
    setup.release();
    await first;
  });
});
