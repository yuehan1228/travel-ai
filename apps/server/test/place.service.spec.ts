import { describe, expect, it } from 'vitest';

import type { Place, PlaceListResult } from '@travel-guide/shared-types';

import type { PlaceEnvironment } from '../src/modules/places/config/place-environment';
import type { PlaceClock } from '../src/modules/places/place.clock';
import { createPlaceCacheKey } from '../src/modules/places/place-cache-key';
import { PlaceService } from '../src/modules/places/place.service';
import type {
  PlaceProvider,
  PlaceProviderResult,
  ProviderPlace,
} from '../src/modules/places/providers';
import type { NormalizedPlaceSearch } from '../src/modules/places/providers/place.provider';
import type { PlaceRepository } from '../src/modules/places/repositories/place.repository';

const now = new Date('2026-08-11T00:00:00.000Z');
const environment: PlaceEnvironment = {
  provider: 'fake',
  apiKey: 'not-used',
  requestTimeoutMs: 500,
  cacheTtlSeconds: 600,
};

class FakeClock implements PlaceClock {
  public now(): Date {
    return now;
  }
}

const providerPlace = (id: string, name: string): ProviderPlace => ({
  provider: 'fake',
  providerPlaceId: id,
  name,
  category: 'attraction',
  categoryText: '景点',
  address: '杭州',
  location: { longitude: 120.15, latitude: 30.25 },
});

const publicPlace = (id: string, name: string, source: 'map_provider' | 'cache'): Place => ({
  id,
  provider: 'fake',
  providerPlaceId: `provider-${id}`,
  name,
  category: 'attraction',
  categoryText: '景点',
  address: '杭州',
  location: { longitude: 120.15, latitude: 30.25 },
  verifiedAt: now.toISOString(),
  dataSource: source,
});

class MemoryRepository implements PlaceRepository {
  public calls = { find: 0, upsert: 0, save: 0 };
  public cached: PlaceListResult | undefined;
  public stale: PlaceListResult | undefined;
  public receivedInput: ProviderPlace[] = [];

  public async findFreshSearch(): Promise<PlaceListResult | undefined> {
    this.calls.find += 1;
    return this.cached;
  }

  public async upsertProviderPlaces(input: ProviderPlace[]): Promise<Place[]> {
    this.calls.upsert += 1;
    this.receivedInput = input;
    return input.map((item, index) =>
      publicPlace(`123e4567-e89b-12d3-a456-42661417400${index + 1}`, item.name, 'map_provider'),
    );
  }

  public async saveSearchResult(
    _input: NormalizedPlaceSearch,
    places: Place[],
    total: number,
  ): Promise<void> {
    this.calls.save += 1;
    this.cached = {
      items: places.map((place) => ({ ...place, dataSource: 'cache' as const })),
      pagination: {
        page: 1,
        pageSize: 20,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / 20),
      },
      fetchedAt: now.toISOString(),
    };
  }

  public async findStaleSearch(): Promise<PlaceListResult | undefined> {
    return this.stale;
  }
}

class FakeProvider implements PlaceProvider {
  public readonly name = 'fake';
  public calls = 0;
  public response: PlaceProviderResult = {
    items: [
      providerPlace('p2', '西湖'),
      providerPlace('p1', '灵隐寺'),
      providerPlace('p2', '重复'),
    ],
    total: 2,
    fetchedAt: now.toISOString(),
  };

  public async searchPlaces(): Promise<PlaceProviderResult> {
    this.calls += 1;
    return this.response;
  }
}

const createService = () => {
  const provider = new FakeProvider();
  const repository = new MemoryRepository();
  return {
    provider,
    repository,
    service: new PlaceService(provider, repository, new FakeClock(), environment),
  };
};

describe('PlaceService', () => {
  it('validates, deduplicates, sorts and persists provider places', async () => {
    const { service, provider, repository } = createService();
    const result = await service.searchPlaces({ cityName: ' 杭州 ', categories: ['attraction'] });
    expect(provider.calls).toBe(1);
    expect(repository.calls.upsert).toBe(1);
    expect(repository.calls.save).toBe(1);
    expect(result.items.map((item) => item.name)).toEqual(['灵隐寺', '西湖']);
    expect(repository.receivedInput[0]?.cityName).toBe('杭州');
    const key = service.createCacheKey({
      provider: 'fake',
      cityName: '杭州',
      keyword: '秘密关键词',
      categories: ['attraction', 'restaurant'],
      page: 1,
      pageSize: 20,
    });
    expect(key).toBe(
      createPlaceCacheKey({
        provider: 'fake',
        cityName: '杭州',
        keyword: '秘密关键词',
        categories: ['restaurant', 'attraction'],
        page: 1,
        pageSize: 20,
      }),
    );
    expect(key).toHaveLength(73);
    expect(key).not.toContain('秘密关键词');
    expect(key).not.toContain('test-place-key');
    expect(
      createPlaceCacheKey({
        provider: 'fake',
        cityName: '杭州',
        keyword: '秘密关键词',
        categories: ['attraction', 'restaurant'],
        page: 1,
        pageSize: 20,
      }),
    ).toBe(key);
  });

  it('calls the provider when the fresh cache is missing or expired', async () => {
    const { service, provider, repository } = createService();
    repository.cached = undefined;
    await service.searchPlaces({ cityName: '杭州', categories: ['attraction'] });
    expect(provider.calls).toBe(1);
  });

  it('persists only schema-normalized provider places', async () => {
    const { service, provider, repository } = createService();
    provider.response = {
      items: [
        { ...providerPlace('invalid', '无效'), rawTypeCode: 'x'.repeat(33) },
        {
          ...providerPlace('valid', '  有效地点  '),
          providerPlaceId: '  valid-id  ',
          categoryText: '  景点  ',
          rawTypeCode: ' 110000 ',
        },
      ],
      total: 2_147_483_648,
      fetchedAt: now.toISOString(),
    };
    const result = await service.searchPlaces({ cityName: '杭州', categories: ['attraction'] });
    expect(repository.receivedInput).toHaveLength(1);
    expect(repository.receivedInput[0]).toMatchObject({
      providerPlaceId: 'valid-id',
      name: '有效地点',
      categoryText: '景点',
      rawTypeCode: '110000',
    });
    expect(result.pagination.total).toBe(1);
  });

  it('returns fresh cache without calling the provider', async () => {
    const { service, provider, repository } = createService();
    repository.cached = {
      items: [publicPlace('123e4567-e89b-12d3-a456-426614174001', '缓存景点', 'cache')],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      fetchedAt: now.toISOString(),
    };
    const result = await service.searchPlaces({ cityName: '杭州', categories: ['attraction'] });
    expect(result.items[0]?.dataSource).toBe('cache');
    expect(provider.calls).toBe(0);
  });

  it('uses stale cache when provider fails and maps persistence failures', async () => {
    const { service, provider, repository } = createService();
    repository.stale = {
      items: [publicPlace('123e4567-e89b-12d3-a456-426614174001', '旧景点', 'cache')],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      fetchedAt: now.toISOString(),
    };
    provider.searchPlaces = async () => {
      throw new Error('provider timeout');
    };
    await expect(
      service.searchPlaces({ cityName: '杭州', categories: ['attraction'] }),
    ).resolves.toMatchObject({
      items: [{ name: '旧景点' }],
    });

    const failingRepository = new MemoryRepository();
    failingRepository.findFreshSearch = async () => {
      throw new Error('database unavailable');
    };
    const failingService = new PlaceService(
      provider,
      failingRepository,
      new FakeClock(),
      environment,
    );
    await expect(
      failingService.searchPlaces({ cityName: '杭州', categories: ['attraction'] }),
    ).rejects.toMatchObject({ code: 'PLACE_PERSISTENCE_ERROR' });

    const noStaleService = new PlaceService(
      provider,
      new MemoryRepository(),
      new FakeClock(),
      environment,
    );
    await expect(
      noStaleService.searchPlaces({ cityName: '杭州', categories: ['attraction'] }),
    ).rejects.toMatchObject({ code: 'PLACE_PROVIDER_ERROR' });
  });

  it('returns an empty result when the provider has no places', async () => {
    const { service, provider } = createService();
    provider.response = { items: [], total: 0, fetchedAt: now.toISOString() };
    const result = await service.searchPlaces({ cityName: '杭州', categories: ['restaurant'] });
    expect(result.items).toEqual([]);
    expect(result.pagination.totalPages).toBe(0);
  });
});
