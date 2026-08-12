import { describe, expect, it } from 'vitest';

import {
  GenerateTripPlanInputSchema,
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
