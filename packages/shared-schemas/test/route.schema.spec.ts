import { describe, expect, it } from 'vitest';

import {
  EstimateRouteInputSchema,
  EstimateRouteMatrixInputSchema,
  EstimateRouteOrderInputSchema,
  RouteEstimateSchema,
  RouteMatrixResultSchema,
  RouteOrderResultSchema,
} from '../src/route.schema';

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

  it('validates matrix point count, ids, normalized coordinates and unknown fields', () => {
    const points = [
      { id: 'start', endpoint: input.origin },
      { id: 'finish', endpoint: input.destination },
    ];
    expect(EstimateRouteMatrixInputSchema.safeParse({ points, mode: 'walking' }).success).toBe(
      true,
    );
    expect(
      EstimateRouteMatrixInputSchema.safeParse({
        points: [{ ...points[0], id: ' start ' }, points[1]],
        mode: 'walking',
      }).success,
    ).toBe(true);
    expect(
      EstimateRouteMatrixInputSchema.safeParse({
        points: [
          { ...points[0], id: 'same' },
          { ...points[1], id: 'same' },
        ],
        mode: 'walking',
      }).success,
    ).toBe(false);
    expect(
      EstimateRouteMatrixInputSchema.safeParse({
        points: [
          points[0],
          {
            ...points[1],
            endpoint: {
              location: { longitude: 120.1500004, latitude: 30.2500004 },
            },
          },
        ],
        mode: 'walking',
      }).success,
    ).toBe(false);
    expect(
      EstimateRouteMatrixInputSchema.safeParse({ points, mode: 'walking', extra: true }).success,
    ).toBe(false);
    expect(
      EstimateRouteMatrixInputSchema.safeParse({
        points: Array.from({ length: 11 }, (_, index) => ({
          id: `p-${index}`,
          endpoint: {
            location: { longitude: 120 + index / 100, latitude: 30 + index / 100 },
          },
        })),
        mode: 'walking',
      }).success,
    ).toBe(false);
  });

  it('requires every directed non-diagonal matrix cell and protects unavailable cells', () => {
    const points = [
      { id: 'start', endpoint: input.origin },
      { id: 'finish', endpoint: input.destination },
    ];
    const estimate = {
      ...input,
      dataSource: 'map_provider' as const,
      provider: 'amap',
      fetchedAt: '2026-08-11T00:00:00.000Z',
      distanceMeters: 1_234,
      durationSeconds: 600,
    };
    const result = {
      points,
      mode: 'walking' as const,
      generatedAt: '2026-08-11T00:00:00.000Z',
      cells: [
        { originId: 'start', destinationId: 'finish', status: 'available' as const, estimate },
        { originId: 'finish', destinationId: 'start', status: 'unavailable' as const },
      ],
    };
    expect(RouteMatrixResultSchema.safeParse(result).success).toBe(true);
    expect(
      RouteMatrixResultSchema.safeParse({
        ...result,
        cells: [
          { originId: 'start', destinationId: 'finish', status: 'unavailable' as const },
          {
            originId: 'finish',
            destinationId: 'start',
            status: 'unavailable' as const,
            estimate,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      RouteMatrixResultSchema.safeParse({
        ...result,
        cells: [result.cells[0]],
      }).success,
    ).toBe(false);
    expect(
      RouteMatrixResultSchema.safeParse({
        ...result,
        cells: [
          ...result.cells,
          { originId: 'start', destinationId: 'start', status: 'unavailable' as const },
        ],
      }).success,
    ).toBe(false);
  });

  it('validates route-order inputs and strict deterministic results', () => {
    const points = [
      { id: 'a', endpoint: input.origin },
      { id: 'b', endpoint: input.destination },
    ];
    expect(
      EstimateRouteOrderInputSchema.safeParse({ points, mode: 'walking', startId: 'a', endId: 'b' })
        .success,
    ).toBe(true);
    expect(
      EstimateRouteOrderInputSchema.safeParse({ points, mode: 'walking', startId: 'missing' })
        .success,
    ).toBe(false);
    expect(
      EstimateRouteOrderInputSchema.safeParse({ points, mode: 'walking', startId: 'a', endId: 'a' })
        .success,
    ).toBe(false);
    expect(
      EstimateRouteOrderInputSchema.safeParse({ points, mode: 'walking', unexpected: true })
        .success,
    ).toBe(false);

    const estimate = {
      ...input,
      dataSource: 'map_provider' as const,
      provider: 'amap',
      fetchedAt: '2026-08-11T00:00:00.000Z',
      distanceMeters: 1_234,
      durationSeconds: 600,
    };
    const result = {
      orderedPointIds: ['a', 'b'],
      legs: [{ originId: 'a', destinationId: 'b', estimate }],
      totalDistanceMeters: 1_234,
      totalDurationSeconds: 600,
      mode: 'walking' as const,
      algorithm: 'nearest_neighbor' as const,
      isOptimal: false as const,
      generatedAt: '2026-08-11T00:00:00.000Z',
      warnings: ['Nearest-neighbor ordering is deterministic but not globally optimal.'],
    };
    expect(RouteOrderResultSchema.safeParse(result).success).toBe(true);
    expect(RouteOrderResultSchema.safeParse({ ...result, isOptimal: true }).success).toBe(false);
    expect(RouteOrderResultSchema.safeParse({ ...result, totalDistanceMeters: 999 }).success).toBe(
      false,
    );
    expect(
      RouteOrderResultSchema.safeParse({ ...result, legs: [{ ...result.legs[0], extra: true }] })
        .success,
    ).toBe(false);
  });
});
