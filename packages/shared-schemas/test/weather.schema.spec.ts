import { describe, expect, it } from 'vitest';

import { DailyWeatherSchema, GetWeatherInputSchema, WeatherResultSchema } from '../src';

const forecastDay = {
  date: '2026-08-12',
  condition: 'clear' as const,
  conditionText: '晴',
  minTemperatureC: 20,
  maxTemperatureC: 30,
  precipitationProbability: 10,
  humidityPercent: 60,
  source: 'forecast' as const,
  isReference: false,
};

describe('weather schemas', () => {
  it('accepts forecast and climate reference inputs', () => {
    expect(
      GetWeatherInputSchema.safeParse({
        destination: { cityName: '杭州', cityCode: '330100' },
        startDate: '2026-08-12',
        endDate: '2026-08-13',
      }).success,
    ).toBe(true);
    expect(
      WeatherResultSchema.safeParse({
        destination: { cityName: '杭州' },
        days: [{ ...forecastDay, date: '2026-08-12' }],
        source: 'forecast',
      }).success,
    ).toBe(true);
    expect(
      WeatherResultSchema.safeParse({
        destination: { cityName: '杭州' },
        days: [
          {
            date: '2026-09-01',
            condition: 'unknown',
            conditionText: '暂无可用天气数据',
            source: 'unavailable',
            isReference: false,
          },
        ],
        source: 'unavailable',
      }).success,
    ).toBe(true);
  });

  it('rejects invalid ranges, values and unknown fields', () => {
    expect(
      GetWeatherInputSchema.safeParse({
        destination: { cityName: '杭州' },
        startDate: '2026-09-03',
        endDate: '2026-09-01',
      }).success,
    ).toBe(false);
    expect(
      GetWeatherInputSchema.safeParse({
        destination: { cityName: '杭州' },
        startDate: '2026-08-01',
        endDate: '2026-08-20',
      }).success,
    ).toBe(false);
    expect(DailyWeatherSchema.safeParse({ ...forecastDay, humidityPercent: 101 }).success).toBe(
      false,
    );
    expect(DailyWeatherSchema.safeParse({ ...forecastDay, extra: true }).success).toBe(false);
    expect(DailyWeatherSchema.safeParse({ ...forecastDay, minTemperatureC: 35 }).success).toBe(
      false,
    );
  });

  it('requires reference notice and validates unavailable condition', () => {
    const climate = {
      destination: { cityName: '杭州' },
      days: [
        {
          date: '2026-09-01',
          condition: 'cloudy' as const,
          conditionText: '历史气候参考：多云',
          source: 'climate_reference' as const,
          isReference: true,
        },
      ],
      source: 'climate_reference' as const,
    };
    expect(WeatherResultSchema.safeParse(climate).success).toBe(false);
    expect(
      WeatherResultSchema.safeParse({
        ...climate,
        notice: '当前距离出行时间较远，以下天气为历史气候参考。',
      }).success,
    ).toBe(true);
    expect(
      WeatherResultSchema.safeParse({
        destination: { cityName: '杭州' },
        days: [
          { ...forecastDay, date: '2026-08-12' },
          {
            date: '2026-09-01',
            condition: 'cloudy' as const,
            conditionText: '历史气候参考：多云',
            source: 'climate_reference' as const,
            isReference: true,
          },
        ],
        source: 'forecast',
      }).success,
    ).toBe(false);
    expect(
      DailyWeatherSchema.safeParse({
        date: '2026-09-01',
        condition: 'clear',
        conditionText: '错误',
        source: 'unavailable',
        isReference: false,
      }).success,
    ).toBe(false);
    expect(
      DailyWeatherSchema.safeParse({
        date: '2026-09-01',
        condition: 'unknown',
        conditionText: '暂无可用天气数据',
        minTemperatureC: 1,
        source: 'unavailable',
        isReference: false,
      }).success,
    ).toBe(false);
    expect(
      WeatherResultSchema.safeParse({
        destination: { cityName: '杭州' },
        days: [{ ...forecastDay, date: '2026-08-12' }],
        source: 'unavailable',
      }).success,
    ).toBe(false);
  });
});
