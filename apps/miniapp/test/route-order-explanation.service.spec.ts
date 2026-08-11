import { describe, expect, it } from 'vitest';

import type {
  EstimateRouteOrderInput,
  RouteOrderExplanationResult,
} from '@travel-guide/shared-types';

import { createHttpClient, type RequestAdapter } from '../services/http-client';
import {
  type RouteOrderAuthService,
  RouteOrderExplanationService,
} from '../services/route-order-explanation.service';

const createAuth = (token: string | undefined): RouteOrderAuthService & { loggedOut: boolean } => {
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
  mode: 'driving',
  startId: 'a',
  endId: 'b',
  points: [
    { id: 'a', endpoint: { location: { longitude: 120.15, latitude: 30.25 } } },
    { id: 'b', endpoint: { location: { longitude: 120.18, latitude: 30.27 } } },
  ],
};

const order = {
  orderedPointIds: ['a', 'b'],
  legs: [
    {
      originId: 'a',
      destinationId: 'b',
      estimate: {
        origin: input.points[0].endpoint,
        destination: input.points[1].endpoint,
        mode: 'driving' as const,
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
  mode: 'driving' as const,
  algorithm: 'nearest_neighbor' as const,
  isOptimal: false as const,
  generatedAt: '2026-08-11T00:00:00.000Z',
  warnings: ['Nearest-neighbor ordering is deterministic but not globally optimal.'],
};

const explanation: RouteOrderExplanationResult = {
  order,
  decisions: [
    {
      step: 1,
      originId: 'a',
      selectedDestinationId: 'b',
      reason: 'fixed_end',
      candidates: [
        { destinationId: 'b', status: 'available', durationSeconds: 800, distanceMeters: 1_234 },
      ],
    },
  ],
  unavailablePairs: [],
  algorithmNotice:
    'Nearest-neighbor is deterministic but does not guarantee a globally optimal route.',
};

describe('miniapp RouteOrderExplanationService', () => {
  it('posts an explanation request with a Bearer token and validates the result', async () => {
    let authorization = '';
    let path = '';
    const service = new RouteOrderExplanationService(
      createClient(async (options) => {
        authorization = options.header?.Authorization ?? '';
        path = options.url;
        return { statusCode: 200, data: { success: true, data: explanation, requestId: 'e-1' } };
      }),
      createAuth('explain-token'),
    );

    await expect(service.estimateRouteOrderExplanation(input)).resolves.toEqual(explanation);
    expect(authorization).toBe('Bearer explain-token');
    expect(path).toContain('/routes/order/explain');
  });

  it('does not access network without a token and logs out on an invalid token', async () => {
    let requests = 0;
    const noToken = createAuth(undefined);
    const service = new RouteOrderExplanationService(
      createClient(async () => {
        requests += 1;
        throw new Error('network should not be called');
      }),
      noToken,
    );
    await expect(service.estimateRouteOrderExplanation(input)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(requests).toBe(0);

    const expiredAuth = createAuth('expired-token');
    const expired = new RouteOrderExplanationService(
      createClient(async () => ({
        statusCode: 401,
        data: {
          success: false,
          error: { code: 'AUTH_TOKEN_INVALID', message: 'The access token is invalid' },
          requestId: 'e-2',
        },
      })),
      expiredAuth,
    );
    await expect(expired.estimateRouteOrderExplanation(input)).rejects.toMatchObject({
      apiCode: 'AUTH_TOKEN_INVALID',
    });
    expect(expiredAuth.loggedOut).toBe(true);
  });

  it('rejects an explanation response with fabricated unavailable measurements', async () => {
    const service = new RouteOrderExplanationService(
      createClient(async () => ({
        statusCode: 200,
        data: {
          success: true,
          data: {
            ...explanation,
            decisions: [
              {
                ...explanation.decisions[0],
                candidates: [
                  {
                    destinationId: 'b',
                    status: 'unavailable',
                    durationSeconds: 800,
                    distanceMeters: 1_234,
                  },
                ],
              },
            ],
          },
          requestId: 'e-3',
        },
      })),
      createAuth('explain-token'),
    );
    await expect(service.estimateRouteOrderExplanation(input)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
