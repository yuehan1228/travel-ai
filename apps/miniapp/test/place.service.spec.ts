import { describe, expect, it } from 'vitest';

import type { SearchPlacesInput } from '@travel-guide/shared-types';

import { createHttpClient, type RequestAdapter } from '../services/http-client';
import { PlaceService, type PlaceAuthService } from '../services/place.service';

const input: SearchPlacesInput = {
  cityName: '杭州',
  categories: ['attraction', 'restaurant'],
  page: 1,
  pageSize: 20,
};

const result = {
  items: [
    {
      id: '123e4567-e89b-12d3-a456-426614174000',
      provider: 'amap',
      providerPlaceId: 'B0001',
      name: '西湖',
      category: 'attraction' as const,
      categoryText: '景点',
      address: '杭州西湖区',
      location: { longitude: 120.15, latitude: 30.25 },
      verifiedAt: '2026-08-11T00:00:00.000Z',
      dataSource: 'map_provider' as const,
    },
  ],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  fetchedAt: '2026-08-11T00:00:00.000Z',
};

const createAuth = (token: string | undefined): PlaceAuthService & { loggedOut: boolean } => {
  const auth = {
    loggedOut: false,
    getAccessToken: () => token,
    logout: () => {
      auth.loggedOut = true;
    },
  };
  return auth;
};

const createClient = (adapter: RequestAdapter) =>
  createHttpClient(
    { name: 'test', baseUrl: 'https://api.example.invalid', requestTimeout: 100 },
    adapter,
  );

describe('miniapp PlaceService', () => {
  it('attaches a Bearer token and validates API success data', async () => {
    let authorization = '';
    let path = '';
    const service = new PlaceService(
      createClient(async (options) => {
        authorization = options.header?.Authorization ?? '';
        path = options.url;
        return { statusCode: 200, data: { success: true, data: result, requestId: 'place-1' } };
      }),
      createAuth('place-token'),
    );
    await expect(service.searchPlaces(input)).resolves.toEqual(result);
    expect(authorization).toBe('Bearer place-token');
    expect(path).toContain('/places?cityName=%E6%9D%AD%E5%B7%9E');
    expect(path).toContain('categories=attraction%2Crestaurant');
  });

  it('does not access the network when the token is missing', async () => {
    let requests = 0;
    const service = new PlaceService(
      createClient(async () => {
        requests += 1;
        throw new Error('network should not be called');
      }),
      createAuth(undefined),
    );
    await expect(service.searchPlaces(input)).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
    expect(requests).toBe(0);
  });

  it('clears auth state when the API rejects the token and rejects malformed data', async () => {
    const auth = createAuth('expired-token');
    const service = new PlaceService(
      createClient(async () => ({
        statusCode: 401,
        data: {
          success: false,
          error: { code: 'AUTH_TOKEN_INVALID', message: 'The access token is invalid' },
          requestId: 'place-2',
        },
      })),
      auth,
    );
    await expect(service.searchPlaces(input)).rejects.toMatchObject({
      apiCode: 'AUTH_TOKEN_INVALID',
    });
    expect(auth.loggedOut).toBe(true);

    const malformed = new PlaceService(
      createClient(async () => ({
        statusCode: 200,
        data: { success: true, data: {}, requestId: 'x' },
      })),
      createAuth('place-token'),
    );
    await expect(malformed.searchPlaces(input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
