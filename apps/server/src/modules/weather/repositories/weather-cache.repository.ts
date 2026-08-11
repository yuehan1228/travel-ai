import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { WeatherResultSchema } from '@travel-guide/shared-schemas';
import type { WeatherDataSource, WeatherResult } from '@travel-guide/shared-types';

import { DATABASE } from '../../../database/database.tokens';
import type { Database } from '../../../database/database.types';
import { weatherCache } from '../../../database/schema/weather-cache.schema';
import { WEATHER_CACHE_REPOSITORY } from '../weather.tokens';

export interface WeatherCacheRecordInput {
  readonly provider: string;
  readonly cacheKey: string;
  readonly cityName: string;
  readonly cityCode?: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly source: WeatherDataSource;
  readonly payload: WeatherResult;
  readonly fetchedAt: Date;
  readonly expiresAt: Date;
}

export interface WeatherCacheRepository {
  findValid(cacheKey: string, now: Date): Promise<WeatherResult | undefined>;
  save(input: WeatherCacheRecordInput): Promise<void>;
}

@Injectable()
export class DrizzleWeatherCacheRepository implements WeatherCacheRepository {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public async findValid(cacheKey: string, now: Date): Promise<WeatherResult | undefined> {
    const rows = await this.database
      .select()
      .from(weatherCache)
      .where(and(eq(weatherCache.cacheKey, cacheKey), gt(weatherCache.expiresAt, now)))
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }

    const parsed = WeatherResultSchema.safeParse(row.payload);
    return parsed.success ? parsed.data : undefined;
  }

  public async save(input: WeatherCacheRecordInput): Promise<void> {
    const payload = WeatherResultSchema.parse(input.payload);
    await this.database
      .insert(weatherCache)
      .values({
        id: randomUUID(),
        provider: input.provider,
        cacheKey: input.cacheKey,
        cityName: input.cityName,
        cityCode: input.cityCode,
        startDate: input.startDate,
        endDate: input.endDate,
        source: input.source,
        payload,
        fetchedAt: input.fetchedAt,
        expiresAt: input.expiresAt,
      })
      .onConflictDoUpdate({
        target: weatherCache.cacheKey,
        set: {
          provider: input.provider,
          cityName: input.cityName,
          cityCode: input.cityCode,
          startDate: input.startDate,
          endDate: input.endDate,
          source: input.source,
          payload,
          fetchedAt: input.fetchedAt,
          expiresAt: input.expiresAt,
        },
      });
  }
}

export { WEATHER_CACHE_REPOSITORY };
