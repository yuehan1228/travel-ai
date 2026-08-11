import { describe, expect, it } from 'vitest';

import { EstimateRouteInputSchema, RouteEstimateSchema } from '../src/route.schema';

const input = {
  origin: { location: { longitude: 120.15, latitude: 30.25 }, placeId: 'origin-poi' },
  destination: { location: { longitude: 120.18, latitude: 30.27 } },
  mode: 'walking' as const,
};

const available = {
  ...input,
  distanceMeters: 1_234,
  durationSeconds: 600,
  tollsCny: 1.25,
  dataSource: 'map_provider' as const,
  provider: 'amap',
  fetchedAt: '2026-08-11T00:00:00.000Z',
};

describe('route schemas', () => {
  it.each(['walking', 'driving'] as const)('accepts %s input', (mode) => {
    expect(EstimateRouteInputSchema.safeParse({ ...input, mode }).success).toBe(true);
  });

  it('rejects invalid coordinates, same endpoints and unknown fields', () => {
    expect(
      EstimateRouteInputSchema.safeParse({
        ...input,
        origin: { ...input.origin, location: { longitude: 181, latitude: 30 } },
      }).success,
    ).toBe(false);
    expect(
      EstimateRouteInputSchema.safeParse({
        ...input,
        destination: input.origin,
      }).success,
    ).toBe(false);
    expect(EstimateRouteInputSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });

  it('rejects invalid distance, duration, tolls and unknown fields', () => {
    expect(RouteEstimateSchema.safeParse({ ...available, distanceMeters: -1 }).success).toBe(false);
    expect(
      RouteEstimateSchema.safeParse({ ...available, durationSeconds: Number.NaN }).success,
    ).toBe(false);
    expect(RouteEstimateSchema.safeParse({ ...available, tollsCny: 1.001 }).success).toBe(false);
    expect(RouteEstimateSchema.safeParse({ ...available, unexpected: true }).success).toBe(false);
  });

  it('does not allow fabricated unavailable measurements', () => {
    const unavailable = {
      origin: input.origin,
      destination: input.destination,
      mode: 'walking' as const,
      dataSource: 'unavailable' as const,
      provider: 'amap',
      fetchedAt: '2026-08-11T00:00:00.000Z',
    };
    expect(RouteEstimateSchema.safeParse(unavailable).success).toBe(true);
    expect(RouteEstimateSchema.safeParse({ ...unavailable, distanceMeters: 1 }).success).toBe(
      false,
    );
    expect(RouteEstimateSchema.safeParse({ ...unavailable, durationSeconds: 1 }).success).toBe(
      false,
    );
    expect(RouteEstimateSchema.safeParse({ ...unavailable, tollsCny: 0 }).success).toBe(false);
  });
});
