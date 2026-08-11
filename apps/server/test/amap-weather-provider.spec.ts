import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AmapWeatherProvider,
  AMAP_WEATHER_URL,
} from '../src/modules/weather/providers/amap-weather.provider';
import type { WeatherEnvironment } from '../src/modules/weather/config/weather-environment';
import { UnavailableClimateReferenceProvider } from '../src/modules/weather/providers/unavailable-climate.provider';

const environment: WeatherEnvironment = {
  provider: 'amap',
  apiKey: 'test-key',
  requestTimeoutMs: 500,
  forecastHorizonDays: 4,
};

describe('AmapWeatherProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a valid provider response without exposing the raw payload', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            status: '1',
            info: 'OK',
            forecasts: [
              {
                city: '杭州',
                casts: [
                  {
                    date: '2026-08-12',
                    dayweather: '晴',
                    nightweather: '晴',
                    daytemp: '31',
                    nighttemp: '22',
                    daypower: '3',
                  },
                ],
              },
            ],
          }),
        };
      }),
    );

    const result = await new AmapWeatherProvider(environment).getForecast({
      cityName: '杭州',
      cityCode: '330100',
      startDate: '2026-08-12',
      endDate: '2026-08-12',
    });

    expect(requestedUrl.startsWith(`${AMAP_WEATHER_URL}?`)).toBe(true);
    expect(result).toMatchObject({ source: 'forecast' });
    expect(result.days[0]).toMatchObject({
      date: '2026-08-12',
      condition: 'clear',
      minTemperatureC: 22,
      maxTemperatureC: 31,
    });
    expect(JSON.stringify(result)).not.toContain('test-key');
  });

  it('maps HTTP and provider status failures to a stable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    await expect(
      new AmapWeatherProvider(environment).getForecast({
        cityName: '杭州',
        startDate: '2026-08-12',
        endDate: '2026-08-12',
      }),
    ).rejects.toMatchObject({ name: 'WeatherProviderError' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: '0', info: 'INVALID_USER_KEY' }),
      })),
    );
    await expect(
      new AmapWeatherProvider(environment).getForecast({
        cityName: '杭州',
        startDate: '2026-08-12',
        endDate: '2026-08-12',
      }),
    ).rejects.toMatchObject({ name: 'WeatherProviderError' });
  });

  it('aborts a slow request at the configured timeout', async () => {
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, options: { signal: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      ),
    );

    await expect(
      new AmapWeatherProvider({ ...environment, requestTimeoutMs: 5 }).getForecast({
        cityName: '杭州',
        startDate: '2026-08-12',
        endDate: '2026-08-12',
      }),
    ).rejects.toMatchObject({ name: 'WeatherProviderError' });
    expect(aborted).toBe(true);
  });

  it('does not fabricate climate data in the default fallback', async () => {
    await expect(
      new UnavailableClimateReferenceProvider().getClimateReference({
        cityName: '杭州',
        startDate: '2026-09-01',
        endDate: '2026-09-01',
      }),
    ).resolves.toBeUndefined();
  });
});
