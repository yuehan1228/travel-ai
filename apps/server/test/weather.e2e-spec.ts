import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  ApiFailureSchema,
  LoginResultSchema,
  WeatherResultSchema,
  createApiSuccessSchema,
} from '@travel-guide/shared-schemas';
import type { DailyWeather, WeatherResult } from '@travel-guide/shared-types';

import { createApp } from '../src/create-app';
import { createTestAuthEnvironment } from '../src/modules/auth/config/auth-environment';
import type { UserRecord, UserRepository } from '../src/modules/auth/repositories/user.repository';
import type { WechatProvider } from '../src/modules/auth/providers/wechat.provider';
import type {
  ClimateReferenceProvider,
  WeatherProvider,
  WeatherProviderInput,
  WeatherProviderResult,
} from '../src/modules/weather/providers/weather.provider';
import type {
  WeatherCacheRecordInput,
  WeatherCacheRepository,
} from '../src/modules/weather/repositories/weather-cache.repository';
import type { WeatherClock } from '../src/modules/weather/weather.clock';

const userId = '123e4567-e89b-12d3-a456-426614174000';

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

class FakeClock implements WeatherClock {
  public now(): Date {
    return new Date('2026-08-11T00:00:00.000Z');
  }
}

class FakeWeatherProvider implements WeatherProvider {
  public readonly name = 'fake';
  public readonly forecastHorizonDays = 4;
  public async getForecast(input: WeatherProviderInput): Promise<WeatherProviderResult> {
    return {
      source: 'forecast',
      days: [input.startDate, input.endDate].map((date) => ({
        date,
        condition: 'clear' as const,
        conditionText: '晴',
        source: 'forecast' as const,
        isReference: false,
      })),
    };
  }
}

class FakeClimateProvider implements ClimateReferenceProvider {
  public async getClimateReference(input: WeatherProviderInput): Promise<WeatherProviderResult> {
    return {
      source: 'climate_reference',
      days: [input.startDate, input.endDate].map((date) => ({
        date,
        condition: 'cloudy' as const,
        conditionText: '历史气候参考：多云',
        source: 'climate_reference' as const,
        isReference: true,
      })),
    };
  }
}

class FakeWeatherCache implements WeatherCacheRepository {
  private readonly values = new Map<string, { payload: WeatherResult; expiresAt: Date }>();

  public async findValid(cacheKey: string, now: Date): Promise<WeatherResult | undefined> {
    const value = this.values.get(cacheKey);
    return value !== undefined && value.expiresAt > now ? value.payload : undefined;
  }

  public async save(input: WeatherCacheRecordInput): Promise<void> {
    this.values.set(input.cacheKey, { payload: input.payload, expiresAt: input.expiresAt });
  }
}

describe('Weather API', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(
      { nodeEnv: 'test', port: 0 },
      {
        authEnvironment: createTestAuthEnvironment(),
        wechatProvider: new FakeWechatProvider(),
        userRepository: new FakeUserRepository(),
        weatherProvider: new FakeWeatherProvider(),
        climateReferenceProvider: new FakeClimateProvider(),
        weatherCacheRepository: new FakeWeatherCache(),
        weatherClock: new FakeClock(),
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async (): Promise<string> => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/auth/login',
        payload: { code: 'weather-user' },
      });
    return createApiSuccessSchema(LoginResultSchema).parse(JSON.parse(response.payload)).data
      .accessToken;
  };

  it('rejects unauthenticated access', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/weather?cityName=杭州&startDate=2026-08-12&endDate=2026-08-13',
    });
    expect(response.statusCode).toBe(401);
    expect(ApiFailureSchema.parse(JSON.parse(response.payload)).error.code).toBe(
      'AUTH_TOKEN_INVALID',
    );
  });

  it('returns a schema-valid forecast and preserves request id', async () => {
    const token = await login();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/weather?cityName=%E6%9D%AD%E5%B7%9E&startDate=2026-08-12&endDate=2026-08-13',
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'weather-request-1' },
      });
    const envelope = createApiSuccessSchema(WeatherResultSchema).parse(
      JSON.parse(response.payload),
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('weather-request-1');
    expect(envelope.data.source).toBe('forecast');
  });

  it('returns climate reference for a remote date', async () => {
    const token = await login();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/weather?cityName=%E6%9D%AD%E5%B7%9E&startDate=2026-09-01&endDate=2026-09-02',
        headers: { authorization: `Bearer ${token}` },
      });
    const body = JSON.parse(response.payload) as { data: WeatherResult };
    expect(response.statusCode).toBe(200);
    expect(body.data.source).toBe('climate_reference');
    expect(body.data.notice).toBe('当前距离出行时间较远，以下天气为历史气候参考。');
  });

  it('maps invalid query parameters to WEATHER_VALIDATION_ERROR', async () => {
    const token = await login();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/weather?cityName=&startDate=2026-09-03&endDate=2026-09-01',
        headers: { authorization: `Bearer ${token}` },
      });
    expect(response.statusCode).toBe(400);
    expect(ApiFailureSchema.parse(JSON.parse(response.payload)).error.code).toBe(
      'WEATHER_VALIDATION_ERROR',
    );
  });
});

export type { DailyWeather };
