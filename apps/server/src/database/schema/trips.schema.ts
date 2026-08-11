import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type { CreateTripInput } from '@travel-guide/shared-types';

import { users } from './users.schema';

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cityName: varchar('city_name', { length: 255 }).notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    travelerCount: smallint('traveler_count').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('draft'),
    inputSnapshot: jsonb('input_snapshot').$type<CreateTripInput>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('trips_user_updated_idx').on(table.userId, table.updatedAt),
    index('trips_status_idx').on(table.status),
    index('trips_date_range_idx').on(table.startDate, table.endDate),
    index('trips_deleted_at_idx').on(table.deletedAt),
    check('trips_date_range_check', sql`${table.endDate} >= ${table.startDate}`),
    check('trips_traveler_count_check', sql`${table.travelerCount} between 1 and 20`),
    check(
      'trips_status_check',
      sql`${table.status} in ('draft', 'generating', 'ready', 'failed', 'deleted')`,
    ),
  ],
);

export type Trip = typeof trips.$inferSelect;
export type NewTrip = typeof trips.$inferInsert;
