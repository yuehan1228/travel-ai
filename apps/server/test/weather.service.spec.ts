import { describe, expect, it } from 'vitest';

import type { WeatherResult } from '@travel-guide/shared-types';

import { WeatherService } from '../src/modules/weather/weather.service';
import type { WeatherClock } from '../src/modules/weather/weather.clock';
import type {
  WeatherProvider,
  ClimateReferenceProvider,
  WeatherProviderInput,
  WeatherProviderResult,
} from '../src/modules/weather/providers/weather.provider';
import type {
  WeatherCacheRecordInput,
  WeatherCacheRepository,
} from '../src/modules/weather/repositories/weather-cache.repository';

const destination = { cityName: '杭州', cityCode: '330100' };

class FakeClock implements WeatherClock {
  public now(): Date {
    return new Date('2026-08-11T00:00:00.000Z');
  }
}

class MemoryCache implements WeatherCacheRepository {
  public readonly values = new Map<string, { payload: WeatherResult; expiresAt: Date }>();

  public async findValid(cacheKey: string, now: Date): Promise<WeatherResult | undefined> {
    const value = this.values.get(cacheKey);
    return value !== undefined && value.expiresAt > now ? value.payload : undefined;
  }

  public async save(input: WeatherCacheRecordInput): Promise<void> {
    this.values.set(input.cacheKey, { payload: input.payload, expiresAt: input.expiresAt });
  }
}

class FakeForecastProvider implements WeatherProvider {
  public readonly name = 'fake-forecast';
  public readonly forecastHorizonDays = 3;
  public calls = 0;

  public async getForecast(input: WeatherProviderInput): Promise<WeatherProviderResult> {
    this.calls += 1;
    return {
      source: 'forecast',
      days: [input.startDate, input.endDate].map((date) => ({
        date,
        condition: 'clear' as const,
        conditionText: '晴',
        minTemperatureC: 20,
        maxTemperatureC: 30,
        source: 'forecast' as const,
        isReference: false,
      })),
      fetchedAt: '2026-08-11T00:00:00.000Z',
    };
  }
}

class FakeClimateProvider implements ClimateReferenceProvider {
  public calls = 0;
  public async getClimateReference(input: WeatherProviderInput): Promise<WeatherProviderResult> {
    this.calls += 1;
    return {
      source: 'climate_reference',
      days: [input.startDate, input.endDate].map((date) => ({
        date,
        condition: 'cloudy' as const,
        conditionText: '历史气候参考：多云',
        source: 'climate_reference' as const,
        isReference: true,
      })),
      fetchedAt: '2026-08-11T00:00:00.000Z',
    };
  }
}

class FailingForecastProvider extends FakeForecastProvider {
  public override async getForecast(input: WeatherProviderInput): Promise<WeatherProviderResult> {
    void input;
    this.calls += 1;
    throw new Error('provider timeout');
  }
}

const createService = () => {
  const forecast = new FakeForecastProvider();
  const climate = new FakeClimateProvider();
  const cache = new MemoryCache();
  return {
    service: new WeatherService(forecast, climate, cache, new FakeClock()),
    forecast,
    climate,
    cache,
  };
};

describe('WeatherService', () => {
  it('uses forecast for dates inside the provider horizon', async () => {
    const { service, forecast, climate } = createService();
    const result = await service.getWeather({
      destination,
      startDate: '2026-08-12',
      endDate: '2026-08-13',
    });

    expect(result.source).toBe('forecast');
    expect(result.days.every((day) => day.source === 'forecast')).toBe(true);
    expect(forecast.calls).toBe(1);
    expect(climate.calls).toBe(0);
  });

  it('uses climate reference for dates beyond the forecast horizon', async () => {
    const { service, forecast, climate } = createService();
    const result = await service.getWeather({
      destination,
      startDate: '2026-09-01',
      endDate: '2026-09-02',
    });

    expect(result.source).toBe('climate_reference');
    expect(result.notice).toBe('当前距离出行时间较远，以下天气为历史气候参考。');
    expect(result.days.every((day) => day.isReference)).toBe(true);
    expect(forecast.calls).toBe(0);
    expect(climate.calls).toBe(1);
  });

  it('caches a forecast segment and avoids a second provider call', async () => {
    const { service, forecast } = createService();
    const input = { destination, startDate: '2026-08-12', endDate: '2026-08-13' };
    await service.getWeather(input);
    await service.getWeather(input);
    expect(forecast.calls).toBe(1);
  });

  it('merges forecast and reference days for a partially remote range', async () => {
    const { service, forecast, climate } = createService();
    const result = await service.getWeather({
      destination,
      startDate: '2026-08-12',
      endDate: '2026-08-15',
    });

    expect(result.source).toBe('forecast');
    expect(result.notice).toBe('当前距离出行时间较远，以下天气为历史气候参考。');
    expect(result.days.map((day) => day.source)).toEqual([
      'forecast',
      'forecast',
      'climate_reference',
      'climate_reference',
    ]);
    expect(forecast.calls).toBe(1);
    expect(climate.calls).toBe(1);
  });

  it('falls back to climate reference when the forecast provider fails', async () => {
    const forecast = new FailingForecastProvider();
    const climate = new FakeClimateProvider();
    const service = new WeatherService(forecast, climate, new MemoryCache(), new FakeClock());
    const result = await service.getWeather({
      destination,
      startDate: '2026-08-12',
      endDate: '2026-08-13',
    });

    expect(result.source).toBe('climate_reference');
    expect(result.days[0]?.isReference).toBe(true);
    expect(forecast.calls).toBe(1);
    expect(climate.calls).toBe(1);
  });

  it('uses an unavailable negative cache without repeating the climate call', async () => {
    const climate = {
      calls: 0,
      getClimateReference: async (): Promise<undefined> => {
        climate.calls += 1;
        return undefined;
      },
    };
    const service = new WeatherService(
      new FakeForecastProvider(),
      climate,
      new MemoryCache(),
      new FakeClock(),
    );
    const input = { destination, startDate: '2026-09-01', endDate: '2026-09-01' };
    await expect(service.getWeather(input)).resolves.toMatchObject({ source: 'unavailable' });
    await expect(service.getWeather(input)).resolves.toMatchObject({ source: 'unavailable' });
    expect(climate.calls).toBe(1);
  });

  it('ignores an unavailable cache payload whose dates do not match the request', async () => {
    const forecast = new FakeForecastProvider();
    const climate = {
      calls: 0,
      getClimateReference: async (): Promise<undefined> => {
        climate.calls += 1;
        return undefined;
      },
    };
    const cache = new MemoryCache();
    const service = new WeatherService(forecast, climate, cache, new FakeClock());
    const input = { destination, startDate: '2026-09-01', endDate: '2026-09-01' };
    const cacheKey = service.createCacheKey(
      {
        cityName: destination.cityName,
        cityCode: destination.cityCode,
        startDate: input.startDate,
        endDate: input.endDate,
      },
      forecast.name,
      'unavailable',
    );
    cache.values.set(cacheKey, {
      payload: {
        destination,
        days: [
          {
            date: '2026-09-02',
            condition: 'unknown',
            conditionText: '暂无可用天气数据',
            source: 'unavailable',
            isReference: false,
          },
        ],
        source: 'unavailable',
      },
      expiresAt: new Date('2026-08-12T00:00:00.000Z'),
    });

    await expect(service.getWeather(input)).resolves.toMatchObject({ source: 'unavailable' });
    expect(climate.calls).toBe(1);
  });

  it('retries the forecast provider after an expired cache entry', async () => {
    const { service, forecast, cache } = createService();
    const input = { destination, startDate: '2026-08-12', endDate: '2026-08-13' };
    await service.getWeather(input);
    for (const value of cache.values.values()) {
      value.expiresAt = new Date('2026-08-10T00:00:00.000Z');
    }
    await service.getWeather(input);
    expect(forecast.calls).toBe(2);
  });

  it('rejects invalid date ranges', async () => {
    const { service } = createService();
    await expect(
      service.getWeather({ destination, startDate: '2026-09-03', endDate: '2026-09-01' }),
    ).rejects.toMatchObject({ code: 'WEATHER_VALIDATION_ERROR' });
  });

  it('returns unavailable without inventing values when climate data is absent', async () => {
    const forecast = new FakeForecastProvider();
    const cache = new MemoryCache();
    const service = new WeatherService(
      forecast,
      { getClimateReference: async () => undefined },
      cache,
      new FakeClock(),
    );
    const result = await service.getWeather({
      destination,
      startDate: '2026-09-01',
      endDate: '2026-09-01',
    });

    expect(result.source).toBe('unavailable');
    expect(result.days[0]).toMatchObject({
      condition: 'unknown',
      source: 'unavailable',
      isReference: false,
    });
    expect(result.days[0]?.minTemperatureC).toBeUndefined();
  });
});
