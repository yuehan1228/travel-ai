import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type { RouteEstimate } from '@travel-guide/shared-types';

export const routeCache = pgTable(
  'route_cache',
  {
    id: uuid('id').primaryKey(),
    provider: varchar('provider', { length: 64 }).notNull(),
    cacheKey: varchar('cache_key', { length: 128 }).notNull().unique(),
    mode: varchar('mode', { length: 16 }).notNull(),
    originLongitude: numeric('origin_longitude', {
      precision: 10,
      scale: 7,
      mode: 'number',
    }).notNull(),
    originLatitude: numeric('origin_latitude', {
      precision: 9,
      scale: 7,
      mode: 'number',
    }).notNull(),
    destinationLongitude: numeric('destination_longitude', {
      precision: 10,
      scale: 7,
      mode: 'number',
    }).notNull(),
    destinationLatitude: numeric('destination_latitude', {
      precision: 9,
      scale: 7,
      mode: 'number',
    }).notNull(),
    payload: jsonb('payload').$type<RouteEstimate>().notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('route_cache_expires_idx').on(table.expiresAt),
    check('route_cache_mode_check', sql`${table.mode} in ('walking', 'driving')`),
    check('route_cache_origin_longitude_check', sql`${table.originLongitude} between -180 and 180`),
    check('route_cache_origin_latitude_check', sql`${table.originLatitude} between -90 and 90`),
    check(
      'route_cache_destination_longitude_check',
      sql`${table.destinationLongitude} between -180 and 180`,
    ),
    check(
      'route_cache_destination_latitude_check',
      sql`${table.destinationLatitude} between -90 and 90`,
    ),
  ],
);

export type RouteCache = typeof routeCache.$inferSelect;
export type NewRouteCache = typeof routeCache.$inferInsert;
