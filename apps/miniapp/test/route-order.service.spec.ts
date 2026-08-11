import { describe, expect, it } from 'vitest';

import type { EstimateRouteOrderInput } from '@travel-guide/shared-types';

import { createHttpClient, type RequestAdapter } from '../services/http-client';
import { type RouteOrderAuthService, RouteOrderService } from '../services/route-order.service';

const createAuthServiceForTest = (
  token: string | undefined,
): RouteOrderAuthService & { loggedOut: boolean } => {
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

const input: EstimateRouteOrderInput = {
  mode: 'walking',
  startId: 'start',
  endId: 'finish',
  points: [
    { id: 'start', endpoint: { location: { longitude: 120.15, latitude: 30.25 } } },
    { id: 'finish', endpoint: { location: { longitude: 120.18, latitude: 30.27 } } },
  ],
};

const result = {
  orderedPointIds: ['start', 'finish'],
  legs: [
    {
      originId: 'start',
      destinationId: 'finish',
      estimate: {
        origin: input.points[0].endpoint,
        destination: input.points[1].endpoint,
        mode: 'walking' as const,
        distanceMeters: 1_234,
        durationSeconds: 800,
        dataSource: 'map_provider' as const,
        provider: 'amap',
        fetchedAt: '2026-08-11T00:00:00.000Z',
      },
    },
  ],
  totalDistanceMeters: 1_234,
  totalDurationSeconds: 800,
  mode: 'walking' as const,
  algorithm: 'nearest_neighbor' as const,
  isOptimal: false as const,
  generatedAt: '2026-08-11T00:00:00.000Z',
  warnings: ['Nearest-neighbor ordering is deterministic but not globally optimal.'],
};

describe('miniapp RouteOrderService', () => {
  it('posts a typed order request with a Bearer token', async () => {
    let authorization = '';
    let path = '';
    const service = new RouteOrderService(
      createClient(async (options) => {
        authorization = options.header?.Authorization ?? '';
        path = options.url;
        return { statusCode: 200, data: { success: true, data: result, requestId: 'order-1' } };
      }),
      createAuthServiceForTest('order-token'),
    );

    await expect(service.estimateRouteOrder(input)).resolves.toEqual(result);
    expect(authorization).toBe('Bearer order-token');
    expect(path).toContain('/routes/order');
  });

  it('does not access network without a token and clears auth on auth failure', async () => {
    let requests = 0;
    const auth = createAuthServiceForTest(undefined);
    const service = new RouteOrderService(
      createClient(async () => {
        requests += 1;
        throw new Error('network should not be called');
      }),
      auth,
    );
    await expect(service.estimateRouteOrder(input)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(requests).toBe(0);

    const expiredAuth = createAuthServiceForTest('expired-token');
    const expired = new RouteOrderService(
      createClient(async () => ({
        statusCode: 401,
        data: {
          success: false,
          error: { code: 'AUTH_TOKEN_INVALID', message: 'The access token is invalid' },
          requestId: 'order-2',
        },
      })),
      expiredAuth,
    );
    await expect(expired.estimateRouteOrder(input)).rejects.toMatchObject({
      apiCode: 'AUTH_TOKEN_INVALID',
    });
    expect(expiredAuth.loggedOut).toBe(true);
  });

  it('rejects malformed order responses', async () => {
    const service = new RouteOrderService(
      createClient(async () => ({
        statusCode: 200,
        data: { success: true, data: { ...result, legs: [] }, requestId: 'order-3' },
      })),
      createAuthServiceForTest('order-token'),
    );
    await expect(service.estimateRouteOrder(input)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
