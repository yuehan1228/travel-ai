import { describe, expect, it } from 'vitest';

import type { EstimateRouteInput } from '@travel-guide/shared-types';

import { createHttpClient, type RequestAdapter } from '../services/http-client';
import { RouteService, type RouteAuthService } from '../services/route.service';

const input: EstimateRouteInput = {
  origin: { location: { longitude: 120.15, latitude: 30.25 } },
  destination: { location: { longitude: 120.18, latitude: 30.27 } },
  mode: 'walking',
};

const result = {
  ...input,
  distanceMeters: 1_234,
  durationSeconds: 800,
  dataSource: 'map_provider' as const,
  provider: 'amap',
  fetchedAt: '2026-08-11T00:00:00.000Z',
};

const createAuth = (token: string | undefined): RouteAuthService & { loggedOut: boolean } => {
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

describe('miniapp RouteService', () => {
  it('attaches Bearer Token and validates API success data', async () => {
    let authorization = '';
    let method = '';
    let path = '';
    let body: unknown;
    const service = new RouteService(
      createClient(async (options) => {
        authorization = options.header?.Authorization ?? '';
        method = options.method;
        path = options.url;
        body = options.data;
        return { statusCode: 200, data: { success: true, data: result, requestId: 'route-1' } };
      }),
      createAuth('route-token'),
    );
    await expect(service.estimateRoute(input)).resolves.toEqual(result);
    expect(authorization).toBe('Bearer route-token');
    expect(method).toBe('POST');
    expect(path).toContain('/routes/estimate');
    expect(body).toEqual(input);
  });

  it('does not access network without token and clears auth on token failure', async () => {
    let requests = 0;
    const service = new RouteService(
      createClient(async () => {
        requests += 1;
        throw new Error('network should not be called');
      }),
      createAuth(undefined),
    );
    await expect(service.estimateRoute(input)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(requests).toBe(0);

    const auth = createAuth('expired-token');
    const expired = new RouteService(
      createClient(async () => ({
        statusCode: 401,
        data: {
          success: false,
          error: { code: 'AUTH_TOKEN_INVALID', message: 'The access token is invalid' },
          requestId: 'route-2',
        },
      })),
      auth,
    );
    await expect(expired.estimateRoute(input)).rejects.toMatchObject({
      apiCode: 'AUTH_TOKEN_INVALID',
    });
    expect(auth.loggedOut).toBe(true);
  });

  it('rejects malformed API responses', async () => {
    const service = new RouteService(
      createClient(async () => ({
        statusCode: 200,
        data: { success: true, data: { ...result, distanceMeters: -1 }, requestId: 'route-3' },
      })),
      createAuth('route-token'),
    );
    await expect(service.estimateRoute(input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
