import { jsonb, pgTable, timestamp, uuid, varchar, date, index } from 'drizzle-orm/pg-core';

import type { WeatherResult } from '@travel-guide/shared-types';

export const weatherCache = pgTable(
  'weather_cache',
  {
    id: uuid('id').primaryKey(),
    provider: varchar('provider', { length: 64 }).notNull(),
    cacheKey: varchar('cache_key', { length: 512 }).notNull().unique(),
    cityName: varchar('city_name', { length: 100 }).notNull(),
    cityCode: varchar('city_code', { length: 32 }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    source: varchar('source', { length: 32 }).notNull(),
    payload: jsonb('payload').$type<WeatherResult>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('weather_cache_expires_idx').on(table.expiresAt)],
);

export type WeatherCache = typeof weatherCache.$inferSelect;
export type NewWeatherCache = typeof weatherCache.$inferInsert;
