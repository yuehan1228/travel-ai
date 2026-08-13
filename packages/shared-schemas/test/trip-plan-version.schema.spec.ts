import { describe, expect, it } from 'vitest';

import {
  GenerateTripPlanInputSchema,
  EditTripPlanInputSchema,
  EditTripPlanResultSchema,
  ReorderTripPlanItemsInputSchema,
  RegenerateTripPlanDayInputSchema,
  RegenerateTripPlanDayResultSchema,
  TripPlanGenerationResultSchema,
  TripPlanVersionListResultSchema,
  TripPlanVersionSummarySchema,
} from '../src';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const versionId = '223e4567-e89b-12d3-a456-426614174000';
const timestamp = '2026-08-11T00:00:00.000Z';

const summary = {
  id: versionId,
  tripId,
  version: 1,
  schemaVersion: '1.0' as const,
  status: 'failed' as const,
  generatedAt: timestamp,
  createdAt: timestamp,
};

describe('TripPlan version contracts', () => {
  it('requires the complete orderedItemIds permutation and rejects the legacy field', () => {
    const orderedItemIds = [
      '323e4567-e89b-12d3-a456-426614174000',
      '423e4567-e89b-12d3-a456-426614174000',
    ];
    expect(
      ReorderTripPlanItemsInputSchema.parse({ sourceVersion: 1, dayNumber: 1, orderedItemIds }),
    ).toEqual({ sourceVersion: 1, dayNumber: 1, orderedItemIds });
    expect(
      ReorderTripPlanItemsInputSchema.safeParse({
        sourceVersion: 1,
        dayNumber: 1,
        itemIds: orderedItemIds,
      }).success,
    ).toBe(false);
    expect(
      ReorderTripPlanItemsInputSchema.safeParse({
        sourceVersion: 1,
        dayNumber: 1,
        orderedItemIds: [orderedItemIds[0], orderedItemIds[0]],
      }).success,
    ).toBe(false);
  });

  it('accepts only the controlled edit whitelist and rejects duplicates/unknown fields', () => {
    const itemId = '323e4567-e89b-12d3-a456-426614174000';
    const valid = {
      sourceVersion: 1,
      summary: '  更新摘要  ',
      dayEdits: [
        {
          dayNumber: 1,
          warnings: [{ code: 'RAIN', severity: 'warning', message: '  提醒  ' }],
        },
      ],
      itemEdits: [
        {
          dayNumber: 1,
          itemId,
          recommendationReason: '  更适合当前节奏  ',
          tips: ['小贴士'],
        },
      ],
    };
    expect(EditTripPlanInputSchema.parse(valid)).toEqual({
      sourceVersion: 1,
      summary: '更新摘要',
      dayEdits: [
        {
          dayNumber: 1,
          warnings: [{ code: 'RAIN', severity: 'warning', message: '提醒' }],
        },
      ],
      itemEdits: [
        {
          dayNumber: 1,
          itemId,
          recommendationReason: '更适合当前节奏',
          tips: ['小贴士'],
        },
      ],
    });
    expect(EditTripPlanInputSchema.safeParse({ sourceVersion: 1 }).success).toBe(false);
    expect(
      EditTripPlanInputSchema.safeParse({
        ...valid,
        dayEdits: [
          { dayNumber: 1, summary: 'a' },
          { dayNumber: 1, summary: 'b' },
        ],
      }).success,
    ).toBe(false);
    expect(
      EditTripPlanInputSchema.safeParse({
        ...valid,
        itemEdits: [
          { dayNumber: 1, itemId, description: 'a' },
          { dayNumber: 1, itemId, description: 'b' },
        ],
      }).success,
    ).toBe(false);
    expect(
      EditTripPlanInputSchema.safeParse({
        sourceVersion: 1,
        itemEdits: [
          { dayNumber: 1, itemId, description: '第一天' },
          { dayNumber: 2, itemId, description: '第二天' },
        ],
      }).success,
    ).toBe(true);
    expect(EditTripPlanInputSchema.safeParse({ ...valid, place: {} }).success).toBe(false);
    expect(
      EditTripPlanInputSchema.safeParse({
        sourceVersion: 1,
        dayEdits: [{ dayNumber: 1, estimatedCostCny: 1 }],
      }).success,
    ).toBe(false);
    expect(
      EditTripPlanInputSchema.safeParse({
        sourceVersion: 1,
        itemEdits: [{ dayNumber: 1, itemId, name: '禁止' }],
      }).success,
    ).toBe(false);
    expect(
      EditTripPlanInputSchema.safeParse({
        sourceVersion: 1,
        dayEdits: [{ dayNumber: 1, warnings: ['不是结构化 warning'] }],
      }).success,
    ).toBe(false);
  });

  it('requires a newer ready result whose snapshot matches the summary', () => {
    const plan = {
      schemaVersion: '1.0' as const,
      tripId,
      cityName: '杭州',
      startDate: '2026-08-12',
      endDate: '2026-08-12',
      travelerCount: 2,
      summary: '摘要',
      days: [
        {
          dayNumber: 1,
          date: '2026-08-12',
          summary: '第一天',
          weather: {
            date: '2026-08-12',
            condition: 'clear' as const,
            conditionText: '晴',
            source: 'forecast' as const,
            isReference: false,
          },
          items: [],
          estimatedCostCny: 0,
          warnings: [],
        },
      ],
      hotelRecommendations: [],
      foodRecommendations: [],
      budget: {
        currency: 'CNY' as const,
        totalCny: 0,
        accommodationCny: 0,
        transportationCny: 0,
        foodCny: 0,
        attractionsCny: 0,
        otherCny: 0,
      },
      transportationTips: [],
      generalTips: [],
      generatedAt: timestamp,
    };
    const result = {
      tripId,
      sourceVersion: 1,
      version: 2,
      status: 'ready' as const,
      plan,
      summary: { ...summary, version: 2, status: 'ready' as const },
    };
    expect(EditTripPlanResultSchema.safeParse(result).success).toBe(true);
    expect(EditTripPlanResultSchema.safeParse({ ...result, version: 1 }).success).toBe(false);
  });

  it('accepts only an empty generation input', () => {
    expect(GenerateTripPlanInputSchema.parse({})).toEqual({});
    expect(GenerateTripPlanInputSchema.safeParse({ model: 'gpt' }).success).toBe(false);
    expect(GenerateTripPlanInputSchema.safeParse({ provider: 'secret' }).success).toBe(false);
    expect(GenerateTripPlanInputSchema.safeParse({ places: [] }).success).toBe(false);
  });

  it('normalizes strict single-day regeneration input', () => {
    expect(
      RegenerateTripPlanDayInputSchema.parse({
        sourceVersion: 2,
        dayNumber: 3,
        instruction: '  更轻松一些  ',
      }),
    ).toEqual({ sourceVersion: 2, dayNumber: 3, instruction: '更轻松一些' });
    expect(RegenerateTripPlanDayInputSchema.parse({ sourceVersion: 1, dayNumber: 1 })).toEqual({
      sourceVersion: 1,
      dayNumber: 1,
    });
    expect(
      RegenerateTripPlanDayInputSchema.safeParse({
        sourceVersion: 0,
        dayNumber: 1,
      }).success,
    ).toBe(false);
    expect(
      RegenerateTripPlanDayInputSchema.safeParse({
        sourceVersion: 1,
        dayNumber: 1,
        instruction: 'x'.repeat(501),
      }).success,
    ).toBe(false);
    expect(
      RegenerateTripPlanDayInputSchema.safeParse({
        sourceVersion: 1,
        dayNumber: 1,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('validates UUIDs, positive integer versions and strict summaries', () => {
    expect(TripPlanVersionSummarySchema.parse(summary)).toEqual(summary);
    expect(TripPlanVersionSummarySchema.safeParse({ ...summary, version: 0 }).success).toBe(false);
    expect(TripPlanVersionSummarySchema.safeParse({ ...summary, id: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(TripPlanVersionSummarySchema.safeParse({ ...summary, unexpected: true }).success).toBe(
      false,
    );
  });

  it('keeps failed results free of plan snapshots and accepts version lists', () => {
    const readySummary = { ...summary, status: 'ready' as const };
    expect(
      TripPlanGenerationResultSchema.safeParse({
        version: 1,
        status: 'failed',
        summary,
        tripId,
      }).success,
    ).toBe(true);
    expect(
      TripPlanGenerationResultSchema.safeParse({
        version: 1,
        status: 'failed',
        summary,
        plan: {},
      }).success,
    ).toBe(false);
    expect(
      TripPlanVersionListResultSchema.safeParse({ items: [readySummary], latestVersion: 1 })
        .success,
    ).toBe(false);
    expect(
      TripPlanVersionListResultSchema.safeParse({
        items: [readySummary, readySummary],
        latestVersion: 1,
      }).success,
    ).toBe(false);
  });

  it('keeps day regeneration results strict and tied to their summary', () => {
    const result = {
      version: 2,
      status: 'failed' as const,
      summary: { ...summary, version: 2 },
      tripId,
      sourceVersion: 1,
      dayNumber: 2,
    };
    expect(RegenerateTripPlanDayResultSchema.safeParse(result).success).toBe(true);
    expect(
      RegenerateTripPlanDayResultSchema.safeParse({ ...result, unexpected: true }).success,
    ).toBe(false);
  });
});
