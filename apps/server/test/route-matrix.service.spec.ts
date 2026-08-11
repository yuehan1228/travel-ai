import { describe, expect, it } from 'vitest';

import type {
  EstimateRouteInput,
  EstimateRouteMatrixInput,
  RouteEstimate,
} from '@travel-guide/shared-types';

import type { RouteEnvironment } from '../src/modules/routes/config/route-environment';
import {
  ROUTE_MATRIX_MAX_CONCURRENCY,
  RouteMatrixService,
} from '../src/modules/routes/route-matrix.service';
import type { RouteClock } from '../src/modules/routes/route.clock';
import { RouteService } from '../src/modules/routes/route.service';
import type {
  RouteProvider,
  RouteProviderResult,
} from '../src/modules/routes/providers/route.provider';
import type {
  RouteCacheRecordInput,
  RouteCacheRepository,
} from '../src/modules/routes/repositories/route-cache.repository';

const fetchedAt = '2026-08-11T00:00:00.000Z';
const environment: RouteEnvironment = {
  provider: 'fake',
  apiKey: 'not-used',
  requestTimeoutMs: 500,
  cacheTtlSeconds: 600,
  staleIfErrorSeconds: 600,
};

class FakeClock implements RouteClock {
  public now(): Date {
    return new Date(fetchedAt);
  }
}

class FakeRepository implements RouteCacheRepository {
  private readonly values = new Map<string, RouteEstimate>();

  public async findFresh(cacheKey: string): Promise<RouteEstimate | undefined> {
    return this.values.get(cacheKey);
  }

  public async findStale(cacheKey: string): Promise<RouteEstimate | undefined> {
    return this.values.get(cacheKey);
  }

  public async save(input: RouteCacheRecordInput): Promise<void> {
    this.values.set(input.cacheKey, input.payload);
  }
}

class FakeProvider implements RouteProvider {
  public readonly name = 'fake';
  public calls = 0;
  public active = 0;
  public maxActive = 0;
  public fail = false;
  public unavailablePair: string | undefined;

  public async estimateRoute(input: EstimateRouteInput): Promise<RouteProviderResult | undefined> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    this.active -= 1;
    if (this.fail) throw new Error('provider failed');
    const pair = `${input.origin.location.longitude},${input.destination.location.longitude}`;
    if (pair === this.unavailablePair) return undefined;
    return {
      distanceMeters: input.mode === 'walking' ? 100 : 1_000,
      durationSeconds: input.mode === 'walking' ? 60 : 120,
      fetchedAt,
    };
  }
}

const createService = (provider = new FakeProvider(), repository = new FakeRepository()) => ({
  provider,
  routeService: new RouteService(provider, repository, new FakeClock(), environment),
});

const matrixInput: EstimateRouteMatrixInput = {
  mode: 'walking',
  points: [
    { id: 'a', endpoint: { location: { longitude: 120.15, latitude: 30.25 } } },
    { id: 'b', endpoint: { location: { longitude: 120.18, latitude: 30.27 } } },
    { id: 'c', endpoint: { location: { longitude: 120.2, latitude: 30.29 } } },
  ],
};

const largeMatrixInput: EstimateRouteMatrixInput = {
  mode: 'walking',
  points: Array.from({ length: 10 }, (_, index) => ({
    id: `p-${index}`,
    endpoint: {
      location: {
        longitude: 120.1 + index / 100,
        latitude: 30.1 + index / 100,
      },
    },
  })),
};

describe('RouteMatrixService', () => {
  it('creates directed non-diagonal cells and reuses the two-point cache', async () => {
    const { provider, routeService } = createService();
    const service = new RouteMatrixService(routeService, new FakeClock());
    const first = await service.estimateRouteMatrix(matrixInput);
    expect(first.cells).toHaveLength(6);
    expect(first.cells.every((cell) => cell.originId !== cell.destinationId)).toBe(true);
    expect(new Set(first.cells.map((cell) => `${cell.originId}->${cell.destinationId}`)).size).toBe(
      6,
    );
    expect(first.cells.every((cell) => cell.status === 'available')).toBe(true);
    expect(provider.calls).toBe(6);

    const second = await service.estimateRouteMatrix(matrixInput);
    expect(second.cells).toHaveLength(6);
    expect(provider.calls).toBe(6);
    expect(second.cells.every((cell) => cell.estimate?.dataSource === 'cache')).toBe(true);
  });

  it('supports driving mode, partial unavailable cells and bounded concurrency', async () => {
    const provider = new FakeProvider();
    provider.unavailablePair = '120.15,120.18';
    const { routeService } = createService(provider);
    const service = new RouteMatrixService(routeService, new FakeClock());
    const result = await service.estimateRouteMatrix({ ...matrixInput, mode: 'driving' });

    expect(result.cells).toHaveLength(6);
    expect(result.cells.filter((cell) => cell.status === 'unavailable')).toHaveLength(1);
    expect(result.cells.filter((cell) => cell.status === 'available')).toHaveLength(5);
    expect(
      result.cells
        .filter((cell) => cell.status === 'available')
        .every((cell) => cell.estimate?.mode === 'driving'),
    ).toBe(true);
    expect(provider.maxActive).toBeLessThanOrEqual(4);
  });

  it('rejects invalid matrix input and maps systematic provider failures', async () => {
    const { routeService } = createService();
    const service = new RouteMatrixService(routeService, new FakeClock());
    await expect(
      service.estimateRouteMatrix({
        ...matrixInput,
        points: [matrixInput.points[0], { ...matrixInput.points[1], id: matrixInput.points[0].id }],
      }),
    ).rejects.toMatchObject({ code: 'ROUTE_MATRIX_VALIDATION_ERROR' });

    const provider = new FakeProvider();
    provider.fail = true;
    const failing = createService(provider);
    await expect(
      new RouteMatrixService(failing.routeService, new FakeClock()).estimateRouteMatrix(
        largeMatrixInput,
      ),
    ).rejects.toMatchObject({ code: 'ROUTE_MATRIX_PROVIDER_ERROR' });
    expect(provider.calls).toBeLessThanOrEqual(ROUTE_MATRIX_MAX_CONCURRENCY);
  });
});
