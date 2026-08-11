import { describe, expect, it } from 'vitest';

import type {
  RouteEndpoint,
  RouteMatrixCell,
  RouteMatrixPoint,
  RouteMatrixResult,
} from '@travel-guide/shared-types';

import { calculateNearestNeighborOrder } from '../src/modules/routes/route-order.algorithm';

const generatedAt = '2026-08-11T00:00:00.000Z';

const points: RouteMatrixPoint[] = [
  { id: 'a', endpoint: { location: { longitude: 120.15, latitude: 30.25 } } },
  { id: 'b', endpoint: { location: { longitude: 120.18, latitude: 30.27 } } },
  { id: 'c', endpoint: { location: { longitude: 120.2, latitude: 30.29 } } },
  { id: 'd', endpoint: { location: { longitude: 120.22, latitude: 30.31 } } },
];

const endpointById = new Map(points.map((point) => [point.id, point.endpoint]));

const cell = (
  originId: string,
  destinationId: string,
  durationSeconds: number,
  distanceMeters: number,
): RouteMatrixCell => ({
  originId,
  destinationId,
  status: 'available',
  estimate: {
    origin: endpointById.get(originId) as RouteEndpoint,
    destination: endpointById.get(destinationId) as RouteEndpoint,
    mode: 'walking',
    dataSource: 'map_provider',
    provider: 'fake',
    fetchedAt: generatedAt,
    durationSeconds,
    distanceMeters,
  },
});

const matrix = (
  cells: RouteMatrixCell[],
  matrixPoints: RouteMatrixPoint[] = points,
): RouteMatrixResult => ({
  points: matrixPoints,
  mode: 'walking',
  cells,
  generatedAt,
});

describe('calculateNearestNeighborOrder', () => {
  it('uses duration, distance and id tie-breakers and preserves every point', () => {
    const result = calculateNearestNeighborOrder(
      matrix(
        [
          cell('a', 'b', 10, 100),
          cell('a', 'c', 10, 100),
          cell('a', 'd', 10, 200),
          cell('b', 'a', 1, 1),
          cell('b', 'c', 20, 1),
          cell('b', 'd', 30, 1),
          cell('c', 'a', 1, 1),
          cell('c', 'b', 1, 1),
          cell('c', 'd', 2, 1),
          cell('d', 'a', 1, 1),
          cell('d', 'b', 1, 1),
          cell('d', 'c', 1, 1),
        ],
        [points[0], points[2], points[1], points[3]],
      ),
    );

    expect(result.orderedPointIds).toEqual(['a', 'b', 'c', 'd']);
    expect(result.legs.map((leg) => `${leg.originId}->${leg.destinationId}`)).toEqual([
      'a->b',
      'b->c',
      'c->d',
    ]);
    expect(result.totalDistanceMeters).toBe(102);
    expect(result.totalDurationSeconds).toBe(32);
    expect(result.algorithm).toBe('nearest_neighbor');
    expect(result.isOptimal).toBe(false);
  });

  it('chooses a deterministic default start and keeps an explicit end last', () => {
    const result = calculateNearestNeighborOrder(
      matrix([
        cell('a', 'b', 10, 100),
        cell('a', 'c', 1, 10),
        cell('a', 'd', 1, 10),
        cell('b', 'a', 1, 1),
        cell('b', 'c', 1, 1),
        cell('b', 'd', 1, 1),
        cell('c', 'a', 1, 1),
        cell('c', 'b', 1, 1),
        cell('c', 'd', 1, 1),
        cell('d', 'a', 1, 1),
        cell('d', 'b', 1, 1),
        cell('d', 'c', 1, 1),
      ]),
      undefined,
      'd',
    );

    expect(result.orderedPointIds[0]).toBe('a');
    expect(result.orderedPointIds.at(-1)).toBe('d');
    expect(new Set(result.orderedPointIds).size).toBe(points.length);
  });

  it('skips unavailable edges when a complete order remains possible', () => {
    const result = calculateNearestNeighborOrder(
      matrix([
        { originId: 'a', destinationId: 'b', status: 'unavailable' },
        cell('a', 'c', 1, 1),
        cell('a', 'd', 5, 5),
        cell('b', 'a', 1, 1),
        cell('b', 'c', 1, 1),
        cell('b', 'd', 1, 1),
        cell('c', 'a', 1, 1),
        cell('c', 'b', 1, 1),
        cell('c', 'd', 1, 1),
        cell('d', 'a', 1, 1),
        cell('d', 'b', 1, 1),
        cell('d', 'c', 1, 1),
      ]),
    );
    expect(result.orderedPointIds).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns a stable unavailable error when no complete order exists', () => {
    expect(() =>
      calculateNearestNeighborOrder(
        matrix([
          { originId: 'a', destinationId: 'b', status: 'unavailable' },
          { originId: 'a', destinationId: 'c', status: 'unavailable' },
          cell('b', 'a', 1, 1),
          cell('b', 'c', 1, 1),
          cell('c', 'a', 1, 1),
          cell('c', 'b', 1, 1),
        ]),
      ),
    ).toThrowError(expect.objectContaining({ code: 'ROUTE_ORDER_UNAVAILABLE' }));
  });
});
