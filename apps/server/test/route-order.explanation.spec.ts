import { describe, expect, it } from 'vitest';

import type {
  RouteEndpoint,
  RouteMatrixCell,
  RouteMatrixPoint,
  RouteMatrixResult,
} from '@travel-guide/shared-types';

import {
  calculateNearestNeighborOrder,
  calculateNearestNeighborOrderWithExplanation,
  RouteOrderAlgorithmError,
} from '../src/modules/routes/route-order.algorithm';

const generatedAt = '2026-08-11T00:00:00.000Z';
const points: RouteMatrixPoint[] = [
  { id: 'a', endpoint: { location: { longitude: 120.15, latitude: 30.25 } } },
  { id: 'b', endpoint: { location: { longitude: 120.18, latitude: 30.27 } } },
  { id: 'c', endpoint: { location: { longitude: 120.2, latitude: 30.29 } } },
  { id: 'd', endpoint: { location: { longitude: 120.22, latitude: 30.31 } } },
];
const endpointById = new Map(points.map((point) => [point.id, point.endpoint]));

const availableCell = (
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

const matrixWith = (overrides: Map<string, RouteMatrixCell>): RouteMatrixResult => {
  const cells: RouteMatrixCell[] = [];
  for (const origin of points) {
    for (const destination of points) {
      if (origin.id === destination.id) continue;
      const key = `${origin.id}->${destination.id}`;
      cells.push(overrides.get(key) ?? availableCell(origin.id, destination.id, 50, 500));
    }
  }
  return { points, mode: 'walking', cells, generatedAt };
};

describe('nearest-neighbor route-order explanations', () => {
  it('reports duration, distance and destination-id tie-break reasons', () => {
    const result = calculateNearestNeighborOrderWithExplanation(
      matrixWith(
        new Map([
          ['a->b', availableCell('a', 'b', 10, 200)],
          ['a->c', availableCell('a', 'c', 10, 100)],
          ['a->d', availableCell('a', 'd', 20, 100)],
          ['c->b', availableCell('c', 'b', 10, 100)],
          ['c->d', availableCell('c', 'd', 10, 100)],
        ]),
      ),
    );

    expect(result.order.orderedPointIds).toEqual(['a', 'c', 'b', 'd']);
    expect(result.decisions.map((decision) => decision.reason)).toEqual([
      'shortest_distance_tiebreaker',
      'destination_id_tiebreaker',
      'shortest_duration',
    ]);
    expect(result.decisions[0]?.candidates).toEqual(
      expect.arrayContaining([
        { destinationId: 'b', status: 'available', durationSeconds: 10, distanceMeters: 200 },
        { destinationId: 'c', status: 'available', durationSeconds: 10, distanceMeters: 100 },
      ]),
    );
  });

  it('reports fixed-end decisions and unavailable candidates without measurements', () => {
    const matrix = matrixWith(
      new Map([
        ['a->b', { originId: 'a', destinationId: 'b', status: 'unavailable' }],
        ['a->c', availableCell('a', 'c', 10, 100)],
        ['a->d', availableCell('a', 'd', 20, 200)],
        ['c->b', availableCell('c', 'b', 10, 100)],
        ['c->d', availableCell('c', 'd', 10, 100)],
        ['b->d', availableCell('b', 'd', 1, 1)],
      ]),
    );
    const result = calculateNearestNeighborOrderWithExplanation(matrix, 'a', 'd');
    const legacyOrder = calculateNearestNeighborOrder(matrix, 'a', 'd');

    expect(result.order.orderedPointIds).toEqual(['a', 'c', 'b', 'd']);
    expect(result.order.warnings).toEqual([
      'Nearest-neighbor ordering is deterministic but not globally optimal.',
    ]);
    expect(result.order.warnings).toEqual(legacyOrder.warnings);
    expect(result.decisions.at(-1)?.reason).toBe('fixed_end');
    expect(result.unavailablePairs).toEqual([{ originId: 'a', destinationId: 'b' }]);
    const unavailable = result.decisions[0]?.candidates.find(
      (candidate) => candidate.destinationId === 'b',
    );
    expect(unavailable).toEqual({
      destinationId: 'b',
      status: 'unavailable',
      rejectionReason: 'route_unavailable',
    });
    expect(unavailable).not.toHaveProperty('durationSeconds');
    expect(unavailable).not.toHaveProperty('distanceMeters');
  });

  it('returns a stable unavailable error when no candidate can reach the remainder', () => {
    const matrix = matrixWith(
      new Map([
        ['a->b', { originId: 'a', destinationId: 'b', status: 'unavailable' }],
        ['a->c', { originId: 'a', destinationId: 'c', status: 'unavailable' }],
        ['a->d', { originId: 'a', destinationId: 'd', status: 'unavailable' }],
      ]),
    );
    expect(() => calculateNearestNeighborOrderWithExplanation(matrix)).toThrowError(
      expect.objectContaining<Partial<RouteOrderAlgorithmError>>({
        code: 'ROUTE_ORDER_UNAVAILABLE',
      }),
    );
  });
});
