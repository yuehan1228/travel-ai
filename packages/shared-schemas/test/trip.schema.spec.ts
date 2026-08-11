import { describe, expect, it } from 'vitest';

import {
  ListTripsInputSchema,
  TripDetailSchema,
  TripListResultSchema,
  TripSummarySchema,
  UpdateTripInputSchema,
} from '../src';

const updateInput = { travelerCount: 3 };
const summary = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  status: 'draft' as const,
  destination: { cityName: '杭州' },
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  travelerCount: 2,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};
const detail = {
  ...summary,
  preferences: ['nature' as const],
  pace: 'relaxed' as const,
  transportPreference: 'public_transport' as const,
};

describe('Trip API schemas', () => {
  it('accepts a valid update and rejects empty/unknown updates', () => {
    expect(UpdateTripInputSchema.safeParse(updateInput).success).toBe(true);
    expect(UpdateTripInputSchema.safeParse({}).success).toBe(false);
    expect(UpdateTripInputSchema.safeParse({ status: 'ready' }).success).toBe(false);
    expect(UpdateTripInputSchema.safeParse({ travelerCount: 3, unknown: true }).success).toBe(
      false,
    );
  });

  it('validates strict summary, detail and paginated list responses', () => {
    expect(TripSummarySchema.safeParse(summary).success).toBe(true);
    expect(TripDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      TripListResultSchema.safeParse({
        items: [summary],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }).success,
    ).toBe(true);
    expect(TripSummarySchema.safeParse({ ...summary, id: 'not-a-uuid' }).success).toBe(false);
  });

  it('normalizes list defaults and rejects pagination boundaries', () => {
    expect(ListTripsInputSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(ListTripsInputSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(ListTripsInputSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(ListTripsInputSchema.safeParse({ page: 1.5 }).success).toBe(false);
  });
});
