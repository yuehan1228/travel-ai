import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type { Place, PlaceCategory } from '@travel-guide/shared-types';

export const pois = pgTable(
  'pois',
  {
    id: uuid('id').primaryKey(),
    provider: varchar('provider', { length: 64 }).notNull(),
    providerPlaceId: varchar('provider_place_id', { length: 128 }).notNull(),
    cityName: varchar('city_name', { length: 100 }).notNull(),
    cityCode: varchar('city_code', { length: 32 }),
    name: varchar('name', { length: 200 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    categoryText: varchar('category_text', { length: 100 }).notNull(),
    address: text('address').notNull(),
    longitude: numeric('longitude', { precision: 10, scale: 7, mode: 'number' }).notNull(),
    latitude: numeric('latitude', { precision: 9, scale: 7, mode: 'number' }).notNull(),
    rating: numeric('rating', { precision: 2, scale: 1, mode: 'number' }),
    openingHours: text('opening_hours'),
    telephone: varchar('telephone', { length: 64 }),
    rawTypeCode: varchar('raw_type_code', { length: 32 }),
    payload: jsonb('payload').$type<Place>().notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pois_provider_place_unique').on(table.provider, table.providerPlaceId),
    index('pois_city_idx').on(table.cityName),
    index('pois_city_code_idx').on(table.cityCode),
    index('pois_category_idx').on(table.category),
    index('pois_expires_idx').on(table.expiresAt),
    check('pois_longitude_check', sql`${table.longitude} between -180 and 180`),
    check('pois_latitude_check', sql`${table.latitude} between -90 and 90`),
    check('pois_rating_check', sql`${table.rating} is null or ${table.rating} between 0 and 5`),
  ],
);

export const poiSearchCache = pgTable(
  'poi_search_cache',
  {
    id: uuid('id').primaryKey(),
    cacheKey: varchar('cache_key', { length: 768 }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    cityName: varchar('city_name', { length: 100 }).notNull(),
    cityCode: varchar('city_code', { length: 32 }),
    keyword: varchar('keyword', { length: 100 }),
    categories: jsonb('categories').$type<PlaceCategory[]>().notNull(),
    page: integer('page').notNull(),
    pageSize: integer('page_size').notNull(),
    placeIds: jsonb('place_ids').$type<string[]>().notNull(),
    total: integer('total').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('poi_search_cache_key_unique').on(table.cacheKey),
    index('poi_search_cache_expires_idx').on(table.expiresAt),
    check('poi_search_cache_page_check', sql`${table.page} >= 1`),
    check('poi_search_cache_page_size_check', sql`${table.pageSize} between 1 and 50`),
    check('poi_search_cache_total_check', sql`${table.total} >= 0`),
  ],
);

export type Poi = typeof pois.$inferSelect;
export type NewPoi = typeof pois.$inferInsert;
export type PoiSearchCache = typeof poiSearchCache.$inferSelect;
export type NewPoiSearchCache = typeof poiSearchCache.$inferInsert;
