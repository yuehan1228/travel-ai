import { describe, expect, it } from 'vitest';

import type { EstimateRouteInput, RouteEstimate } from '@travel-guide/shared-types';

import type { RouteEnvironment } from '../src/modules/routes/config/route-environment';
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

const now = new Date('2026-08-11T00:00:00.000Z');
const input: EstimateRouteInput = {
  origin: { location: { longitude: 120.15, latitude: 30.25 } },
  destination: { location: { longitude: 120.18, latitude: 30.27 } },
  mode: 'walking',
};

const environment: RouteEnvironment = {
  provider: 'fake',
  apiKey: 'not-used',
  requestTimeoutMs: 500,
  cacheTtlSeconds: 600,
  staleIfErrorSeconds: 3_600,
};

class FakeClock implements RouteClock {
  public now(): Date {
    return now;
  }
}

class MemoryRepository implements RouteCacheRepository {
  public fresh: RouteEstimate | undefined;
  public stale: RouteEstimate | undefined;
  public saved: RouteCacheRecordInput[] = [];
  public failFresh = false;
  public failSave = false;

  public async findFresh(): Promise<RouteEstimate | undefined> {
    if (this.failFresh) throw new Error('database unavailable');
    return this.fresh;
  }

  public async findStale(): Promise<RouteEstimate | undefined> {
    return this.stale;
  }

  public async save(input: RouteCacheRecordInput): Promise<void> {
    if (this.failSave) throw new Error('database unavailable');
    this.saved.push(input);
    this.fresh = input.payload;
  }
}

class FakeProvider implements RouteProvider {
  public readonly name = 'fake';
  public calls = 0;
  public response: RouteProviderResult | undefined = {
    distanceMeters: 2_000,
    durationSeconds: 1_200,
    fetchedAt: now.toISOString(),
  };
  public failure = false;

  public async estimateRoute(): Promise<RouteProviderResult | undefined> {
    this.calls += 1;
    if (this.failure) throw new Error('provider timeout');
    return this.response;
  }
}

const available = (source: 'map_provider' | 'cache' = 'map_provider'): RouteEstimate => ({
  ...input,
  distanceMeters: 100,
  durationSeconds: 80,
  dataSource: source,
  provider: 'fake',
  fetchedAt: now.toISOString(),
});

describe('RouteService', () => {
  it('uses and validates fresh cache before calling the provider', async () => {
    const provider = new FakeProvider();
    const repository = new MemoryRepository();
    repository.fresh = available();
    const service = new RouteService(provider, repository, new FakeClock(), environment);

    const result = await service.estimateRoute(input);
    expect(result.dataSource).toBe('cache');
    expect(provider.calls).toBe(0);
  });

  it('calls provider after cache expiry, persists valid result and uses stable private hash key', async () => {
    const provider = new FakeProvider();
    const repository = new MemoryRepository();
    const service = new RouteService(provider, repository, new FakeClock(), environment);

    const result = await service.estimateRoute({
      ...input,
      origin: { location: { longitude: 120.1500004, latitude: 30.2500004 } },
    });
    expect(result).toMatchObject({ dataSource: 'map_provider', distanceMeters: 2_000 });
    expect(provider.calls).toBe(1);
    expect(repository.saved).toHaveLength(1);
    const key = service.createCacheKey(input);
    expect(key).toHaveLength(73);
    expect(key).not.toContain('120.15');
    expect(key).not.toContain('user-id');
    expect(key).not.toContain('test-route-key');
  });

  it('returns unavailable without fabricating values when provider has no route', async () => {
    const provider = new FakeProvider();
    provider.response = undefined;
    const repository = new MemoryRepository();
    const service = new RouteService(provider, repository, new FakeClock(), environment);

    const result = await service.estimateRoute(input);
    expect(result).toMatchObject({ dataSource: 'unavailable', provider: 'fake' });
    expect(result).not.toHaveProperty('distanceMeters');
    expect(result).not.toHaveProperty('durationSeconds');
    expect(result).not.toHaveProperty('tollsCny');
  });

  it('uses stale cache on provider errors and maps persistence errors', async () => {
    const provider = new FakeProvider();
    provider.failure = true;
    const repository = new MemoryRepository();
    repository.stale = available();
    const service = new RouteService(provider, repository, new FakeClock(), environment);
    await expect(service.estimateRoute(input)).resolves.toMatchObject({ dataSource: 'cache' });

    const failingRepository = new MemoryRepository();
    failingRepository.failFresh = true;
    await expect(
      new RouteService(provider, failingRepository, new FakeClock(), environment).estimateRoute(
        input,
      ),
    ).rejects.toMatchObject({ code: 'ROUTE_PERSISTENCE_ERROR' });

    const noStale = new MemoryRepository();
    await expect(
      new RouteService(provider, noStale, new FakeClock(), environment).estimateRoute(input),
    ).rejects.toMatchObject({ code: 'ROUTE_PROVIDER_ERROR' });
  });

  it('rejects same normalized endpoints and invalid provider results', async () => {
    const provider = new FakeProvider();
    provider.response = { ...provider.response!, distanceMeters: -1 };
    const service = new RouteService(
      provider,
      new MemoryRepository(),
      new FakeClock(),
      environment,
    );
    await expect(
      service.estimateRoute({
        ...input,
        destination: { location: { longitude: 120.1500004, latitude: 30.2500004 } },
      }),
    ).rejects.toMatchObject({ code: 'ROUTE_VALIDATION_ERROR' });
    await expect(service.estimateRoute(input)).rejects.toMatchObject({
      code: 'ROUTE_PROVIDER_ERROR',
    });
  });
});
