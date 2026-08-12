import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  CreateTripInputSchema,
  TripPlanSchema,
  TripPlanVersionStatusSchema,
} from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  TripPlan,
  TripPlanGenerationResult,
  TripPlanVersionStatus,
  TripPlanVersionSummary,
} from '@travel-guide/shared-types';

import { DATABASE } from '../../../database/database.tokens';
import type { Database } from '../../../database/database.types';
import {
  tripPlanDays,
  tripPlanItems,
  tripPlanVersions,
  type TripPlanVersion,
} from '../../../database/schema/trip-plan.schema';
import { trips } from '../../../database/schema/trips.schema';
import { TRIP_PLAN_REPOSITORY } from '../trip-plan.tokens';

export interface TripPlanVersionRecord {
  readonly id: string;
  readonly tripId: string;
  readonly version: number;
  readonly schemaVersion: '1.0';
  readonly status: TripPlanVersionStatus;
  readonly plan?: TripPlan;
  readonly generatedAt?: Date;
  readonly createdAt: Date;
}

export interface TripPlanGenerationReservation {
  readonly versionId: string;
  readonly version: number;
  readonly tripId: string;
  readonly userId: string;
  readonly input: CreateTripInput;
  readonly createdAt: Date;
}

export type TripPlanGenerationReservationResult =
  | { readonly status: 'reserved'; readonly reservation: TripPlanGenerationReservation }
  | { readonly status: 'not_found' }
  | { readonly status: 'in_progress' };

/** Repository boundary for authenticated TripPlan version persistence. */
export interface TripPlanRepository {
  reserveGeneration(
    userId: string,
    tripId: string,
    createdAt: Date,
  ): Promise<TripPlanGenerationReservationResult>;

  saveReady(
    userId: string,
    tripId: string,
    reservation: TripPlanGenerationReservation,
    plan: TripPlan,
    generatedAt: Date,
  ): Promise<TripPlanVersionRecord>;

  markFailed(
    userId: string,
    tripId: string,
    reservation: TripPlanGenerationReservation,
    failedAt: Date,
  ): Promise<void>;

  listVersionsForUser(userId: string, tripId: string): Promise<TripPlanVersionRecord[]>;

  findVersionForUser(
    userId: string,
    tripId: string,
    version: number,
  ): Promise<TripPlanVersionRecord | undefined>;
}

export type TripPlanVersionRepository = TripPlanRepository;

const parseVersionStatus = (value: string): TripPlanVersionStatus => {
  const parsed = TripPlanVersionStatusSchema.safeParse(value);
  if (!parsed.success) throw new Error('Stored TripPlan version status is invalid');
  return parsed.data;
};

const parseStoredPlan = (value: unknown, status: TripPlanVersionStatus): TripPlan | undefined => {
  if (status !== 'ready') return undefined;
  const parsed = TripPlanSchema.safeParse(value);
  if (!parsed.success) throw new Error('Stored TripPlan snapshot is invalid');
  return parsed.data;
};

const toRecord = (version: TripPlanVersion): TripPlanVersionRecord => {
  const status = parseVersionStatus(version.status);
  if (version.schemaVersion !== '1.0') {
    throw new Error('Stored TripPlan schema version is invalid');
  }
  const record: TripPlanVersionRecord = {
    id: version.id,
    tripId: version.tripId,
    version: version.version,
    schemaVersion: version.schemaVersion,
    status,
    ...(status === 'ready' ? { plan: parseStoredPlan(version.planSnapshot, status) } : {}),
    ...(version.generatedAt === null ? {} : { generatedAt: version.generatedAt }),
    createdAt: version.createdAt,
  };
  return record;
};

const toSummary = (record: TripPlanVersionRecord): TripPlanVersionSummary => ({
  id: record.id,
  tripId: record.tripId,
  version: record.version,
  schemaVersion: record.schemaVersion,
  status: record.status,
  ...(record.generatedAt === undefined ? {} : { generatedAt: record.generatedAt.toISOString() }),
  createdAt: record.createdAt.toISOString(),
});

export const tripPlanVersionSummary = toSummary;

@Injectable()
export class DrizzleTripPlanRepository implements TripPlanRepository {
  public constructor(@Optional() @Inject(DATABASE) private readonly database?: Database) {}

  public async reserveGeneration(
    userId: string,
    tripId: string,
    createdAt: Date,
  ): Promise<TripPlanGenerationReservationResult> {
    const database = this.requireDatabase();
    return database.transaction(async (tx) => {
      const updated = await tx
        .update(trips)
        .set({ status: 'generating', updatedAt: createdAt })
        .where(
          and(
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
            inArray(trips.status, ['draft', 'ready', 'failed']),
          ),
        )
        .returning();

      const trip = updated[0];
      if (trip === undefined) {
        const existing = await tx
          .select({ status: trips.status })
          .from(trips)
          .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
          .limit(1);
        return existing[0]?.status === 'generating'
          ? ({ status: 'in_progress' } as const)
          : ({ status: 'not_found' } as const);
      }

      const maxVersionRows = await tx
        .select({ maxVersion: sql<number | null>`max(${tripPlanVersions.version})` })
        .from(tripPlanVersions)
        .where(eq(tripPlanVersions.tripId, tripId));
      const currentMax = maxVersionRows[0]?.maxVersion;
      const version = currentMax === null || currentMax === undefined ? 1 : Number(currentMax) + 1;
      if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
        throw new Error('TripPlan version overflow');
      }

      const versionId = randomUUID();
      const inserted = await tx
        .insert(tripPlanVersions)
        .values({
          id: versionId,
          tripId,
          version,
          schemaVersion: '1.0',
          status: 'generating',
          planSnapshot: null,
          generatedAt: null,
          createdAt,
        })
        .returning();
      if (inserted[0] === undefined) throw new Error('TripPlan version could not be reserved');

      return {
        status: 'reserved' as const,
        reservation: {
          versionId,
          version,
          tripId,
          userId,
          input: CreateTripInputSchema.parse(trip.inputSnapshot),
          createdAt,
        },
      };
    });
  }

  public async saveReady(
    userId: string,
    tripId: string,
    reservation: TripPlanGenerationReservation,
    plan: TripPlan,
    generatedAt: Date,
  ): Promise<TripPlanVersionRecord> {
    const database = this.requireDatabase();
    const validatedPlan = TripPlanSchema.parse(plan);
    return database.transaction(async (tx) => {
      const ownerTrip = await tx
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
        .limit(1);
      if (ownerTrip.length === 0) throw new Error('Trip is not writable');
      const updated = await tx
        .update(tripPlanVersions)
        .set({ status: 'ready', planSnapshot: validatedPlan, generatedAt })
        .where(
          and(
            eq(tripPlanVersions.id, reservation.versionId),
            eq(tripPlanVersions.tripId, tripId),
            eq(tripPlanVersions.version, reservation.version),
            eq(tripPlanVersions.status, 'generating'),
          ),
        )
        .returning();
      const version = updated[0];
      if (version === undefined) throw new Error('TripPlan version is not writable');

      for (const day of validatedPlan.days) {
        const dayId = randomUUID();
        await tx.insert(tripPlanDays).values({
          id: dayId,
          versionId: reservation.versionId,
          dayNumber: day.dayNumber,
          date: day.date,
          summary: day.summary,
          weather: day.weather,
          estimatedCostCny: day.estimatedCostCny,
          warnings: day.warnings,
        });
        if (day.items.length > 0) {
          await tx.insert(tripPlanItems).values(
            day.items.map((item) => ({
              id: randomUUID(),
              dayId,
              itemId: item.id,
              type: item.type,
              startTime: item.startTime,
              endTime: item.endTime,
              name: item.name,
              description: item.description,
              recommendationReason: item.recommendationReason,
              place: item.place ?? null,
              route: item.route ?? null,
              estimatedCostCny: item.estimatedCostCny,
              tips: item.tips,
              dataSources: item.dataSources,
            })),
          );
        }
      }

      const tripUpdate = await tx
        .update(trips)
        .set({ status: 'ready', updatedAt: generatedAt })
        .where(
          and(
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            eq(trips.status, 'generating'),
            isNull(trips.deletedAt),
          ),
        )
        .returning({ id: trips.id });
      if (tripUpdate.length === 0) throw new Error('Trip is not writable');

      return toRecord(version);
    });
  }

  public async markFailed(
    userId: string,
    tripId: string,
    reservation: TripPlanGenerationReservation,
    failedAt: Date,
  ): Promise<void> {
    const database = this.requireDatabase();
    await database.transaction(async (tx) => {
      const failed = await tx
        .update(tripPlanVersions)
        .set({ status: 'failed', planSnapshot: null, generatedAt: failedAt })
        .where(
          and(
            eq(tripPlanVersions.id, reservation.versionId),
            eq(tripPlanVersions.tripId, tripId),
            eq(tripPlanVersions.version, reservation.version),
            eq(tripPlanVersions.status, 'generating'),
          ),
        )
        .returning({ id: tripPlanVersions.id });
      if (failed.length === 0) throw new Error('TripPlan version is not writable');

      const trip = await tx
        .update(trips)
        .set({ status: 'failed', updatedAt: failedAt })
        .where(
          and(
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            eq(trips.status, 'generating'),
            isNull(trips.deletedAt),
          ),
        )
        .returning({ id: trips.id });
      if (trip.length === 0) throw new Error('Trip is not writable');
    });
  }

  public async listVersionsForUser(
    userId: string,
    tripId: string,
  ): Promise<TripPlanVersionRecord[]> {
    const database = this.requireDatabase();
    const rows = await database
      .select({ version: tripPlanVersions })
      .from(tripPlanVersions)
      .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
      .where(and(eq(trips.userId, userId), eq(trips.id, tripId), isNull(trips.deletedAt)))
      .orderBy(desc(tripPlanVersions.version));
    return rows.map((row) => toRecord(row.version));
  }

  public async findVersionForUser(
    userId: string,
    tripId: string,
    version: number,
  ): Promise<TripPlanVersionRecord | undefined> {
    const database = this.requireDatabase();
    const rows = await database
      .select({ version: tripPlanVersions })
      .from(tripPlanVersions)
      .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
      .where(
        and(
          eq(trips.userId, userId),
          eq(trips.id, tripId),
          isNull(trips.deletedAt),
          eq(tripPlanVersions.version, version),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : toRecord(row.version);
  }

  public toGenerationResult(record: TripPlanVersionRecord): TripPlanGenerationResult {
    const summary = toSummary(record);
    return {
      version: record.version,
      status: record.status,
      tripId: record.tripId,
      ...(record.plan === undefined ? {} : { plan: record.plan }),
      summary,
    };
  }

  public toSummary(record: TripPlanVersionRecord): TripPlanVersionSummary {
    return toSummary(record);
  }

  private requireDatabase(): Database {
    if (this.database === undefined) {
      throw new Error('Database is not configured for TripPlan persistence');
    }
    return this.database;
  }
}

export { TRIP_PLAN_REPOSITORY };
