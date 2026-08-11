import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  ApiFailureSchema,
  LoginResultSchema,
  PlaceListResultSchema,
  createApiSuccessSchema,
} from '@travel-guide/shared-schemas';
import type { Place, PlaceListResult } from '@travel-guide/shared-types';

import { createApp } from '../src/create-app';
import { createTestAuthEnvironment } from '../src/modules/auth/config/auth-environment';
import type { UserRecord, UserRepository } from '../src/modules/auth/repositories/user.repository';
import type { WechatProvider } from '../src/modules/auth/providers/wechat.provider';
import type { PlaceEnvironment } from '../src/modules/places/config/place-environment';
import type { PlaceClock } from '../src/modules/places/place.clock';
import type {
  PlaceProvider,
  PlaceProviderResult,
  ProviderPlace,
} from '../src/modules/places/providers';
import type { NormalizedPlaceSearch } from '../src/modules/places/providers/place.provider';
import type { PlaceRepository } from '../src/modules/places/repositories/place.repository';

const userId = '123e4567-e89b-12d3-a456-426614174000';
const placeId = '223e4567-e89b-12d3-a456-426614174000';
const fetchedAt = '2026-08-11T00:00:00.000Z';

class FakeWechatProvider implements WechatProvider {
  public async exchangeCode(code: string): Promise<{ openid: string }> {
    return { openid: code };
  }
}

class FakeUserRepository implements UserRepository {
  public async findOrCreateByWechatIdentity(): Promise<UserRecord> {
    return { id: userId, nickname: '', avatarUrl: '', status: 'active' };
  }
}

class FakeClock implements PlaceClock {
  public now(): Date {
    return new Date(fetchedAt);
  }
}

class FakePlaceProvider implements PlaceProvider {
  public readonly name = 'fake';
  public static empty = false;

  public async searchPlaces(input: NormalizedPlaceSearch): Promise<PlaceProviderResult> {
    if (FakePlaceProvider.empty) {
      return { items: [], total: 0, fetchedAt };
    }
    return {
      items: [
        {
          provider: this.name,
          providerPlaceId: 'B0001',
          name: '西湖',
          category: input.categories[0] ?? 'attraction',
          categoryText: '景点',
          address: '杭州西湖区',
          location: { longitude: 120.15, latitude: 30.25 },
        },
      ],
      total: 1,
      fetchedAt,
    };
  }
}

class FakePlaceRepository implements PlaceRepository {
  private value: PlaceListResult | undefined;

  public async findFreshSearch(): Promise<PlaceListResult | undefined> {
    return FakePlaceProvider.empty ? undefined : this.value;
  }

  public async upsertProviderPlaces(input: ProviderPlace[]): Promise<Place[]> {
    return input.map((item) => ({
      id: placeId,
      provider: item.provider,
      providerPlaceId: item.providerPlaceId,
      name: item.name,
      category: item.category,
      categoryText: item.categoryText,
      address: item.address,
      location: item.location,
      verifiedAt: fetchedAt,
      dataSource: 'map_provider' as const,
    }));
  }

  public async saveSearchResult(
    input: NormalizedPlaceSearch,
    places: Place[],
    total: number,
  ): Promise<void> {
    this.value = {
      items: places.map((place) => ({ ...place, dataSource: 'cache' as const })),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
      },
      fetchedAt,
    };
  }
}

describe('Places API', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const placeEnvironment: PlaceEnvironment = {
      provider: 'amap',
      apiKey: 'test-place-key',
      requestTimeoutMs: 500,
      cacheTtlSeconds: 600,
    };
    app = await createApp(
      { nodeEnv: 'test', port: 0 },
      {
        authEnvironment: createTestAuthEnvironment(),
        wechatProvider: new FakeWechatProvider(),
        userRepository: new FakeUserRepository(),
        placeEnvironment,
        placeProvider: new FakePlaceProvider(),
        placeRepository: new FakePlaceRepository(),
        placeClock: new FakeClock(),
      },
    );
    await app.init();
  });

  afterAll(async () => app.close());

  const login = async (): Promise<string> => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/auth/login',
        payload: { code: 'place-user' },
      });
    return createApiSuccessSchema(LoginResultSchema).parse(JSON.parse(response.payload)).data
      .accessToken;
  };

  it('rejects unauthenticated access', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/places?cityName=杭州&categories=attraction',
    });
    expect(response.statusCode).toBe(401);
    expect(ApiFailureSchema.parse(JSON.parse(response.payload)).error.code).toBe(
      'AUTH_TOKEN_INVALID',
    );
  });

  it('returns valid POIs and preserves request id', async () => {
    const token = await login();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/places?cityName=%E6%9D%AD%E5%B7%9E&categories=attraction&page=1&pageSize=20',
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'places-request-1' },
      });
    const envelope = createApiSuccessSchema(PlaceListResultSchema).parse(
      JSON.parse(response.payload),
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('places-request-1');
    expect(envelope.data.items[0]?.providerPlaceId).toBe('B0001');
  });

  it('returns an authenticated empty result without inventing POIs', async () => {
    const token = await login();
    FakePlaceProvider.empty = true;
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/places?cityName=%E6%9D%AD%E5%B7%9E&categories=restaurant',
        headers: { authorization: `Bearer ${token}` },
      });
    FakePlaceProvider.empty = false;
    const envelope = createApiSuccessSchema(PlaceListResultSchema).parse(
      JSON.parse(response.payload),
    );
    expect(response.statusCode).toBe(200);
    expect(envelope.data.items).toEqual([]);
    expect(envelope.data.pagination.total).toBe(0);
  });

  it('maps invalid query parameters to PLACE_VALIDATION_ERROR', async () => {
    const token = await login();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/places?cityName=&categories=attraction,attraction',
        headers: { authorization: `Bearer ${token}` },
      });
    expect(response.statusCode).toBe(400);
    expect(ApiFailureSchema.parse(JSON.parse(response.payload)).error.code).toBe(
      'PLACE_VALIDATION_ERROR',
    );
  });
});
