import { describe, expect, it } from 'vitest';

import {
  FoodRecommendationSchema,
  HotelAreaRecommendationSchema,
  TripBudgetEstimateSchema,
  TripPlanDaySchema,
  TripPlanItemSchema,
  TripPlanSchema,
  TripPlanWarningSchema,
  ListTripPlanItemReplacementCandidatesInputSchema,
  TripPlanItemReplacementCandidateSchema,
  TripPlanItemReplacementCandidateListSchema,
  ReplaceTripPlanItemInputSchema,
  GetTripPlanOptimizationAuditInputSchema,
  TripPlanOptimizationAuditResultSchema,
} from '../src';

const UUIDS = [
  '123e4567-e89b-12d3-a456-426614174000',
  '123e4567-e89b-12d3-a456-426614174001',
  '123e4567-e89b-12d3-a456-426614174002',
  '123e4567-e89b-12d3-a456-426614174003',
  '123e4567-e89b-12d3-a456-426614174004',
  '123e4567-e89b-12d3-a456-426614174005',
] as const;

const place = (id: string, category: 'attraction' | 'restaurant' = 'attraction') => ({
  id,
  provider: 'fake-map',
  providerPlaceId: `provider-${id}`,
  name: category === 'restaurant' ? '本地餐馆' : '西湖景点',
  category,
  categoryText: category === 'restaurant' ? '餐厅' : '景点',
  address: '杭州市西湖区',
  location: { longitude: 120.15, latitude: 30.25 },
  rating: 4.5,
  verifiedAt: '2026-08-11T00:00:00.000Z',
  dataSource: 'cache' as const,
});

const weather = (date: string) => ({
  date,
  condition: 'clear' as const,
  conditionText: '晴',
  minTemperatureC: 20,
  maxTemperatureC: 30,
  precipitationProbability: 10,
  source: 'forecast' as const,
  isReference: false,
});

const item = (
  id: string,
  type: 'attraction' | 'food' | 'transport' | 'hotel' | 'rest',
  cost = 0,
) => ({
  id,
  type,
  startTime: '09:00',
  endTime: '10:00',
  name: type === 'food' ? '本地餐馆' : '行程安排',
  description: '一段简洁的说明。',
  recommendationReason: '符合本次旅行偏好。',
  ...(type === 'attraction' ? { place: place(UUIDS[1]) } : {}),
  ...(type === 'food' ? { place: place(UUIDS[2], 'restaurant') } : {}),
  estimatedCostCny: cost,
  tips: ['提前查看开放信息'],
  dataSources: ['map_provider', 'ai_generated'] as const,
});

const day = (dayNumber: number, date: string, items = [item(UUIDS[1], 'attraction', 100)]) => ({
  dayNumber,
  date,
  summary: `第${dayNumber}天安排`,
  weather: weather(date),
  items,
  estimatedCostCny: items.reduce((total, current) => total + current.estimatedCostCny, 0),
  warnings: [],
});

const budget = (totalCny: number, overrides: Record<string, number> = {}) => ({
  currency: 'CNY' as const,
  totalCny,
  accommodationCny: 0,
  transportationCny: 0,
  foodCny: 0,
  attractionsCny: totalCny,
  otherCny: 0,
  ...overrides,
});

const plan = {
  schemaVersion: '1.0' as const,
  tripId: UUIDS[0],
  cityName: '杭州',
  startDate: '2026-08-12',
  endDate: '2026-08-12',
  travelerCount: 2,
  summary: '围绕西湖的轻松一日行程。',
  days: [day(1, '2026-08-12')],
  hotelRecommendations: [],
  foodRecommendations: [],
  budget: budget(100),
  transportationTips: ['优先使用公共交通'],
  generalTips: ['预留休息时间'],
  generatedAt: '2026-08-11T00:00:00.000Z',
};

describe('TripPlan schemas', () => {
  it('accepts a valid one-day and three-day plan', () => {
    expect(TripPlanSchema.safeParse(plan).success).toBe(true);

    const threeDay = {
      ...plan,
      endDate: '2026-08-14',
      days: [
        day(1, '2026-08-12', [item(UUIDS[1], 'attraction', 100)]),
        day(2, '2026-08-13', [item(UUIDS[2], 'food', 50)]),
        day(3, '2026-08-14', [item(UUIDS[3], 'rest', 0)]),
      ],
      budget: budget(150, { attractionsCny: 100, foodCny: 50 }),
    };
    expect(TripPlanSchema.safeParse(threeDay).success).toBe(true);
  });

  it('accepts the fourteen-day boundary with contiguous dates', () => {
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, 12 + index));
      return day(index + 1, date.toISOString().slice(0, 10), []);
    });
    expect(
      TripPlanSchema.safeParse({
        ...plan,
        endDate: '2026-08-25',
        days,
        budget: budget(0),
      }).success,
    ).toBe(true);
  });

  it('rejects missing, duplicate, non-contiguous and out-of-order dates', () => {
    const validDays = [day(1, '2026-08-12', []), day(2, '2026-08-13', [])];
    const base = { ...plan, endDate: '2026-08-13', budget: budget(0), days: validDays };
    expect(TripPlanSchema.safeParse({ ...base, days: [validDays[0]] }).success).toBe(false);
    expect(
      TripPlanSchema.safeParse({
        ...base,
        days: [validDays[0], day(2, '2026-08-12', [])],
      }).success,
    ).toBe(false);
    expect(
      TripPlanSchema.safeParse({
        ...base,
        days: [validDays[0], day(2, '2026-08-14', [])],
      }).success,
    ).toBe(false);
    expect(
      TripPlanSchema.safeParse({
        ...base,
        days: [day(2, '2026-08-13', []), day(1, '2026-08-12', [])],
      }).success,
    ).toBe(false);
    expect(TripPlanSchema.safeParse({ ...base, endDate: '2026-08-26', days: [] }).success).toBe(
      false,
    );
  });

  it('validates time format, order, sorting and overlap', () => {
    const first = item(UUIDS[1], 'attraction', 20);
    const second = { ...item(UUIDS[2], 'food', 30), startTime: '10:00', endTime: '11:00' };
    expect(
      TripPlanSchema.safeParse({
        ...plan,
        days: [day(1, '2026-08-12', [first, second])],
        budget: budget(50, { attractionsCny: 20, foodCny: 30 }),
      }).success,
    ).toBe(true);
    expect(TripPlanItemSchema.safeParse({ ...first, startTime: '9:00' }).success).toBe(false);
    expect(TripPlanItemSchema.safeParse({ ...first, endTime: '09:00' }).success).toBe(false);
    const overlap = { ...second, startTime: '09:30', endTime: '10:30' };
    expect(
      TripPlanSchema.safeParse({
        ...plan,
        days: [day(1, '2026-08-12', [first, overlap])],
        budget: budget(50, { attractionsCny: 20, foodCny: 30 }),
      }).success,
    ).toBe(false);
    const reversed = { ...second, startTime: '08:00', endTime: '08:30' };
    expect(
      TripPlanSchema.safeParse({
        ...plan,
        days: [day(1, '2026-08-12', [first, reversed])],
        budget: budget(50, { attractionsCny: 20, foodCny: 30 }),
      }).success,
    ).toBe(false);
  });

  it('requires verified Place data for concrete POI items', () => {
    const attraction = item(UUIDS[1], 'attraction', 10);
    expect(TripPlanItemSchema.safeParse({ ...attraction, place: undefined }).success).toBe(false);
    expect(
      TripPlanItemSchema.safeParse({ ...attraction, place: { ...attraction.place, extra: true } })
        .success,
    ).toBe(false);
    expect(
      TripPlanItemSchema.safeParse({ ...attraction, dataSources: ['ai_generated'] }).success,
    ).toBe(false);
    expect(TripPlanItemSchema.safeParse(item(UUIDS[1], 'food', 10)).success).toBe(true);
    expect(TripPlanItemSchema.safeParse(item(UUIDS[1], 'rest', 0)).success).toBe(true);
  });

  it('rejects unavailable route estimates as itinerary transport data', () => {
    const unavailableRoute = {
      origin: { location: { longitude: 120.15, latitude: 30.25 } },
      destination: { location: { longitude: 120.18, latitude: 30.27 } },
      mode: 'walking' as const,
      dataSource: 'unavailable' as const,
      provider: 'fake-map',
      fetchedAt: '2026-08-11T00:00:00.000Z',
    };
    const transport = {
      ...item(UUIDS[1], 'transport', 0),
      route: unavailableRoute,
    };
    expect(TripPlanItemSchema.safeParse(transport).success).toBe(false);

    const availableRoute = {
      origin: { location: { longitude: 120.15, latitude: 30.25 } },
      destination: { location: { longitude: 120.18, latitude: 30.27 } },
      mode: 'walking' as const,
      dataSource: 'map_provider' as const,
      provider: 'fake-map',
      fetchedAt: '2026-08-11T00:00:00.000Z',
      distanceMeters: 1_200,
      durationSeconds: 600,
    };
    expect(
      TripPlanItemSchema.safeParse({
        ...item(UUIDS[1], 'transport', 0),
        route: availableRoute,
      }).success,
    ).toBe(false);
    expect(
      TripPlanItemSchema.safeParse({
        ...item(UUIDS[1], 'transport', 0),
        route: availableRoute,
        dataSources: ['route_provider', 'ai_generated'],
      }).success,
    ).toBe(true);
  });

  it('enforces daily, total and category budget conservation', () => {
    const first = item(UUIDS[1], 'attraction', 20);
    const second = { ...item(UUIDS[2], 'food', 30), startTime: '10:00', endTime: '11:00' };
    const valid = {
      ...plan,
      days: [day(1, '2026-08-12', [first, second])],
      budget: budget(50, { attractionsCny: 20, foodCny: 30 }),
    };
    expect(TripPlanSchema.safeParse(valid).success).toBe(true);
    expect(
      TripPlanSchema.safeParse({
        ...valid,
        budget: budget(51, { attractionsCny: 20, foodCny: 30, otherCny: 1 }),
      }).success,
    ).toBe(false);
    expect(
      TripPlanSchema.safeParse({
        ...valid,
        days: [day(1, '2026-08-12', [first, second])],
        budget: budget(50, { attractionsCny: 50 }),
      }).success,
    ).toBe(false);
    expect(TripPlanDaySchema.safeParse({ ...valid.days[0], estimatedCostCny: 0 }).success).toBe(
      false,
    );
    expect(TripBudgetEstimateSchema.safeParse({ ...valid.budget, other: 0 }).success).toBe(false);
  });

  it('validates warning, recommendation and strict length contracts', () => {
    expect(
      TripPlanWarningSchema.safeParse({
        code: 'WEATHER_UNAVAILABLE',
        severity: 'warning',
        message: '当天没有可用天气数据。',
        dayNumber: 1,
      }).success,
    ).toBe(true);
    expect(
      TripPlanWarningSchema.safeParse({ code: '', severity: 'warning', message: 'x' }).success,
    ).toBe(false);
    expect(
      TripPlanWarningSchema.safeParse({
        code: 'weather_unavailable',
        severity: 'warning',
        message: 'x',
      }).success,
    ).toBe(false);
    expect(
      TripPlanWarningSchema.safeParse({ code: 'x', severity: 'warning', message: 'x', extra: true })
        .success,
    ).toBe(false);

    const hotel = {
      id: UUIDS[3],
      areaName: '西湖东侧',
      description: '便于公共交通出行。',
      recommendationReason: '靠近主要行程。',
      tips: ['提前确认入住时间'],
      dataSources: ['ai_generated'] as const,
    };
    const food = {
      id: UUIDS[4],
      name: '本地菜',
      description: '适合尝试的风味。',
      recommendationReason: '符合口味偏好。',
      cuisine: '杭帮菜',
      tips: [],
      dataSources: ['ai_generated'] as const,
    };
    expect(HotelAreaRecommendationSchema.safeParse(hotel).success).toBe(true);
    expect(FoodRecommendationSchema.safeParse(food).success).toBe(true);
    expect(
      HotelAreaRecommendationSchema.safeParse({
        ...hotel,
        place: place(UUIDS[5]),
      }).success,
    ).toBe(false);
    expect(
      HotelAreaRecommendationSchema.safeParse({
        ...hotel,
        place: place(UUIDS[5]),
        dataSources: ['map_provider', 'ai_generated'],
      }).success,
    ).toBe(true);
    expect(
      FoodRecommendationSchema.safeParse({
        ...food,
        place: place(UUIDS[5], 'restaurant'),
      }).success,
    ).toBe(false);
    expect(
      FoodRecommendationSchema.safeParse({
        ...food,
        place: place(UUIDS[5], 'restaurant'),
        dataSources: ['map_provider', 'ai_generated'],
      }).success,
    ).toBe(true);
    expect(FoodRecommendationSchema.safeParse({ ...food, tips: ['x'.repeat(501)] }).success).toBe(
      false,
    );
    expect(
      TripPlanSchema.safeParse({
        ...plan,
        hotelRecommendations: [hotel],
        foodRecommendations: [food],
      }).success,
    ).toBe(true);
    expect(
      TripPlanSchema.safeParse({
        ...plan,
        transportationTips: Array.from({ length: 21 }, () => 'x'),
      }).success,
    ).toBe(false);
    expect(TripPlanSchema.safeParse({ ...plan, unknown: true }).success).toBe(false);
  });

  it('preserves unavailable weather semantics through the shared DailyWeather schema', () => {
    const unavailable = {
      date: '2026-08-12',
      condition: 'unknown' as const,
      conditionText: '暂无可用天气数据',
      source: 'unavailable' as const,
      isReference: false,
    };
    expect(
      TripPlanSchema.safeParse({ ...plan, days: [day(1, '2026-08-12', [])], budget: budget(0) })
        .success,
    ).toBe(true);
    expect(
      TripPlanSchema.safeParse({
        ...plan,
        days: [{ ...day(1, '2026-08-12', []), weather: unavailable }],
        budget: budget(0),
      }).success,
    ).toBe(true);
    expect(
      TripPlanSchema.safeParse({
        ...plan,
        days: [{ ...day(1, '2026-08-12', []), weather: { ...unavailable, minTemperatureC: 1 } }],
        budget: budget(0),
      }).success,
    ).toBe(false);
  });

  it('keeps replacement contracts strict and paginated', () => {
    const candidate = {
      place: place(UUIDS[4]),
      recommendationReason: '距离合适，且地点数据已验证',
    };
    expect(
      ListTripPlanItemReplacementCandidatesInputSchema.safeParse({
        sourceVersion: 1,
        dayNumber: 1,
        itemId: UUIDS[1],
        page: 1,
        pageSize: 20,
      }).success,
    ).toBe(true);
    expect(
      ListTripPlanItemReplacementCandidatesInputSchema.safeParse({
        sourceVersion: 1,
        dayNumber: 1,
        itemId: UUIDS[1],
        page: 0,
      }).success,
    ).toBe(false);
    expect(
      ListTripPlanItemReplacementCandidatesInputSchema.safeParse({
        sourceVersion: 1,
        dayNumber: 1,
        itemId: UUIDS[1],
        pageSize: 21,
      }).success,
    ).toBe(false);
    expect(TripPlanItemReplacementCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(
      TripPlanItemReplacementCandidateSchema.safeParse({ ...candidate, itemType: 'attraction' })
        .success,
    ).toBe(false);
    expect(
      TripPlanItemReplacementCandidateListSchema.safeParse({
        items: [candidate],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }).success,
    ).toBe(true);
    expect(
      TripPlanItemReplacementCandidateListSchema.safeParse({
        items: [candidate],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        tripId: UUIDS[0],
      }).success,
    ).toBe(false);
    expect(
      ReplaceTripPlanItemInputSchema.safeParse({
        sourceVersion: 1,
        dayNumber: 1,
        itemId: UUIDS[1],
        replacementPlaceId: UUIDS[4],
      }).success,
    ).toBe(true);
  });
});

describe('TripPlan optimization audit schemas', () => {
  it('requires measurements for available candidates and protects unavailable facts', () => {
    const valid = {
      tripId: UUIDS[0],
      version: 2,
      sourceVersion: 1,
      dayNumber: 1,
      mode: 'walking' as const,
      algorithm: 'nearest_neighbor' as const,
      isOptimal: false as const,
      orderedItemIds: [UUIDS[1], UUIDS[2]],
      decisions: [
        {
          step: 1,
          originItemId: UUIDS[1],
          selectedDestinationItemId: UUIDS[2],
          reason: 'shortest_duration' as const,
          candidates: [
            {
              destinationItemId: UUIDS[2],
              status: 'available' as const,
              durationSeconds: 120,
              distanceMeters: 500,
            },
          ],
        },
      ],
      timelineChanges: [
        {
          itemId: UUIDS[1],
          previousStartTime: '09:00',
          previousEndTime: '10:00',
          nextStartTime: '09:00',
          nextEndTime: '10:00',
          routeStatus: 'not_applicable' as const,
        },
        {
          itemId: UUIDS[2],
          previousStartTime: '10:00',
          previousEndTime: '11:00',
          nextStartTime: '10:02',
          nextEndTime: '11:02',
          routeStatus: 'available' as const,
          routeDurationSeconds: 120,
          routeDistanceMeters: 500,
        },
      ],
      warnings: ['Nearest-neighbor is deterministic but not globally optimal.'],
      generatedAt: '2026-08-11T00:00:00.000Z',
    };
    expect(GetTripPlanOptimizationAuditInputSchema.safeParse({ dayNumber: 1 }).success).toBe(true);
    expect(TripPlanOptimizationAuditResultSchema.safeParse(valid).success).toBe(true);
    expect(
      TripPlanOptimizationAuditResultSchema.safeParse({
        ...valid,
        decisions: [
          {
            ...valid.decisions[0],
            candidates: [
              { destinationItemId: UUIDS[2], status: 'unavailable', durationSeconds: 10 },
            ],
          },
        ],
      }).success,
    ).toBe(false);

    const three = {
      ...valid,
      orderedItemIds: [UUIDS[1], UUIDS[2], UUIDS[3]],
      decisions: [
        {
          step: 1,
          originItemId: UUIDS[1],
          selectedDestinationItemId: UUIDS[2],
          reason: 'shortest_duration' as const,
          candidates: [
            {
              destinationItemId: UUIDS[2],
              status: 'available' as const,
              durationSeconds: 100,
              distanceMeters: 100,
            },
            {
              destinationItemId: UUIDS[3],
              status: 'available' as const,
              durationSeconds: 200,
              distanceMeters: 200,
            },
          ],
        },
        {
          step: 2,
          originItemId: UUIDS[2],
          selectedDestinationItemId: UUIDS[3],
          reason: 'shortest_duration' as const,
          candidates: [
            {
              destinationItemId: UUIDS[3],
              status: 'available' as const,
              durationSeconds: 60,
              distanceMeters: 50,
            },
          ],
        },
      ],
      timelineChanges: [
        valid.timelineChanges[0],
        valid.timelineChanges[1],
        {
          ...valid.timelineChanges[1],
          itemId: UUIDS[3],
          previousStartTime: '11:00',
          previousEndTime: '12:00',
          nextStartTime: '11:03',
          nextEndTime: '12:03',
        },
      ],
    };
    expect(TripPlanOptimizationAuditResultSchema.safeParse(three).success).toBe(true);
    expect(
      TripPlanOptimizationAuditResultSchema.safeParse({
        ...three,
        decisions: [three.decisions[0], { ...three.decisions[1], originItemId: UUIDS[1] }],
      }).success,
    ).toBe(false);
  });
});
