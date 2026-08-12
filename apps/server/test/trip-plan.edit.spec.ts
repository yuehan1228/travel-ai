import { describe, expect, it } from 'vitest';

import { TripPlanSchema } from '@travel-guide/shared-schemas';
import type { TripPlan } from '@travel-guide/shared-types';

import { applyTripPlanEdits, TripPlanEditError } from '../src/modules/trip-plan/trip-plan-edit';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const itemId = '223e4567-e89b-12d3-a456-426614174000';
const generatedAt = '2026-08-11T00:00:00.000Z';

const makePlan = (): TripPlan =>
  TripPlanSchema.parse({
    schemaVersion: '1.0',
    tripId,
    cityName: '杭州',
    startDate: '2026-08-12',
    endDate: '2026-08-12',
    travelerCount: 2,
    summary: '原始摘要',
    days: [
      {
        dayNumber: 1,
        date: '2026-08-12',
        summary: '原始一天',
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
            tips: ['慢慢来'],
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
  });

describe('applyTripPlanEdits', () => {
  it('applies controlled fields immutably and recomputes costs', () => {
    const source = makePlan();
    const result = applyTripPlanEdits(
      source,
      {
        sourceVersion: 1,
        summary: '更新摘要',
        dayEdits: [
          { dayNumber: 1, warnings: [{ code: 'RAIN', severity: 'warning', message: '带伞' }] },
        ],
        itemEdits: [
          {
            dayNumber: 1,
            itemId,
            recommendationReason: '更适合当前节奏',
            estimatedCostCny: 25,
          },
        ],
      },
      '2026-08-12T00:00:00.000Z',
    );
    expect(result.summary).toBe('更新摘要');
    expect(result.days[0]?.warnings[0]).toEqual({
      code: 'RAIN',
      severity: 'warning',
      message: '带伞',
    });
    expect(result.days[0]?.items[0]?.recommendationReason).toBe('更适合当前节奏');
    expect(result.days[0]?.estimatedCostCny).toBe(25);
    expect(result.budget.totalCny).toBe(25);
    expect(source.summary).toBe('原始摘要');
    expect(source.days[0]?.items[0]?.estimatedCostCny).toBe(10);
  });

  it('returns stable errors for missing entities and no-op edits', () => {
    const source = makePlan();
    expect(() =>
      applyTripPlanEdits(source, {
        sourceVersion: 1,
        dayEdits: [{ dayNumber: 2, summary: '不存在' }],
      }),
    ).toThrowError(TripPlanEditError);
    try {
      applyTripPlanEdits(source, {
        sourceVersion: 1,
        itemEdits: [
          {
            dayNumber: 1,
            itemId: '323e4567-e89b-12d3-a456-426614174000',
            description: '不存在',
          },
        ],
      });
      throw new Error('expected item error');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'TRIP_PLAN_ENTITY_MISMATCH' });
    }
    expect(() =>
      applyTripPlanEdits(source, {
        sourceVersion: 1,
        summary: '原始摘要',
      }),
    ).toThrow('does not change');
  });
});
