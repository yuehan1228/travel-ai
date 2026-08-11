import { describe, expect, it } from 'vitest';

import type { EstimateRouteMatrixInput } from '@travel-guide/shared-types';

import { createHttpClient, type RequestAdapter } from '../services/http-client';
import { type RouteAuthService } from '../services/route.service';
import { RouteMatrixService } from '../services/route-matrix.service';

const createAuthServiceForTest = (
  token: string | undefined,
): RouteAuthService & { loggedOut: boolean } => {
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

const input: EstimateRouteMatrixInput = {
  mode: 'walking',
  points: [
    { id: 'start', endpoint: { location: { longitude: 120.15, latitude: 30.25 } } },
    { id: 'finish', endpoint: { location: { longitude: 120.18, latitude: 30.27 } } },
  ],
};

const result = {
  ...input,
  cells: [
    {
      originId: 'start',
      destinationId: 'finish',
      status: 'available' as const,
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
    { originId: 'finish', destinationId: 'start', status: 'unavailable' as const },
  ],
  generatedAt: '2026-08-11T00:00:00.000Z',
};

describe('miniapp RouteMatrixService', () => {
  it('posts a typed matrix request with a Bearer token', async () => {
    let authorization = '';
    let path = '';
    const service = new RouteMatrixService(
      createClient(async (options) => {
        authorization = options.header?.Authorization ?? '';
        path = options.url;
        return { statusCode: 200, data: { success: true, data: result, requestId: 'matrix-1' } };
      }),
      createAuthServiceForTest('matrix-token'),
    );

    await expect(service.estimateRouteMatrix(input)).resolves.toEqual(result);
    expect(authorization).toBe('Bearer matrix-token');
    expect(path).toContain('/routes/matrix');
  });

  it('does not access network without a token and clears auth on auth failure', async () => {
    let requests = 0;
    const auth = createAuthServiceForTest(undefined);
    const service = new RouteMatrixService(
      createClient(async () => {
        requests += 1;
        throw new Error('network should not be called');
      }),
      auth,
    );
    await expect(service.estimateRouteMatrix(input)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(requests).toBe(0);

    const expiredAuth = createAuthServiceForTest('expired-token');
    const expired = new RouteMatrixService(
      createClient(async () => ({
        statusCode: 401,
        data: {
          success: false,
          error: { code: 'AUTH_TOKEN_INVALID', message: 'The access token is invalid' },
          requestId: 'matrix-2',
        },
      })),
      expiredAuth,
    );
    await expect(expired.estimateRouteMatrix(input)).rejects.toMatchObject({
      apiCode: 'AUTH_TOKEN_INVALID',
    });
    expect(expiredAuth.loggedOut).toBe(true);
  });

  it('rejects malformed matrix responses', async () => {
    const service = new RouteMatrixService(
      createClient(async () => ({
        statusCode: 200,
        data: { success: true, data: { ...result, cells: [] }, requestId: 'matrix-3' },
      })),
      createAuthServiceForTest('matrix-token'),
    );
    await expect(service.estimateRouteMatrix(input)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
