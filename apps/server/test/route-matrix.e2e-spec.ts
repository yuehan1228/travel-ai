import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  ApiFailureSchema,
  LoginResultSchema,
  RouteMatrixResultSchema,
  createApiSuccessSchema,
} from '@travel-guide/shared-schemas';
import type { RouteEstimate } from '@travel-guide/shared-types';

import { createApp } from '../src/create-app';
import { createTestAuthEnvironment } from '../src/modules/auth/config/auth-environment';
import type { UserRecord, UserRepository } from '../src/modules/auth/repositories/user.repository';
import type { WechatProvider } from '../src/modules/auth/providers/wechat.provider';
import type { RouteEnvironment } from '../src/modules/routes/config/route-environment';
import type { RouteClock } from '../src/modules/routes/route.clock';
import type {
  RouteProvider,
  RouteProviderResult,
} from '../src/modules/routes/providers/route.provider';
import type {
  RouteCacheRecordInput,
  RouteCacheRepository,
} from '../src/modules/routes/repositories/route-cache.repository';

const userId = '123e4567-e89b-12d3-a456-426614174000';
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

class FakeClock implements RouteClock {
  public now(): Date {
    return new Date(fetchedAt);
  }
}

class FakeRouteProvider implements RouteProvider {
  public readonly name = 'fake';
  public readonly unavailablePairs = new Set<string>();
  public fail = false;

  public async estimateRoute(input: {
    origin: { location: { longitude: number } };
    destination: { location: { longitude: number } };
    mode: 'walking' | 'driving';
  }): Promise<RouteProviderResult | undefined> {
    if (this.fail) throw new Error('provider failed');
    const pair = `${input.origin.location.longitude},${input.destination.location.longitude}`;
    if (this.unavailablePairs.has(pair)) return undefined;
    return {
      distanceMeters: input.mode === 'walking' ? 1_000 : 8_000,
      durationSeconds: input.mode === 'walking' ? 700 : 1_500,
      ...(input.mode === 'driving' ? { tollsCny: 2.5 } : {}),
      fetchedAt,
    };
  }
}

class FakeRouteRepository implements RouteCacheRepository {
  private readonly values = new Map<string, RouteEstimate>();

  public clear(): void {
    this.values.clear();
  }

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

describe('Route matrix API', () => {
  let app: NestFastifyApplication;
  let provider: FakeRouteProvider;
  let repository: FakeRouteRepository;

  beforeAll(async () => {
    const routeEnvironment: RouteEnvironment = {
      provider: 'amap',
      apiKey: 'test-route-key',
      requestTimeoutMs: 500,
      cacheTtlSeconds: 600,
      staleIfErrorSeconds: 600,
    };
    provider = new FakeRouteProvider();
    repository = new FakeRouteRepository();
    app = await createApp(
      { nodeEnv: 'test', port: 0 },
      {
        authEnvironment: createTestAuthEnvironment(),
        wechatProvider: new FakeWechatProvider(),
        userRepository: new FakeUserRepository(),
        routeEnvironment,
        routeProvider: provider,
        routeCacheRepository: repository,
        routeClock: new FakeClock(),
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
        payload: { code: 'route-matrix-user' },
      });
    return createApiSuccessSchema(LoginResultSchema).parse(JSON.parse(response.payload)).data
      .accessToken;
  };

  const payload = {
    mode: 'walking' as const,
    points: [
      { id: 'start', endpoint: { location: { longitude: 120.15, latitude: 30.25 } } },
      { id: 'finish', endpoint: { location: { longitude: 120.18, latitude: 30.27 } } },
    ],
  };

  it('requires authentication and validates matrix input', async () => {
    const unauthenticated = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/routes/matrix',
      payload,
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(ApiFailureSchema.parse(JSON.parse(unauthenticated.payload)).error.code).toBe(
      'AUTH_TOKEN_INVALID',
    );

    const token = await login();
    const invalid = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/routes/matrix',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          ...payload,
          points: [
            { ...payload.points[0], id: 'same' },
            { ...payload.points[1], id: 'same' },
          ],
        },
      });
    expect(invalid.statusCode).toBe(400);
    expect(ApiFailureSchema.parse(JSON.parse(invalid.payload)).error.code).toBe(
      'ROUTE_MATRIX_VALIDATION_ERROR',
    );
  });

  it('returns directed cells with an envelope/header request ID', async () => {
    const token = await login();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/routes/matrix',
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'matrix-request-1' },
        payload,
      });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('matrix-request-1');
    const envelope = createApiSuccessSchema(RouteMatrixResultSchema).parse(
      JSON.parse(response.payload),
    );
    expect(envelope.requestId).toBe('matrix-request-1');
    expect(envelope.data.cells).toHaveLength(2);
    expect(envelope.data.cells.map((cell) => `${cell.originId}->${cell.destinationId}`)).toEqual([
      'start->finish',
      'finish->start',
    ]);
  });

  it('keeps partial unavailable cells and maps an entirely unavailable matrix', async () => {
    const token = await login();
    repository.clear();
    provider.unavailablePairs.add('120.15,120.18');
    const partial = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/routes/matrix',
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
    expect(partial.statusCode).toBe(200);
    const partialEnvelope = createApiSuccessSchema(RouteMatrixResultSchema).parse(
      JSON.parse(partial.payload),
    );
    expect(partialEnvelope.data.cells.filter((cell) => cell.status === 'unavailable')).toHaveLength(
      1,
    );

    provider.unavailablePairs.add('120.18,120.15');
    repository.clear();
    const unavailable = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/routes/matrix',
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
    expect(unavailable.statusCode).toBe(404);
    expect(ApiFailureSchema.parse(JSON.parse(unavailable.payload)).error.code).toBe(
      'ROUTE_MATRIX_UNAVAILABLE',
    );
  });
});
