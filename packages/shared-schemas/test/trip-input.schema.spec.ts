import { describe, expect, it } from 'vitest';

import { TRAVEL_PREFERENCES } from '@travel-guide/shared-types';

import { CreateTripInputSchema, TripBudgetInputSchema } from '../src';

const baseTripInput = {
  destination: {
    cityName: ' Shanghai ',
    cityCode: ' SHA ',
  },
  origin: ' Beijing ',
  startDate: '2026-03-01',
  endDate: '2026-03-03',
  travelerCount: 2,
  preferences: ['food', 'city_walk'],
  pace: 'moderate',
  transportPreference: 'public_transport',
  extraRequirements: '  Prefer a quiet hotel.  ',
};

describe('CreateTripInputSchema', () => {
  it('accepts a three-day trip with each level budget', () => {
    for (const level of ['economy', 'comfortable', 'premium'] as const) {
      const result = CreateTripInputSchema.safeParse({
        ...baseTripInput,
        budget: { type: 'level', level, currency: 'CNY' },
      });

      expect(result.success).toBe(true);
    }
  });

  it('accepts a custom budget and normalizes surrounding whitespace', () => {
    const result = CreateTripInputSchema.safeParse({
      ...baseTripInput,
      budget: { type: 'custom', totalCny: 1234.56, currency: 'CNY' },
      origin: '  Beijing  ',
      extraRequirements: '  A room with a view.  ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.destination).toEqual({ cityName: 'Shanghai', cityCode: 'SHA' });
      expect(result.data.origin).toBe('Beijing');
      expect(result.data.extraRequirements).toBe('A room with a view.');
    }
  });

  it('accepts missing optional fields and an itinerary lasting one day', () => {
    const result = CreateTripInputSchema.safeParse({
      destination: { cityName: 'Shanghai' },
      startDate: '2026-03-01',
      endDate: '2026-03-01',
      travelerCount: baseTripInput.travelerCount,
      preferences: baseTripInput.preferences,
      pace: baseTripInput.pace,
      transportPreference: baseTripInput.transportPreference,
    });

    expect(result.success).toBe(true);
  });

  it('accepts the maximum fourteen-day inclusive trip', () => {
    const result = CreateTripInputSchema.safeParse({
      ...baseTripInput,
      startDate: '2026-03-01',
      endDate: '2026-03-14',
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ['an invalid date format', { startDate: '2026/03/01' }],
    ['a non-existent calendar date', { startDate: '2026-02-30' }],
    ['an end date before the start date', { startDate: '2026-03-03', endDate: '2026-03-01' }],
    ['a trip longer than fourteen days', { startDate: '2026-03-01', endDate: '2026-03-15' }],
    ['zero travelers', { travelerCount: 0 }],
    ['more than twenty travelers', { travelerCount: 21 }],
    ['a fractional traveler count', { travelerCount: 1.5 }],
    ['an empty preference list', { preferences: [] }],
    ['duplicate preferences', { preferences: ['food', 'food'] }],
    ['an unknown preference', { preferences: ['not_a_preference'] }],
    ['an overlong extra requirement', { extraRequirements: 'x'.repeat(1001) }],
  ])('rejects %s', (_description, override) => {
    expect(CreateTripInputSchema.safeParse({ ...baseTripInput, ...override }).success).toBe(false);
  });

  it('rejects custom budgets outside the amount rules', () => {
    for (const totalCny of [0, -1, 10_000_001, 12.345]) {
      expect(
        TripBudgetInputSchema.safeParse({ type: 'custom', totalCny, currency: 'CNY' }).success,
      ).toBe(false);
    }
  });

  it('rejects malformed discriminated budgets', () => {
    expect(TripBudgetInputSchema.safeParse({ type: 'custom', currency: 'CNY' }).success).toBe(
      false,
    );
    expect(
      TripBudgetInputSchema.safeParse({
        type: 'level',
        level: 'economy',
        currency: 'CNY',
        totalCny: 100,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields and normalizes empty optional strings', () => {
    expect(CreateTripInputSchema.safeParse({ ...baseTripInput, unexpected: true }).success).toBe(
      false,
    );

    const result = CreateTripInputSchema.safeParse({
      ...baseTripInput,
      origin: '   ',
      extraRequirements: '',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.origin).toBeUndefined();
      expect(result.data.extraRequirements).toBeUndefined();
    }
  });

  it('uses the shared preference constants as the complete preference vocabulary', () => {
    expect(TRAVEL_PREFERENCES).toHaveLength(14);
    expect(
      CreateTripInputSchema.safeParse({
        ...baseTripInput,
        preferences: [...TRAVEL_PREFERENCES],
      }).success,
    ).toBe(true);
  });
});
