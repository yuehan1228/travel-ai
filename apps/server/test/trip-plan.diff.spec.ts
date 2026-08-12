import { describe, expect, it } from 'vitest';

import {
  RestoreTripPlanVersionResultSchema,
  TripPlanSchema,
  TripPlanVersionDiffInputSchema,
  TripPlanVersionDiffResultSchema,
} from '@travel-guide/shared-schemas';
import type { TripPlan } from '@travel-guide/shared-types';

import { compareTripPlanVersions } from '../src/modules/trip-plan/trip-plan-diff';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const itemId = '223e4567-e89b-12d3-a456-426614174000';
const generatedAt = '2026-08-11T00:00:00.000Z';
const place = {
  id: '423e4567-e89b-12d3-a456-426614174000',
  provider: 'fake-map',
  providerPlaceId: 'poi-1',
  name: '西湖',
  category: 'attraction' as const,
  categoryText: '景点',
  address: '杭州市西湖区',
  location: { longitude: 120.15, latitude: 30.25 },
  verifiedAt: generatedAt,
  dataSource: 'map_provider' as const,
};
const route = {
  origin: { location: { longitude: 120.15, latitude: 30.25 }, placeId: itemId },
  destination: { location: { longitude: 120.16, latitude: 30.26 }, placeId: place.id },
  mode: 'walking' as const,
  distanceMeters: 100,
  durationSeconds: 200,
  dataSource: 'map_provider' as const,
  provider: 'fake-route',
  fetchedAt: generatedAt,
};

const makePlan = (overrides: Partial<TripPlan> = {}): TripPlan =>
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
            type: 'rest',
            startTime: '09:00',
            endTime: '10:00',
            name: '自由活动',
            description: '适度休息',
            recommendationReason: '保持轻松节奏',
            estimatedCostCny: 10,
            tips: [],
            dataSources: ['ai_generated'],
          },
        ],
        estimatedCostCny: 10,
        warnings: [],
      },
    ],
    hotelRecommendations: [],
    foodRecommendations: [],
    budget: {
      currency: 'CNY',
      totalCny: 10,
      accommodationCny: 0,
      transportationCny: 0,
      foodCny: 0,
      attractionsCny: 0,
      otherCny: 10,
    },
    transportationTips: [],
    generalTips: [],
    generatedAt,
    ...overrides,
  });

describe('TripPlan version diff', () => {
  it('accepts only distinct positive version numbers and rejects unknown fields', () => {
    expect(TripPlanVersionDiffInputSchema.safeParse({ fromVersion: 1, toVersion: 2 }).success).toBe(
      true,
    );
    expect(TripPlanVersionDiffInputSchema.safeParse({ fromVersion: 1, toVersion: 1 }).success).toBe(
      false,
    );
    expect(
      TripPlanVersionDiffInputSchema.safeParse({ fromVersion: 1, toVersion: 2, extra: true })
        .success,
    ).toBe(false);
  });

  it('ignores generatedAt but reports sorted day, item and budget changes', () => {
    const from = makePlan();
    const to = makePlan({
      generatedAt: '2026-08-12T00:00:00.000Z',
      days: [
        {
          ...from.days[0]!,
          summary: '调整后的第一天',
          estimatedCostCny: 12,
          items: [{ ...from.days[0]!.items[0]!, description: '新的描述', estimatedCostCny: 12 }],
        },
      ],
      budget: { ...from.budget, totalCny: 12, otherCny: 12 },
    });
    const diff = compareTripPlanVersions(from, to);
    expect(diff.hasChanges).toBe(true);
    expect(diff.dayChanges[0]?.changedFields).toEqual(['estimatedCostCny', 'items', 'summary']);
    expect(diff.dayChanges[0]?.itemChanges[0]).toMatchObject({
      itemId,
      changeType: 'modified',
      changedFields: ['description', 'estimatedCostCny'],
    });
    expect(diff.budgetDiff?.changedFields).toEqual(['otherCny', 'totalCny']);
    expect(TripPlanVersionDiffResultSchema.safeParse(diff).success).toBe(true);
  });

  it('distinguishes added and removed items without fabricating values', () => {
    const from = makePlan();
    const addedId = '323e4567-e89b-12d3-a456-426614174000';
    const added = { ...from.days[0]!.items[0]!, id: addedId };
    const to = makePlan({ days: [{ ...from.days[0]!, items: [added] }] });
    const changes = compareTripPlanVersions(from, to).dayChanges[0]?.itemChanges ?? [];
    expect(changes.map((change) => [change.itemId, change.changeType])).toEqual([
      [itemId, 'removed'],
      [addedId, 'added'],
    ]);
    expect(changes.every((change) => change.changedFields.length === 0)).toBe(true);
  });

  it('reports complete weather, POI and route value changes under their controlled fields', () => {
    const from = makePlan({
      days: [
        {
          ...makePlan().days[0]!,
          items: [
            {
              ...makePlan().days[0]!.items[0]!,
              place,
              route,
              dataSources: ['map_provider', 'route_provider'],
            },
          ],
        },
      ],
    });
    const to = makePlan({
      days: [
        {
          ...from.days[0]!,
          weather: { ...from.days[0]!.weather, conditionText: '多云' },
          items: [
            {
              ...from.days[0]!.items[0]!,
              place: { ...place, name: '灵隐寺' },
              route: { ...route, durationSeconds: 260 },
            },
          ],
        },
      ],
    });
    const diff = compareTripPlanVersions(from, to);
    expect(diff.dayChanges[0]?.changedFields).toEqual(['items', 'weather']);
    expect(diff.dayChanges[0]?.itemChanges[0]?.changedFields).toEqual(['place', 'route']);
  });

  it('reports root recommendations and tips in stable field order', () => {
    const from = makePlan();
    const to = makePlan({
      hotelRecommendations: [
        {
          id: '523e4567-e89b-12d3-a456-426614174000',
          areaName: '西湖边',
          description: '便于出行',
          recommendationReason: '交通方便',
          tips: [],
          dataSources: ['ai_generated'],
        },
      ],
      foodRecommendations: [
        {
          id: '623e4567-e89b-12d3-a456-426614174000',
          name: '本地菜',
          description: '家常风味',
          recommendationReason: '适合尝鲜',
          tips: [],
          dataSources: ['ai_generated'],
        },
      ],
      transportationTips: ['优先公共交通'],
      generalTips: ['注意休息'],
    });
    const diff = compareTripPlanVersions(from, to);
    expect(diff.dayChanges[0]).toEqual({
      dayNumber: 0,
      changedFields: [
        'foodRecommendations',
        'generalTips',
        'hotelRecommendations',
        'transportationTips',
      ],
      itemChanges: [],
    });
  });

  it('requires a restored version to be strictly newer than its source', () => {
    const plan = makePlan();
    const summary = {
      id: '723e4567-e89b-12d3-a456-426614174000',
      tripId,
      version: 2,
      schemaVersion: '1.0' as const,
      status: 'ready' as const,
      generatedAt: plan.generatedAt,
      createdAt: generatedAt,
    };
    const result = {
      tripId,
      sourceVersion: 1,
      version: 2,
      status: 'ready' as const,
      plan,
      summary,
    };
    expect(RestoreTripPlanVersionResultSchema.safeParse(result).success).toBe(true);
    expect(
      RestoreTripPlanVersionResultSchema.safeParse({
        ...result,
        version: 1,
        summary: { ...summary, version: 1 },
      }).success,
    ).toBe(false);
    expect(
      RestoreTripPlanVersionResultSchema.safeParse({
        ...result,
        version: 0,
        summary: { ...summary, version: 0 },
      }).success,
    ).toBe(false);
  });
});
