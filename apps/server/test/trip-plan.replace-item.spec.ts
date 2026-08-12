import { describe, expect, it, vi } from 'vitest';

import { CreateTripInputSchema, TripPlanSchema } from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  Place,
  PlaceListResult,
  RouteEstimate,
  SearchPlacesInput,
  TripPlan,
} from '@travel-guide/shared-types';

import { TripPlanService } from '../src/modules/trip-plan/trip-plan.service';
import type {
  TripPlanEditReservationResult,
  TripPlanRepository,
  TripPlanGenerationReservationResult,
  TripPlanGenerationReservation,
  TripPlanVersionRecord,
} from '../src/modules/trip-plan/repositories/trip-plan.repository';
import type { TripRepository, TripRecord } from '../src/modules/trips/repositories/trip.repository';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const userId = '223e4567-e89b-12d3-a456-426614174000';
const itemId = '323e4567-e89b-12d3-a456-426614174000';
const secondItemId = '423e4567-e89b-12d3-a456-426614174000';
const now = new Date('2026-08-11T00:00:00.000Z');
const generatedAt = now.toISOString();

const input: CreateTripInput = {
  destination: { cityName: '杭州' },
  startDate: '2026-08-12',
  endDate: '2026-08-12',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'relaxed',
  transportPreference: 'public_transport',
};

const place = (id: string, providerPlaceId: string, name: string, longitude: number): Place => ({
  id,
  provider: 'fake-map',
  providerPlaceId,
  name,
  category: 'attraction',
  categoryText: '景点',
  address: '杭州市西湖区',
  location: { longitude, latitude: 30.25 },
  verifiedAt: generatedAt,
  dataSource: 'cache',
});

const sourcePlace = place('523e4567-e89b-12d3-a456-426614174000', 'source', '原地点', 120.15);
const nextPlace = place('623e4567-e89b-12d3-a456-426614174000', 'next', '下一个地点', 120.16);
const replacementPlace = place(
  '723e4567-e89b-12d3-a456-426614174000',
  'replacement',
  '替换地点',
  120.17,
);

const route = (origin: Place, destination: Place): RouteEstimate => ({
  origin: { location: origin.location, placeId: origin.id },
  destination: { location: destination.location, placeId: destination.id },
  mode: 'walking',
  distanceMeters: 100,
  durationSeconds: 200,
  dataSource: 'map_provider',
  provider: 'fake-route',
  fetchedAt: generatedAt,
});

const plan = (): TripPlan =>
  TripPlanSchema.parse({
    schemaVersion: '1.0',
    tripId,
    cityName: '杭州',
    startDate: '2026-08-12',
    endDate: '2026-08-12',
    travelerCount: 2,
    summary: '轻松安排',
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
            id: itemId,
            type: 'attraction',
            startTime: '09:00',
            endTime: '10:00',
            name: sourcePlace.name,
            description: '游览景点',
            recommendationReason: '适合散步',
            place: sourcePlace,
            route: route(sourcePlace, nextPlace),
            estimatedCostCny: 10,
            tips: [],
            dataSources: ['map_provider', 'route_provider'],
          },
          {
            id: secondItemId,
            type: 'attraction',
            startTime: '10:30',
            endTime: '11:30',
            name: nextPlace.name,
            description: '继续游览',
            recommendationReason: '交通方便',
            place: nextPlace,
            route: route(sourcePlace, nextPlace),
            estimatedCostCny: 10,
            tips: [],
            dataSources: ['map_provider', 'route_provider'],
          },
        ],
        estimatedCostCny: 20,
        warnings: [],
      },
    ],
    hotelRecommendations: [],
    foodRecommendations: [],
    budget: {
      currency: 'CNY',
      totalCny: 20,
      accommodationCny: 0,
      transportationCny: 0,
      foodCny: 0,
      attractionsCny: 20,
      otherCny: 0,
    },
    transportationTips: [],
    generalTips: [],
    generatedAt,
  });

class FakePlanRepository implements TripPlanRepository {
  public readonly source = plan();
  public saved?: TripPlan;
  private busy = false;

  public async reserveGeneration(): Promise<TripPlanGenerationReservationResult> {
    return { status: 'not_found' };
  }

  public async reserveReplaceItem(
    requestedUserId: string,
    requestedTripId: string,
    sourceVersion: number,
    requestedItemId: string,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult> {
    if (requestedUserId !== userId || requestedTripId !== tripId) return { status: 'not_found' };
    if (this.busy) return { status: 'in_progress' };
    if (sourceVersion !== 1 || requestedItemId !== itemId) return { status: 'source_not_ready' };
    this.busy = true;
    return {
      status: 'reserved',
      reservation: {
        versionId: '823e4567-e89b-12d3-a456-426614174000',
        version: 2,
        tripId,
        userId,
        input,
        createdAt,
        operation: 'replace-item',
        sourceVersion,
        itemId,
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
    this.saved = nextPlan;
    this.busy = false;
    return {
      id: '823e4567-e89b-12d3-a456-426614174000',
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
    this.busy = false;
  }

  public async listVersionsForUser(): Promise<TripPlanVersionRecord[]> {
    return [];
  }

  public async findVersionForUser(
    _userId: string,
    _tripId: string,
    version: number,
  ): Promise<TripPlanVersionRecord | undefined> {
    if (version !== 1) return undefined;
    return {
      id: '723e4567-e89b-12d3-a456-426614174174',
      tripId,
      version: 1,
      schemaVersion: '1.0',
      status: 'ready',
      plan: this.source,
      generatedAt: now,
      createdAt: now,
    };
  }
}

const tripRecord = (): TripRecord => ({
  id: tripId,
  userId,
  cityName: input.destination.cityName,
  startDate: input.startDate,
  endDate: input.endDate,
  travelerCount: input.travelerCount,
  status: 'ready',
  inputSnapshot: CreateTripInputSchema.parse(input),
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
});

const createService = (includePageTwoCandidate = false) => {
  const repository = new FakePlanRepository();
  const placeReader = {
    searchPlaces: vi.fn(async ({ page = 1 }: SearchPlacesInput): Promise<PlaceListResult> => {
      if (includePageTwoCandidate) {
        return {
          items: page === 1 ? [sourcePlace, nextPlace] : [replacementPlace],
          pagination: { page, pageSize: 20, total: 21, totalPages: 2 },
          fetchedAt: generatedAt,
        };
      }
      return {
        items: [sourcePlace, sourcePlace, replacementPlace, nextPlace],
        pagination: { page: 1, pageSize: 20, total: 4, totalPages: 1 },
        fetchedAt: generatedAt,
      };
    }),
  };
  const routeReader = {
    estimateRoute: vi.fn(
      async ({
        origin,
        destination,
      }: {
        origin: { placeId?: string };
        destination: { placeId?: string };
      }) =>
        route(
          [sourcePlace, nextPlace, replacementPlace].find((item) => item.id === origin.placeId) ??
            sourcePlace,
          [sourcePlace, nextPlace, replacementPlace].find(
            (item) => item.id === destination.placeId,
          ) ?? nextPlace,
        ),
    ),
  };
  const tripRepository: TripRepository = {
    create: vi.fn(),
    listByUserId: vi.fn(),
    findByIdForUser: vi.fn(async () => tripRecord()),
    updateByIdForUser: vi.fn(),
    softDeleteByIdForUser: vi.fn(),
  };
  const weather = { getWeather: vi.fn() };
  const routeOrder = { estimateRouteOrder: vi.fn() };
  const generator = { generate: vi.fn() };
  return {
    repository,
    placeReader,
    routeReader,
    service: new TripPlanService(
      tripRepository,
      repository,
      generator,
      weather,
      placeReader,
      routeReader,
      routeOrder,
      { now: () => now },
    ),
  };
};

describe('TripPlan item replacement', () => {
  it('filters the original and duplicate POIs before returning candidates', async () => {
    const { service } = createService();
    const result = await service.listReplacementCandidates(userId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      itemId,
    });
    expect(result.items.map((candidate) => candidate.place.id)).toEqual([replacementPlace.id]);
  });

  it('creates a new immutable snapshot and recalculates adjacent real routes', async () => {
    const { service, repository, routeReader } = createService();
    const result = await service.replaceTripPlanItem(userId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      itemId,
      replacementPlaceId: replacementPlace.id,
    });
    expect(result.version).toBe(2);
    expect(result.plan.days[0]?.items[0]?.place?.id).toBe(replacementPlace.id);
    expect(result.plan.days[0]?.items[1]?.route?.origin.placeId).toBe(replacementPlace.id);
    expect(repository.source.days[0]?.items[0]?.place?.id).toBe(sourcePlace.id);
    expect(routeReader.estimateRoute).toHaveBeenCalledTimes(1);
  });

  it('accepts and replaces a candidate returned on page two', async () => {
    const { service, placeReader } = createService(true);
    const result = await service.replaceTripPlanItem(userId, tripId, 1, {
      sourceVersion: 1,
      dayNumber: 1,
      itemId,
      replacementPlaceId: replacementPlace.id,
    });
    expect(result.plan.days[0]?.items[0]?.place?.id).toBe(replacementPlace.id);
    expect(placeReader.searchPlaces).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 20 }),
    );
  });

  it('fails atomically when an affected real route is unavailable', async () => {
    const { service, routeReader } = createService();
    routeReader.estimateRoute.mockResolvedValue({
      origin: { location: replacementPlace.location, placeId: replacementPlace.id },
      destination: { location: nextPlace.location, placeId: nextPlace.id },
      mode: 'walking',
      dataSource: 'unavailable',
      provider: 'fake-route',
      fetchedAt: generatedAt,
    });
    await expect(
      service.replaceTripPlanItem(userId, tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
        itemId,
        replacementPlaceId: replacementPlace.id,
      }),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_REPLACEMENT_UNAVAILABLE' });
  });
});
