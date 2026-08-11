import { Inject, Injectable } from '@nestjs/common';

import {
  DailyWeatherSchema,
  GetWeatherInputSchema,
  WeatherResultSchema,
} from '@travel-guide/shared-schemas';
import type { DailyWeather, GetWeatherInput, WeatherResult } from '@travel-guide/shared-types';

import {
  CLIMATE_REFERENCE_PROVIDER,
  WEATHER_CACHE_REPOSITORY,
  WEATHER_CLOCK,
  WEATHER_PROVIDER,
} from './weather.tokens';
import { WeatherException } from './weather.errors';
import { systemWeatherClock, type WeatherClock } from './weather.clock';
import type {
  ClimateReferenceProvider,
  WeatherProvider,
  WeatherProviderInput,
  WeatherProviderResult,
} from './providers/weather.provider';
import type { WeatherCacheRepository } from './repositories/weather-cache.repository';

export const WEATHER_REFERENCE_NOTICE = '当前距离出行时间较远，以下天气为历史气候参考。';

const UTC_DAY_MS = 86_400_000;

const dateToUtc = (value: string): number => {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const addDays = (value: string, offset: number): string =>
  new Date(dateToUtc(value) + offset * UTC_DAY_MS).toISOString().slice(0, 10);

const dateRange = (startDate: string, endDate: string): string[] => {
  const totalDays = Math.floor((dateToUtc(endDate) - dateToUtc(startDate)) / UTC_DAY_MS) + 1;
  return Array.from({ length: totalDays }, (_, index) => addDays(startDate, index));
};

const minDate = (left: string, right: string): string => (left <= right ? left : right);
const maxDate = (left: string, right: string): string => (left >= right ? left : right);

const validationError = (): WeatherException =>
  new WeatherException('WEATHER_VALIDATION_ERROR', 400, 'The weather input is invalid');

const providerError = (): WeatherException =>
  new WeatherException('WEATHER_PROVIDER_ERROR', 502, 'Weather data is temporarily unavailable');

const persistenceError = (): WeatherException =>
  new WeatherException('WEATHER_PERSISTENCE_ERROR', 500, 'Weather data could not be persisted');

const normalizeDestination = (cityName: string, cityCode?: string) => ({
  cityName: cityName.trim(),
  ...(cityCode === undefined ? {} : { cityCode: cityCode.trim() }),
});

const sourcePriority = (days: DailyWeather[]): WeatherResult['source'] => {
  if (days.length === 0 || days.every((day) => day.source === 'unavailable')) {
    return 'unavailable';
  }
  if (days.some((day) => day.source === 'forecast')) {
    return 'forecast';
  }
  return 'climate_reference';
};

const validateProviderDays = (
  result: WeatherProviderResult,
  input: WeatherProviderInput,
  expectedSource: 'forecast' | 'climate_reference',
): DailyWeather[] => {
  if (result.source !== expectedSource) {
    throw providerError();
  }

  const byDate = new Map<string, DailyWeather>();
  for (const rawDay of result.days) {
    const parsed = DailyWeatherSchema.safeParse(rawDay);
    if (
      !parsed.success ||
      parsed.data.source !== expectedSource ||
      parsed.data.isReference !== (expectedSource === 'climate_reference')
    ) {
      throw providerError();
    }
    if (parsed.data.date < input.startDate || parsed.data.date > input.endDate) {
      throw providerError();
    }
    if (byDate.has(parsed.data.date)) {
      throw providerError();
    }
    byDate.set(parsed.data.date, parsed.data);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};

const unavailableDays = (dates: string[]): DailyWeather[] =>
  dates.map((date) => ({
    date,
    condition: 'unknown',
    conditionText: '暂无可用天气数据',
    source: 'unavailable',
    isReference: false,
  }));

const parseUnavailableCache = (
  cached: WeatherResult,
  destination: WeatherResult['destination'],
  requestedDates: string[],
): WeatherResult | undefined => {
  const parsed = WeatherResultSchema.safeParse(cached);
  if (!parsed.success || parsed.data.source !== 'unavailable') {
    return undefined;
  }
  if (
    parsed.data.destination.cityName !== destination.cityName ||
    parsed.data.destination.cityCode !== destination.cityCode ||
    parsed.data.days.length !== requestedDates.length
  ) {
    return undefined;
  }
  const datesMatch = parsed.data.days.every(
    (day, index) => day.source === 'unavailable' && day.date === requestedDates[index],
  );
  return datesMatch ? parsed.data : undefined;
};

const latestFetchedAt = (results: WeatherResult[]): string | undefined => {
  const values = results
    .map((result) => result.fetchedAt)
    .filter((value): value is string => value !== undefined)
    .sort();
  return values.at(-1);
};

@Injectable()
export class WeatherService {
  public constructor(
    @Inject(WEATHER_PROVIDER) private readonly provider: WeatherProvider,
    @Inject(CLIMATE_REFERENCE_PROVIDER)
    private readonly climateProvider: ClimateReferenceProvider,
    @Inject(WEATHER_CACHE_REPOSITORY)
    private readonly cacheRepository: WeatherCacheRepository,
    @Inject(WEATHER_CLOCK) private readonly clock: WeatherClock = systemWeatherClock,
  ) {}

  public async getWeather(input: GetWeatherInput): Promise<WeatherResult> {
    const parsedInput = GetWeatherInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw validationError();
    }

    const normalizedInput: GetWeatherInput = {
      ...parsedInput.data,
      destination: normalizeDestination(
        parsedInput.data.destination.cityName,
        parsedInput.data.destination.cityCode,
      ),
    };
    const now = this.clock.now();
    if (Number.isNaN(now.getTime())) {
      throw validationError();
    }

    const today = now.toISOString().slice(0, 10);
    const horizonEnd = addDays(today, Math.max(0, this.provider.forecastHorizonDays - 1));
    const forecastStart = maxDate(normalizedInput.startDate, today);
    const forecastEnd = minDate(normalizedInput.endDate, horizonEnd);
    const forecastDates = forecastStart <= forecastEnd ? dateRange(forecastStart, forecastEnd) : [];
    const requestedDates = dateRange(normalizedInput.startDate, normalizedInput.endDate);
    const destination = normalizedInput.destination;
    const providerInput = (startDate: string, endDate: string): WeatherProviderInput => ({
      cityName: destination.cityName,
      ...(destination.cityCode === undefined ? {} : { cityCode: destination.cityCode }),
      startDate,
      endDate,
    });

    // Keep a short negative cache for fully unavailable remote ranges. This avoids repeatedly
    // invoking a reference provider that has no data while retaining a bounded retry window.
    if (forecastDates.length === 0) {
      const unavailableInput = providerInput(normalizedInput.startDate, normalizedInput.endDate);
      const unavailableCacheKey = this.createCacheKey(
        unavailableInput,
        this.provider.name,
        'unavailable',
      );
      try {
        const cachedUnavailable = await this.cacheRepository.findValid(unavailableCacheKey, now);
        if (cachedUnavailable !== undefined) {
          const validatedCache = parseUnavailableCache(
            cachedUnavailable,
            destination,
            requestedDates,
          );
          if (validatedCache !== undefined) {
            return validatedCache;
          }
        }
      } catch {
        throw persistenceError();
      }
    }

    const fetchedSegments: WeatherResult[] = [];
    const forecastDays = new Map<string, DailyWeather>();
    let forecastFailure: WeatherException | undefined;

    if (forecastDates.length > 0) {
      const forecastInput = providerInput(forecastDates[0]!, forecastDates.at(-1)!);
      const forecastCacheKey = this.createCacheKey(forecastInput, this.provider.name, 'forecast');
      let cached: WeatherResult | undefined;
      try {
        cached = await this.cacheRepository.findValid(forecastCacheKey, now);
      } catch {
        throw persistenceError();
      }

      if (cached !== undefined) {
        const cachedDays = validateProviderDays(
          { days: cached.days, source: 'forecast', fetchedAt: cached.fetchedAt },
          forecastInput,
          'forecast',
        );
        const normalizedCached = this.createResult(destination, cachedDays, cached.fetchedAt);
        fetchedSegments.push(normalizedCached);
        for (const day of normalizedCached.days) {
          if (day.source === 'forecast') forecastDays.set(day.date, day);
        }
      } else {
        try {
          const result = await this.provider.getForecast(forecastInput);
          const days = validateProviderDays(result, forecastInput, 'forecast');
          for (const day of days) forecastDays.set(day.date, day);
          const payload = this.createResult(destination, days, result.fetchedAt);
          fetchedSegments.push(payload);
          await this.saveCache(
            forecastCacheKey,
            forecastInput,
            payload,
            'forecast',
            now,
            45 * 60 * 1000,
          );
        } catch (error: unknown) {
          if (error instanceof WeatherException && error.code === 'WEATHER_PERSISTENCE_ERROR') {
            throw error;
          }
          forecastFailure = providerError();
        }
      }
    }

    const missingDates = requestedDates.filter((date) => !forecastDays.has(date));
    const referenceDays = new Map<string, DailyWeather>();
    let referenceResult: WeatherResult | undefined;
    if (missingDates.length > 0) {
      const referenceInput = providerInput(missingDates[0]!, missingDates.at(-1)!);
      const referenceCacheKey = this.createCacheKey(
        referenceInput,
        this.provider.name,
        'climate_reference',
      );
      try {
        referenceResult = await this.cacheRepository.findValid(referenceCacheKey, now);
      } catch {
        throw persistenceError();
      }

      if (referenceResult === undefined) {
        try {
          const result = await this.climateProvider.getClimateReference(referenceInput);
          if (result !== undefined) {
            const days = validateProviderDays(result, referenceInput, 'climate_reference');
            referenceResult = this.createResult(destination, days, result.fetchedAt);
            await this.saveCache(
              referenceCacheKey,
              referenceInput,
              referenceResult,
              'climate_reference',
              now,
              60 * 24 * 60 * 60 * 1000,
            );
          }
        } catch (error: unknown) {
          if (error instanceof WeatherException && error.code === 'WEATHER_PERSISTENCE_ERROR') {
            throw error;
          }
          referenceResult = undefined;
        }
      }
      if (referenceResult !== undefined) {
        const normalizedReferenceDays = validateProviderDays(
          {
            days: referenceResult.days,
            source: 'climate_reference',
            fetchedAt: referenceResult.fetchedAt,
          },
          referenceInput,
          'climate_reference',
        );
        referenceResult = this.createResult(
          destination,
          normalizedReferenceDays,
          referenceResult.fetchedAt,
        );
      }
      for (const day of referenceResult?.days ?? []) {
        if (missingDates.includes(day.date)) referenceDays.set(day.date, day);
      }
    }

    const allDays = requestedDates.map((date) => forecastDays.get(date) ?? referenceDays.get(date));
    if (
      allDays.every((day) => day === undefined) &&
      forecastFailure !== undefined &&
      referenceResult === undefined
    ) {
      if (forecastDates.length > 0) throw forecastFailure;
    }

    const days = allDays.map((day, index) => day ?? unavailableDays([requestedDates[index]!])[0]!);
    const result = this.createResult(
      destination,
      days,
      latestFetchedAt(fetchedSegments.concat(referenceResult ? [referenceResult] : [])),
    );
    if (result.source === 'unavailable') {
      const unavailableInput = providerInput(normalizedInput.startDate, normalizedInput.endDate);
      await this.saveCache(
        this.createCacheKey(unavailableInput, this.provider.name, 'unavailable'),
        unavailableInput,
        result,
        'unavailable',
        now,
        5 * 60 * 1000,
      );
    }
    return WeatherResultSchema.parse(result);
  }

  public createCacheKey(
    input: WeatherProviderInput,
    providerName: string,
    source: 'forecast' | 'climate_reference' | 'unavailable',
  ): string {
    const cityName = input.cityName.trim().toLocaleLowerCase('zh-CN');
    const cityCode = input.cityCode?.trim().toLocaleLowerCase('en-US') ?? '';
    return [
      providerName.trim().toLowerCase(),
      source,
      cityName,
      cityCode,
      input.startDate,
      input.endDate,
    ]
      .map((part) => encodeURIComponent(part))
      .join('|');
  }

  private createResult(
    destination: WeatherResult['destination'],
    days: DailyWeather[],
    fetchedAt?: string,
  ): WeatherResult {
    const source = sourcePriority(days);
    const hasReference = days.some((day) => day.source === 'climate_reference');
    return {
      destination,
      days: [...days].sort((left, right) => left.date.localeCompare(right.date)),
      source,
      ...(hasReference ? { notice: WEATHER_REFERENCE_NOTICE } : {}),
      ...(fetchedAt === undefined ? {} : { fetchedAt }),
    };
  }

  private async saveCache(
    cacheKey: string,
    input: WeatherProviderInput,
    payload: WeatherResult,
    source: 'forecast' | 'climate_reference' | 'unavailable',
    fetchedAt: Date,
    ttlMs: number,
  ): Promise<void> {
    try {
      await this.cacheRepository.save({
        provider: this.provider.name,
        cacheKey,
        cityName: input.cityName,
        cityCode: input.cityCode,
        startDate: input.startDate,
        endDate: input.endDate,
        source,
        payload,
        fetchedAt,
        expiresAt: new Date(fetchedAt.getTime() + ttlMs),
      });
    } catch {
      throw persistenceError();
    }
  }
}

export { addDays, dateRange };
