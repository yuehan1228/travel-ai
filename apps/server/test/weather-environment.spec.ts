import { describe, expect, it } from 'vitest';

import {
  createTestWeatherEnvironment,
  loadWeatherEnvironment,
} from '../src/modules/weather/config/weather-environment';

describe('loadWeatherEnvironment', () => {
  it('uses safe defaults and keeps the API key server-side', () => {
    expect(loadWeatherEnvironment({})).toMatchObject({
      provider: 'amap',
      requestTimeoutMs: 5_000,
      forecastHorizonDays: 4,
    });
    expect(createTestWeatherEnvironment().provider).toBe('amap');
  });

  it.each([
    ['an invalid timeout', { WEATHER_REQUEST_TIMEOUT_MS: '0' }],
    ['an invalid horizon', { WEATHER_FORECAST_HORIZON_DAYS: '15' }],
    ['an empty key', { WEATHER_API_KEY: '' }],
    ['an unsupported provider', { WEATHER_PROVIDER: 'qweather' }],
  ])('rejects %s', (_description, overrides) => {
    expect(() => loadWeatherEnvironment(overrides)).toThrow(
      'Invalid weather environment configuration',
    );
  });

  it('does not echo an API key in validation errors', () => {
    const key = 'secret-weather-key';
    expect(() =>
      loadWeatherEnvironment({ WEATHER_API_KEY: key, WEATHER_REQUEST_TIMEOUT_MS: 'not-a-number' }),
    ).toThrowError(expect.not.stringContaining(key));
  });
});
