import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  check,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    openid: varchar('openid', { length: 255 }).notNull(),
    unionid: varchar('unionid', { length: 255 }),
    nickname: varchar('nickname', { length: 255 }).notNull().default(''),
    avatarUrl: text('avatar_url').notNull().default(''),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_openid_unique').on(table.openid),
    index('users_status_idx').on(table.status),
    index('users_created_at_idx').on(table.createdAt),
    check('users_status_check', sql`${table.status} in ('active', 'blocked', 'deleted')`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
