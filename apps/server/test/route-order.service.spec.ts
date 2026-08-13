import { describe, expect, it } from 'vitest';

import type {
  EstimateRouteInput,
  EstimateRouteOrderInput,
  RouteEstimate,
} from '@travel-guide/shared-types';

import type { RouteEnvironment } from '../src/modules/routes/config/route-environment';
import type { RouteClock } from '../src/modules/routes/route.clock';
import { RouteMatrixService } from '../src/modules/routes/route-matrix.service';
import { RouteOrderService } from '../src/modules/routes/route-order.service';
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
  public failure = false;
  public readonly unavailablePairs = new Set<string>();
  public readonly durations = new Map<string, number>();
  public readonly distances = new Map<string, number>();

  public async estimateRoute(input: EstimateRouteInput): Promise<RouteProviderResult | undefined> {
    this.calls += 1;
    if (this.failure) throw new Error('provider failed');
    const pair = `${input.origin.location.longitude},${input.destination.location.longitude}`;
    if (this.unavailablePairs.has(pair)) return undefined;
    return {
      distanceMeters: this.distances.get(pair) ?? (input.mode === 'walking' ? 100 : 1_000),
      durationSeconds: this.durations.get(pair) ?? (input.mode === 'walking' ? 60 : 120),
      fetchedAt,
    };
  }
}

const input: EstimateRouteOrderInput = {
  mode: 'walking',
  points: [
    { id: 'a', endpoint: { location: { longitude: 120.15, latitude: 30.25 } } },
    { id: 'b', endpoint: { location: { longitude: 120.18, latitude: 30.27 } } },
    { id: 'c', endpoint: { location: { longitude: 120.2, latitude: 30.29 } } },
  ],
};

const createService = (provider = new FakeProvider(), repository = new FakeRepository()) => {
  const routeService = new RouteService(provider, repository, new FakeClock(), environment);
  const matrixService = new RouteMatrixService(routeService, new FakeClock());
  return { provider, matrixService, orderService: new RouteOrderService(matrixService) };
};

describe('RouteOrderService', () => {
  it.each(['walking', 'driving'] as const)(
    'supports %s and aggregates real route legs',
    async (mode) => {
      const { orderService } = createService();
      const result = await orderService.estimateRouteOrder({ ...input, mode });
      expect(result.mode).toBe(mode);
      expect(result.orderedPointIds).toHaveLength(3);
      expect(result.legs).toHaveLength(2);
      expect(result.totalDistanceMeters).toBe(
        result.legs.reduce(
          (total, leg) =>
            total + (leg.estimate.dataSource === 'unavailable' ? 0 : leg.estimate.distanceMeters),
          0,
        ),
      );
      expect(result.totalDurationSeconds).toBe(
        result.legs.reduce(
          (total, leg) =>
            total + (leg.estimate.dataSource === 'unavailable' ? 0 : leg.estimate.durationSeconds),
          0,
        ),
      );
    },
  );

  it('honors explicit start and end while selecting the nearest available next point', async () => {
    const provider = new FakeProvider();
    provider.durations.set('120.15,120.18', 10);
    provider.durations.set('120.15,120.2', 1);
    provider.durations.set('120.2,120.18', 2);
    provider.durations.set('120.18,120.2', 5);
    const { orderService } = createService(provider);
    const result = await orderService.estimateRouteOrder({ ...input, startId: 'a', endId: 'b' });
    expect(result.orderedPointIds).toEqual(['a', 'c', 'b']);
  });

  it('honors an explicit start without requiring an end point', async () => {
    const { orderService } = createService();
    const result = await orderService.estimateRouteOrder({ ...input, startId: 'b' });
    expect(result.orderedPointIds[0]).toBe('b');
    expect(result.orderedPointIds).toHaveLength(input.points.length);
  });

  it('skips a partial unavailable leg when another complete order is available', async () => {
    const provider = new FakeProvider();
    provider.unavailablePairs.add('120.15,120.18');
    const { orderService } = createService(provider);
    const result = await orderService.estimateRouteOrder(input);
    expect(result.orderedPointIds).toEqual(['a', 'c', 'b']);
  });

  it('returns stable errors for impossible orders and invalid endpoints', async () => {
    const provider = new FakeProvider();
    provider.unavailablePairs.add('120.15,120.18');
    provider.unavailablePairs.add('120.15,120.2');
    const { orderService } = createService(provider);
    await expect(orderService.estimateRouteOrder(input)).rejects.toMatchObject({
      code: 'ROUTE_ORDER_UNAVAILABLE',
    });
    await expect(
      orderService.estimateRouteOrder({ ...input, startId: 'missing' }),
    ).rejects.toMatchObject({ code: 'ROUTE_ORDER_VALIDATION_ERROR' });
  });

  it('maps a systematic provider failure to a stable order provider error', async () => {
    const provider = new FakeProvider();
    provider.failure = true;
    const { orderService } = createService(provider);
    await expect(orderService.estimateRouteOrder(input)).rejects.toMatchObject({
      code: 'ROUTE_ORDER_PROVIDER_ERROR',
    });
  });

  it('reuses the existing two-point cache through RouteMatrixService', async () => {
    const provider = new FakeProvider();
    const { orderService } = createService(provider);
    await orderService.estimateRouteOrder(input);
    expect(provider.calls).toBe(6);
    await orderService.estimateRouteOrder(input);
    expect(provider.calls).toBe(6);
  });

  it('calculates from a validated matrix without querying the Provider again', async () => {
    const { provider, matrixService, orderService } = createService();
    const matrix = await matrixService.estimateRouteMatrix(input);
    const callsAfterMatrix = provider.calls;
    const result = orderService.estimateRouteOrderFromMatrix(matrix, 'a', 'c');
    expect(result.orderedPointIds[0]).toBe('a');
    expect(result.orderedPointIds.at(-1)).toBe('c');
    expect(provider.calls).toBe(callsAfterMatrix);
  });
});
