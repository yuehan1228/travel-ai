import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  ApiFailureSchema,
  LoginResultSchema,
  RouteEstimateSchema,
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
  public unavailable = false;
  public mode: string | undefined;

  public async estimateRoute(input: {
    mode: 'walking' | 'driving';
  }): Promise<RouteProviderResult | undefined> {
    this.mode = input.mode;
    if (this.unavailable) return undefined;
    return {
      distanceMeters: input.mode === 'walking' ? 1_000 : 8_000,
      durationSeconds: input.mode === 'walking' ? 700 : 1_500,
      ...(input.mode === 'driving' ? { tollsCny: 2.5 } : {}),
      fetchedAt,
    };
  }
}

class FakeRouteRepository implements RouteCacheRepository {
  private value: RouteEstimate | undefined;

  public clear(): void {
    this.value = undefined;
  }

  public async findFresh(): Promise<RouteEstimate | undefined> {
    return this.value;
  }

  public async findStale(): Promise<RouteEstimate | undefined> {
    return this.value;
  }

  public async save(input: RouteCacheRecordInput): Promise<void> {
    this.value = input.payload;
  }
}

describe('Routes API', () => {
  let app: NestFastifyApplication;
  let provider: FakeRouteProvider;
  let repository: FakeRouteRepository;

  beforeAll(async () => {
    provider = new FakeRouteProvider();
    const routeEnvironment: RouteEnvironment = {
      provider: 'amap',
      apiKey: 'test-route-key',
      requestTimeoutMs: 500,
      cacheTtlSeconds: 600,
      staleIfErrorSeconds: 600,
    };
    app = await createApp(
      { nodeEnv: 'test', port: 0 },
      {
        authEnvironment: createTestAuthEnvironment(),
        wechatProvider: new FakeWechatProvider(),
        userRepository: new FakeUserRepository(),
        routeEnvironment,
        routeProvider: provider,
        routeCacheRepository: (repository = new FakeRouteRepository()),
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
        payload: { code: 'route-user' },
      });
    return createApiSuccessSchema(LoginResultSchema).parse(JSON.parse(response.payload)).data
      .accessToken;
  };

  const requestBody = {
    origin: { location: { longitude: 120.15, latitude: 30.25 } },
    destination: { location: { longitude: 120.18, latitude: 30.27 } },
  };

  it('rejects unauthenticated access', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/routes/estimate',
        payload: { ...requestBody, mode: 'walking' },
      });
    expect(response.statusCode).toBe(401);
    expect(ApiFailureSchema.parse(JSON.parse(response.payload)).error.code).toBe(
      'AUTH_TOKEN_INVALID',
    );
  });

  it.each(['walking', 'driving'] as const)(
    'returns a real %s estimate and request ID',
    async (mode) => {
      const token = await login();
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'POST',
          url: '/routes/estimate',
          headers: { authorization: `Bearer ${token}`, 'x-request-id': `route-${mode}` },
          payload: { ...requestBody, mode },
        });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBe(`route-${mode}`);
      const envelope = createApiSuccessSchema(RouteEstimateSchema).parse(
        JSON.parse(response.payload),
      );
      expect(envelope.data.dataSource).toBe('map_provider');
      expect(provider.mode).toBe(mode);
      if (mode === 'driving') expect(envelope.data).toHaveProperty('tollsCny', 2.5);
    },
  );

  it('maps unavailable and invalid input to stable errors', async () => {
    const token = await login();
    repository.clear();
    provider.unavailable = true;
    const unavailable = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/routes/estimate',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...requestBody, mode: 'walking' },
      });
    expect(unavailable.statusCode).toBe(404);
    expect(ApiFailureSchema.parse(JSON.parse(unavailable.payload)).error.code).toBe(
      'ROUTE_UNAVAILABLE',
    );
    provider.unavailable = false;

    const invalid = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/routes/estimate',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...requestBody, mode: 'transit' },
      });
    expect(invalid.statusCode).toBe(400);
    expect(ApiFailureSchema.parse(JSON.parse(invalid.payload)).error.code).toBe(
      'ROUTE_VALIDATION_ERROR',
    );
  });
});
