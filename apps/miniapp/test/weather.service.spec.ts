import { describe, expect, it } from 'vitest';

import type { GetWeatherInput } from '@travel-guide/shared-types';

import { createHttpClient, type RequestAdapter } from '../services/http-client';
import { RequestError } from '../services/request-error';
import { WeatherService, type WeatherAuthService } from '../services/weather.service';

const input: GetWeatherInput = {
  destination: { cityName: '杭州', cityCode: '330100' },
  startDate: '2026-08-12',
  endDate: '2026-08-13',
};

const result = {
  destination: input.destination,
  days: [
    {
      date: '2026-08-12',
      condition: 'clear' as const,
      conditionText: '晴',
      source: 'forecast' as const,
      isReference: false,
    },
    {
      date: '2026-08-13',
      condition: 'clear' as const,
      conditionText: '晴',
      source: 'forecast' as const,
      isReference: false,
    },
  ],
  source: 'forecast' as const,
};

const createAuth = (token: string | undefined): WeatherAuthService & { loggedOut: boolean } => {
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

describe('miniapp WeatherService', () => {
  it('attaches a Bearer token and parses API success data', async () => {
    let authorization = '';
    let path = '';
    const service = new WeatherService(
      createClient(async (options) => {
        authorization = options.header?.Authorization ?? '';
        path = options.url;
        return {
          statusCode: 200,
          data: { success: true, data: result, requestId: 'weather-1' },
        };
      }),
      createAuth('weather-token'),
    );

    await expect(service.getWeather(input)).resolves.toEqual(result);
    expect(authorization).toBe('Bearer weather-token');
    expect(path).toContain('/weather?cityName=%E6%9D%AD%E5%B7%9E');
  });

  it('does not access the network when token is missing', async () => {
    let requests = 0;
    const service = new WeatherService(
      createClient(async () => {
        requests += 1;
        throw new Error('network should not be called');
      }),
      createAuth(undefined),
    );

    await expect(service.getWeather(input)).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
    expect(requests).toBe(0);
  });

  it('clears auth state when the API rejects the token', async () => {
    const auth = createAuth('expired-token');
    const service = new WeatherService(
      createClient(async () => ({
        statusCode: 401,
        data: {
          success: false,
          error: { code: 'AUTH_TOKEN_INVALID', message: 'The access token is invalid' },
          requestId: 'weather-2',
        },
      })),
      auth,
    );

    await expect(service.getWeather(input)).rejects.toMatchObject({
      code: 'API_ERROR',
      apiCode: 'AUTH_TOKEN_INVALID',
    });
    expect(auth.loggedOut).toBe(true);
  });

  it('validates malformed input before making a request', async () => {
    let requests = 0;
    const service = new WeatherService(
      createClient(async () => {
        requests += 1;
        throw new RequestError({ code: 'NETWORK_ERROR', message: 'not used' });
      }),
      createAuth('weather-token'),
    );

    await expect(
      service.getWeather({ ...input, endDate: '2026-09-01', startDate: '2026-08-01' }),
    ).rejects.toThrow();
    expect(requests).toBe(0);
  });
});
