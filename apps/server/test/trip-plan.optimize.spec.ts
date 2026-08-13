import { describe, expect, it, vi } from 'vitest';

import {
  CreateTripInputSchema,
  RouteMatrixResultSchema,
  TripPlanSchema,
} from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  Place,
  RouteEstimate,
  RouteMatrixResult,
  RouteOrderResult,
  TripPlan,
} from '@travel-guide/shared-types';

import { TripPlanService } from '../src/modules/trip-plan/trip-plan.service';
import {
  optimizeTripPlanDayItems,
  TripPlanOptimizeError,
} from '../src/modules/trip-plan/trip-plan-optimize';
import type {
  TripPlanEditReservationResult,
  TripPlanGenerationReservation,
  TripPlanGenerationReservationResult,
  TripPlanRepository,
  TripPlanVersionRecord,
} from '../src/modules/trip-plan/repositories/trip-plan.repository';
import type { TripRecord, TripRepository } from '../src/modules/trips/repositories/trip.repository';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const userId = '223e4567-e89b-12d3-a456-426614174000';
const firstId = '323e4567-e89b-12d3-a456-426614174000';
const secondId = '423e4567-e89b-12d3-a456-426614174000';
const restId = '823e4567-e89b-12d3-a456-426614174000';
const thirdId = '923e4567-e89b-12d3-a456-426614174000';
const firstPlaceId = '523e4567-e89b-12d3-a456-426614174000';
const secondPlaceId = '623e4567-e89b-12d3-a456-426614174000';
const thirdPlaceId = 'a23e4567-e89b-12d3-a456-426614174000';
const now = new Date('2026-08-11T00:00:00.000Z');

const input: CreateTripInput = CreateTripInputSchema.parse({
  destination: { cityName: '杭州' },
  startDate: '2026-08-12',
  endDate: '2026-08-12',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'relaxed',
  transportPreference: 'public_transport',
});

const place = (id: string, longitude: number): Place => ({
  id,
  provider: 'fake-map',
  providerPlaceId: id,
  name: id === firstPlaceId ? '一' : '二',
  category: 'attraction',
  categoryText: '景点',
  address: '杭州',
  location: { longitude, latitude: 30.25 },
  verifiedAt: now.toISOString(),
  dataSource: 'cache',
});

const plan = (withRest = false): TripPlan =>
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
            type: 'attraction',
            startTime: '09:00',
            endTime: '10:00',
            name: '一',
            description: '一',
            recommendationReason: '一',
            place: place(firstPlaceId, 120.15),
            estimatedCostCny: 1,
            tips: [],
            dataSources: ['map_provider'],
          },
          ...(withRest
            ? [
                {
                  id: restId,
                  type: 'rest' as const,
                  startTime: '10:00',
                  endTime: '10:15',
                  name: '休息',
                  description: '休息',
                  recommendationReason: '休息',
                  estimatedCostCny: 0,
                  tips: [],
                  dataSources: ['ai_generated' as const],
                },
              ]
            : []),
          {
            id: secondId,
            type: 'attraction',
            startTime: '10:30',
            endTime: '11:30',
            name: '二',
            description: '二',
            recommendationReason: '二',
            place: place(secondPlaceId, 120.16),
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
    generatedAt: now.toISOString(),
  });

const trip = (): TripRecord => ({
  id: tripId,
  userId,
  cityName: '杭州',
  startDate: input.startDate,
  endDate: input.endDate,
  travelerCount: input.travelerCount,
  status: 'ready',
  inputSnapshot: input,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});

const estimate: RouteEstimate = {
  origin: { location: { longitude: 120.16, latitude: 30.25 }, placeId: secondPlaceId },
  destination: { location: { longitude: 120.15, latitude: 30.25 }, placeId: firstPlaceId },
  mode: 'walking',
  distanceMeters: 100,
  durationSeconds: 120,
  dataSource: 'map_provider',
  provider: 'fake-route',
  fetchedAt: now.toISOString(),
};

const estimateBetween = (
  originId: string,
  destinationId: string,
  mode: 'walking' | 'driving' = 'walking',
  durationSeconds = 120,
): RouteEstimate => {
  const placeByItem = new Map([
    [firstId, place(firstPlaceId, 120.15)],
    [secondId, place(secondPlaceId, 120.16)],
    [thirdId, place(thirdPlaceId, 120.17)],
  ]);
  const origin = placeByItem.get(originId)!;
  const destination = placeByItem.get(destinationId)!;
  return {
    origin: { location: origin.location, placeId: origin.id },
    destination: { location: destination.location, placeId: destination.id },
    mode,
    distanceMeters: mode === 'driving' ? 1_000 : 100,
    durationSeconds,
    dataSource: 'map_provider',
    provider: 'fake-route',
    fetchedAt: now.toISOString(),
  };
};

const matrix: RouteMatrixResult = RouteMatrixResultSchema.parse({
  points: [
    {
      id: firstId,
      endpoint: { location: place(firstPlaceId, 120.15).location, placeId: firstPlaceId },
    },
    {
      id: secondId,
      endpoint: { location: place(secondPlaceId, 120.16).location, placeId: secondPlaceId },
    },
  ],
  mode: 'walking',
  cells: [
    {
      originId: firstId,
      destinationId: secondId,
      status: 'available',
      estimate: {
        ...estimate,
        origin: { ...estimate.destination },
        destination: { ...estimate.origin },
      },
    },
    { originId: secondId, destinationId: firstId, status: 'available', estimate },
  ],
  generatedAt: now.toISOString(),
});

const order: RouteOrderResult = {
  orderedPointIds: [secondId, firstId],
  legs: [{ originId: secondId, destinationId: firstId, estimate }],
  totalDistanceMeters: 100,
  totalDurationSeconds: 120,
  mode: 'walking',
  algorithm: 'nearest_neighbor',
  isOptimal: false,
  generatedAt: now.toISOString(),
  warnings: ['Nearest-neighbor ordering is deterministic but not globally optimal.'],
};

const drivingEstimate: RouteEstimate = { ...estimate, mode: 'driving', distanceMeters: 1_000 };
const drivingMatrix: RouteMatrixResult = RouteMatrixResultSchema.parse({
  ...matrix,
  mode: 'driving',
  cells: matrix.cells.map((cell) =>
    cell.status === 'available'
      ? { ...cell, estimate: { ...cell.estimate, mode: 'driving', distanceMeters: 1_000 } }
      : cell,
  ),
});
const drivingOrder: RouteOrderResult = {
  ...order,
  mode: 'driving',
  legs: [{ ...order.legs[0]!, estimate: drivingEstimate }],
  totalDistanceMeters: 1_000,
};

const planThree = (): TripPlan => {
  const source = plan();
  const first = source.days[0]!.items[0]!;
  const second = source.days[0]!.items[1]!;
  return TripPlanSchema.parse({
    ...source,
    days: [
      {
        ...source.days[0]!,
        items: [
          first,
          second,
          {
            id: thirdId,
            type: 'attraction',
            startTime: '12:00',
            endTime: '13:00',
            name: '三',
            description: '三',
            recommendationReason: '三',
            place: place(thirdPlaceId, 120.17),
            estimatedCostCny: 3,
            tips: [],
            dataSources: ['map_provider'],
          },
        ],
        estimatedCostCny: 6,
      },
    ],
    budget: { ...source.budget, totalCny: 6, attractionsCny: 6 },
  });
};

const matrixThree: RouteMatrixResult = RouteMatrixResultSchema.parse({
  points: [firstId, secondId, thirdId].map((id) => {
    const itemPlace = new Map([
      [firstId, place(firstPlaceId, 120.15)],
      [secondId, place(secondPlaceId, 120.16)],
      [thirdId, place(thirdPlaceId, 120.17)],
    ]).get(id)!;
    return { id, endpoint: { location: itemPlace.location, placeId: itemPlace.id } };
  }),
  mode: 'walking',
  cells: [firstId, secondId, thirdId].flatMap((originId) =>
    [firstId, secondId, thirdId]
      .filter((destinationId) => destinationId !== originId)
      .map((destinationId) => ({
        originId,
        destinationId,
        status: 'available' as const,
        estimate: estimateBetween(originId, destinationId),
      })),
  ),
  generatedAt: now.toISOString(),
});

const orderThree: RouteOrderResult = {
  orderedPointIds: [secondId, thirdId, firstId],
  legs: [
    { originId: secondId, destinationId: thirdId, estimate: estimateBetween(secondId, thirdId) },
    { originId: thirdId, destinationId: firstId, estimate: estimateBetween(thirdId, firstId) },
  ],
  totalDistanceMeters: 200,
  totalDurationSeconds: 240,
  mode: 'walking',
  algorithm: 'nearest_neighbor',
  isOptimal: false,
  generatedAt: now.toISOString(),
  warnings: ['Nearest-neighbor ordering is deterministic but not globally optimal.'],
};

class FakePlanRepository implements TripPlanRepository {
  public constructor(public readonly sourcePlan: TripPlan = plan()) {}
  public failed = 0;
  public reserved = 0;
  public async reserveGeneration(): Promise<TripPlanGenerationReservationResult> {
    return { status: 'not_found' };
  }
  public async reserveOptimizeOrder(
    _user: string,
    _trip: string,
    _source: number,
    _day: number,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult> {
    this.reserved += 1;
    return {
      status: 'reserved',
      reservation: {
        versionId: '723e4567-e89b-12d3-a456-426614174000',
        version: 2,
        tripId,
        userId,
        input,
        createdAt,
        operation: 'optimize-order',
        sourceVersion: 1,
        dayNumber: 1,
        previousTripStatus: 'ready',
      },
    };
  }
  public async saveReady(
    _user: string,
    _trip: string,
    _reservation: TripPlanGenerationReservation,
    nextPlan: TripPlan,
    generatedAt: Date,
  ): Promise<TripPlanVersionRecord> {
    return {
      id: '723e4567-e89b-12d3-a456-426614174000',
      tripId,
      version: 2,
      schemaVersion: '1.0',
      status: 'ready',
      plan: nextPlan,
      generatedAt,
      createdAt: now,
    };
  }
  public async markFailed(): Promise<void> {
    this.failed += 1;
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
      plan: this.sourcePlan,
      generatedAt: now,
      createdAt: now,
    };
  }
}

const createService = (
  sourcePlan = plan(),
  routeError = false,
  options: {
    tripRecord?: TripRecord;
    matrixResult?: RouteMatrixResult;
    orderResult?: RouteOrderResult;
    matrixError?: boolean;
  } = {},
) => {
  const repository = new FakePlanRepository(sourcePlan);
  const events: string[] = [];
  const tripRepository: TripRepository = {
    create: vi.fn(),
    listByUserId: vi.fn(),
    findByIdForUser: vi.fn(async () => options.tripRecord ?? trip()),
    updateByIdForUser: vi.fn(),
    softDeleteByIdForUser: vi.fn(),
  };
  const routeMatrix = {
    estimateRouteMatrix: vi.fn(async () => {
      events.push('matrix');
      if (options.matrixError) throw { code: 'ROUTE_MATRIX_UNAVAILABLE' };
      return options.matrixResult ?? matrix;
    }),
  };
  const routeOrder = {
    estimateRouteOrderFromMatrix: vi.fn(() => {
      events.push('order');
      if (routeError) throw { code: 'ROUTE_ORDER_UNAVAILABLE' };
      return options.orderResult ?? order;
    }),
    estimateRouteOrder: vi.fn(async () => {
      events.push('order');
      if (routeError) throw { code: 'ROUTE_ORDER_UNAVAILABLE' };
      return options.orderResult ?? order;
    }),
  };
  const service = new TripPlanService(
    tripRepository,
    repository,
    { generate: vi.fn() },
    { getWeather: vi.fn() },
    { searchPlaces: vi.fn() },
    { estimateRoute: vi.fn() },
    routeOrder,
    { now: () => now },
    routeMatrix,
  );
  const reserve = repository.reserveOptimizeOrder.bind(repository);
  repository.reserveOptimizeOrder = async (...args) => {
    events.push('reserve');
    return reserve(...args);
  };
  return { service, repository, events };
};

const reversedPlan = (): TripPlan => {
  const source = plan();
  const first = source.days[0]!.items[0]!;
  const second = source.days[0]!.items[1]!;
  return TripPlanSchema.parse({
    ...source,
    days: [
      {
        ...source.days[0]!,
        items: [
          { ...second, startTime: '09:00', endTime: '10:00' },
          { ...first, startTime: '10:30', endTime: '11:30' },
        ],
      },
    ],
  });
};

describe('TripPlan same-day optimization', () => {
  it('reserves before matrix/order, preserves amounts, and creates a new timed version', async () => {
    const setup = createService();
    const result = await setup.service.optimizeTripPlanDay(userId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      startItemId: secondId,
      endItemId: firstId,
    });
    expect(setup.events).toEqual(['reserve', 'matrix', 'order']);
    expect(result.version).toBe(2);
    expect(result.plan.days[0]?.items.map((item) => item.id)).toEqual([secondId, firstId]);
    expect(result.plan.days[0]?.items.map((item) => [item.startTime, item.endTime])).toEqual([
      ['09:00', '10:00'],
      ['10:02', '11:02'],
    ]);
    expect(result.plan.budget.totalCny).toBe(3);
  });

  it('keeps a non-place slot while applying the real leg to the next place', async () => {
    const setup = createService(plan(true));
    const result = await setup.service.optimizeTripPlanDay(userId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      startItemId: secondId,
      endItemId: firstId,
    });
    expect(result.plan.days[0]?.items.map((item) => item.id)).toEqual([secondId, restId, firstId]);
    expect(result.plan.days[0]?.items.map((item) => [item.startTime, item.endTime])).toEqual([
      ['09:00', '10:00'],
      ['10:00', '10:15'],
      ['10:17', '11:17'],
    ]);
    expect(result.plan.days[0]?.items[2]?.route?.durationSeconds).toBe(120);
  });

  it('marks failed and restores ready when route order is unavailable', async () => {
    const setup = createService(plan(), true);
    await expect(
      setup.service.optimizeTripPlanDay(userId, tripId, 1, { sourceVersion: 1, dayNumber: 1 }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_OPTIMIZE_UNAVAILABLE' });
    expect(setup.repository.failed).toBe(1);
  });

  it('uses deterministic default order and supports each fixed endpoint independently', async () => {
    const source = plan();
    const defaultResult = await createService(source).service.optimizeTripPlanDay(
      userId,
      tripId,
      1,
      { sourceVersion: 1, dayNumber: 1 },
    );
    const defaultRepeat = await createService(source).service.optimizeTripPlanDay(
      userId,
      tripId,
      1,
      { sourceVersion: 1, dayNumber: 1 },
    );
    expect(defaultResult.plan.days[0]?.items.map((item) => item.id)).toEqual([secondId, firstId]);
    expect(defaultRepeat.plan.days[0]?.items.map((item) => item.id)).toEqual(
      defaultResult.plan.days[0]?.items.map((item) => item.id),
    );

    const startResult = await createService().service.optimizeTripPlanDay(userId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      startItemId: secondId,
    });
    expect(startResult.plan.days[0]?.items.map((item) => item.id)).toEqual([secondId, firstId]);

    const endResult = await createService().service.optimizeTripPlanDay(userId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      endItemId: firstId,
    });
    expect(endResult.plan.days[0]?.items.map((item) => item.id)).toEqual([secondId, firstId]);
  });

  it('supports driving mode using the matrix mode and real leg duration', async () => {
    const drivingTrip = {
      ...trip(),
      inputSnapshot: { ...input, transportPreference: 'driving' as const },
    };
    const setup = createService(plan(), false, {
      tripRecord: drivingTrip,
      matrixResult: drivingMatrix,
      orderResult: drivingOrder,
    });
    const result = await setup.service.optimizeTripPlanDay(userId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      startItemId: secondId,
      endItemId: firstId,
    });
    expect(result.plan.days[0]?.items[1]?.route?.mode).toBe('driving');
    expect(result.plan.days[0]?.items[1]?.endTime).toBe('11:02');
  });

  it('optimizes more than two concrete places from the complete matrix', async () => {
    const setup = createService(planThree(), false, {
      matrixResult: matrixThree,
      orderResult: orderThree,
    });
    const result = await setup.service.optimizeTripPlanDay(userId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
    });
    expect(result.plan.days[0]?.items.map((item) => item.id)).toEqual([secondId, thirdId, firstId]);
    expect(result.plan.days[0]?.items.map((item) => [item.startTime, item.endTime])).toEqual([
      ['09:00', '10:00'],
      ['10:02', '11:02'],
      ['11:04', '12:04'],
    ]);
    expect(result.plan.budget.totalCny).toBe(6);
  });

  it('rejects a no-op, invalid day/endpoints, and records a failed reservation', async () => {
    const noOpSource = reversedPlan();
    const noOp = createService(noOpSource);
    await expect(
      noOp.service.optimizeTripPlanDay(userId, tripId, 1, { sourceVersion: 1, dayNumber: 1 }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_VALIDATION_ERROR' });
    expect(noOp.repository.failed).toBe(1);

    const invalidDay = createService();
    await expect(
      invalidDay.service.optimizeTripPlanDay(userId, tripId, 1, { sourceVersion: 1, dayNumber: 2 }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_DAY_NOT_FOUND' });
    expect(invalidDay.repository.reserved).toBe(0);

    const invalidEndpoint = createService();
    await expect(
      invalidEndpoint.service.optimizeTripPlanDay(userId, tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
        endItemId: restId,
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_ENTITY_MISMATCH' });
    expect(invalidEndpoint.repository.reserved).toBe(0);
  });

  it('fails closed for matrix unavailable, matrix/order mismatch, and cross-day time', async () => {
    const matrixError = createService(plan(), false, { matrixError: true });
    await expect(
      matrixError.service.optimizeTripPlanDay(userId, tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
        startItemId: secondId,
        endItemId: firstId,
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_OPTIMIZE_UNAVAILABLE' });
    expect(matrixError.repository.failed).toBe(1);

    const mismatchedOrder: RouteOrderResult = {
      ...order,
      legs: [{ ...order.legs[0]!, estimate: { ...estimate, distanceMeters: 999 } }],
      totalDistanceMeters: 999,
    };
    const mismatch = createService(plan(), false, { orderResult: mismatchedOrder });
    await expect(
      mismatch.service.optimizeTripPlanDay(userId, tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
        startItemId: secondId,
        endItemId: firstId,
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_OPTIMIZE_UNAVAILABLE' });
    expect(mismatch.repository.failed).toBe(1);

    const lateEstimate = { ...estimate, durationSeconds: 60_000 };
    const lateMatrix = RouteMatrixResultSchema.parse({
      ...matrix,
      cells: matrix.cells.map((cell) =>
        cell.originId === secondId && cell.destinationId === firstId
          ? { ...cell, estimate: lateEstimate }
          : cell,
      ),
    });
    const lateOrder: RouteOrderResult = {
      ...order,
      legs: [{ ...order.legs[0]!, estimate: lateEstimate }],
      totalDurationSeconds: 60_000,
    };
    const crossDay = createService(plan(), false, {
      matrixResult: lateMatrix,
      orderResult: lateOrder,
    });
    await expect(
      crossDay.service.optimizeTripPlanDay(userId, tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
        startItemId: secondId,
        endItemId: firstId,
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_VALIDATION_ERROR' });
    expect(crossDay.repository.failed).toBe(1);
  });

  it('materialises without mutating source or another day', () => {
    const source = plan();
    const twoDay = TripPlanSchema.parse({
      ...source,
      endDate: '2026-08-13',
      days: [
        source.days[0],
        {
          dayNumber: 2,
          date: '2026-08-13',
          summary: '第二天',
          weather: { ...source.days[0]!.weather, date: '2026-08-13' },
          items: [],
          estimatedCostCny: 0,
          warnings: [],
        },
      ],
    });
    const snapshot = structuredClone(twoDay);
    const result = optimizeTripPlanDayItems(twoDay, [secondId, firstId], 1);
    expect(twoDay).toEqual(snapshot);
    expect(result.days[0]?.items.map((item) => item.id)).toEqual([secondId, firstId]);
    expect(result.days[1]).toEqual(twoDay.days[1]);
  });

  it('classifies pure permutation no-op and incomplete collections deterministically', () => {
    expect(() => optimizeTripPlanDayItems(plan(), [firstId, secondId], 1)).toThrowError(
      TripPlanOptimizeError,
    );
    try {
      optimizeTripPlanDayItems(plan(), [firstId], 1);
      throw new Error('expected entity mismatch');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'TRIP_PLAN_ENTITY_MISMATCH' });
    }
    try {
      optimizeTripPlanDayItems(plan(), [firstId, secondId], 9);
      throw new Error('expected missing day');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'TRIP_PLAN_ENTITY_MISMATCH' });
    }
  });

  it('shares the reservation mutex and marks failed on persistence errors', async () => {
    const inProgress = createService();
    inProgress.repository.reserveOptimizeOrder = async () => ({ status: 'in_progress' });
    await expect(
      inProgress.service.optimizeTripPlanDay(userId, tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_GENERATION_IN_PROGRESS' });
    expect(inProgress.events).toEqual([]);

    const saveFailure = createService();
    const originalPlan = structuredClone(saveFailure.repository.sourcePlan);
    saveFailure.repository.saveReady = async () => {
      throw new Error('transaction failed');
    };
    await expect(
      saveFailure.service.optimizeTripPlanDay(userId, tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
        startItemId: secondId,
        endItemId: firstId,
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_PERSISTENCE_ERROR' });
    expect(saveFailure.repository.failed).toBe(1);
    expect(saveFailure.repository.sourcePlan).toEqual(originalPlan);
  });
});
