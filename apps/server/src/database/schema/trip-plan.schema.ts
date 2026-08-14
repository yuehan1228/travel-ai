import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type {
  DailyWeather,
  Place,
  RouteEstimate,
  TripPlan,
  TripPlanDataSource,
  TripPlanItemType,
  TripPlanWarning,
  RouteMatrixResult,
  RouteOrderResult,
  RouteOrderExplanationResult,
} from '@travel-guide/shared-types';

import { trips } from './trips.schema';

/** Immutable generated-plan versions. Failed versions deliberately have no snapshot. */
export const tripPlanVersions = pgTable(
  'trip_plan_versions',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    schemaVersion: varchar('schema_version', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    planSnapshot: jsonb('plan_snapshot').$type<TripPlan | null>(),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trip_plan_versions_trip_version_unique').on(table.tripId, table.version),
    index('trip_plan_versions_trip_created_idx').on(table.tripId, table.createdAt),
    check('trip_plan_versions_version_check', sql`${table.version} >= 1`),
    check('trip_plan_versions_schema_version_check', sql`${table.schemaVersion} = '1.0'`),
    check(
      'trip_plan_versions_status_check',
      sql`${table.status} in ('generating', 'ready', 'failed')`,
    ),
    check(
      'trip_plan_versions_snapshot_status_check',
      sql`(${table.status} = 'ready' and ${table.planSnapshot} is not null) or (${table.status} <> 'ready' and ${table.planSnapshot} is null)`,
    ),
  ],
);

/** Materialized day rows retained alongside the JSON snapshot for relational reads/auditing. */
export const tripPlanDays = pgTable(
  'trip_plan_days',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => tripPlanVersions.id, { onDelete: 'cascade' }),
    dayNumber: integer('day_number').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    summary: text('summary').notNull(),
    weather: jsonb('weather').$type<DailyWeather>().notNull(),
    estimatedCostCny: numeric('estimated_cost_cny', {
      precision: 14,
      scale: 2,
      mode: 'number',
    }).notNull(),
    warnings: jsonb('warnings').$type<TripPlanWarning[]>().notNull(),
  },
  (table) => [
    uniqueIndex('trip_plan_days_version_day_unique').on(table.versionId, table.dayNumber),
    index('trip_plan_days_version_idx').on(table.versionId),
    check('trip_plan_days_day_number_check', sql`${table.dayNumber} >= 1`),
    check('trip_plan_days_cost_check', sql`${table.estimatedCostCny} >= 0`),
  ],
);

/** Materialized itinerary items. Place/route facts remain JSON and are schema-validated at IO. */
export const tripPlanItems = pgTable(
  'trip_plan_items',
  {
    id: uuid('id').primaryKey(),
    dayId: uuid('day_id')
      .notNull()
      .references(() => tripPlanDays.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').notNull(),
    type: varchar('type', { length: 16 }).$type<TripPlanItemType>().notNull(),
    startTime: varchar('start_time', { length: 5 }).notNull(),
    endTime: varchar('end_time', { length: 5 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description').notNull(),
    recommendationReason: text('recommendation_reason').notNull(),
    place: jsonb('place').$type<Place | null>(),
    route: jsonb('route').$type<RouteEstimate | null>(),
    estimatedCostCny: numeric('estimated_cost_cny', {
      precision: 14,
      scale: 2,
      mode: 'number',
    }).notNull(),
    tips: jsonb('tips').$type<string[]>().notNull(),
    dataSources: jsonb('data_sources').$type<TripPlanDataSource[]>().notNull(),
  },
  (table) => [
    uniqueIndex('trip_plan_items_day_item_unique').on(table.dayId, table.itemId),
    index('trip_plan_items_day_idx').on(table.dayId),
    check('trip_plan_items_cost_check', sql`${table.estimatedCostCny} >= 0`),
  ],
);

/**
 * Immutable facts produced by one successful automatic optimization.
 * Matrix/order/explanation are stored separately from the user-facing plan so
 * an audit can replay the exact candidate set without calling a Provider.
 */
export const tripPlanOptimizationEvidence = pgTable(
  'trip_plan_optimization_evidence',
  {
    id: uuid('id').primaryKey(),
    versionId: uuid('trip_plan_version_id')
      .notNull()
      .references(() => tripPlanVersions.id, { onDelete: 'cascade' }),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    sourceVersion: integer('source_version').notNull(),
    dayNumber: smallint('day_number').notNull(),
    mode: varchar('mode', { length: 16 }).notNull(),
    evidenceVersion: varchar('evidence_version', { length: 16 }).notNull(),
    startItemId: uuid('start_item_id'),
    endItemId: uuid('end_item_id'),
    matrixSnapshot: jsonb('matrix_snapshot').$type<RouteMatrixResult>().notNull(),
    orderSnapshot: jsonb('order_snapshot').$type<RouteOrderResult>().notNull(),
    explanationSnapshot: jsonb('explanation_snapshot')
      .$type<RouteOrderExplanationResult>()
      .notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trip_plan_optimization_evidence_version_day_unique').on(
      table.versionId,
      table.dayNumber,
    ),
    index('trip_plan_optimization_evidence_trip_idx').on(table.tripId, table.sourceVersion),
    check('trip_plan_optimization_evidence_source_version_check', sql`${table.sourceVersion} >= 1`),
    check(
      'trip_plan_optimization_evidence_day_number_check',
      sql`${table.dayNumber} between 1 and 14`,
    ),
    check(
      'trip_plan_optimization_evidence_mode_check',
      sql`${table.mode} in ('walking', 'driving')`,
    ),
    check('trip_plan_optimization_evidence_version_check', sql`${table.evidenceVersion} = '1.0'`),
  ],
);

export type TripPlanVersion = typeof tripPlanVersions.$inferSelect;
export type NewTripPlanVersion = typeof tripPlanVersions.$inferInsert;
export type TripPlanDay = typeof tripPlanDays.$inferSelect;
export type NewTripPlanDay = typeof tripPlanDays.$inferInsert;
export type TripPlanItem = typeof tripPlanItems.$inferSelect;
export type NewTripPlanItem = typeof tripPlanItems.$inferInsert;
export type TripPlanOptimizationEvidence = typeof tripPlanOptimizationEvidence.$inferSelect;
export type NewTripPlanOptimizationEvidence = typeof tripPlanOptimizationEvidence.$inferInsert;
