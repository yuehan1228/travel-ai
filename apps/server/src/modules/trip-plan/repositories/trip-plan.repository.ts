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
  TripStatus,
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
  readonly operation?:
    | 'generate'
    | 'regenerate-day'
    | 'restore'
    | 'edit'
    | 'replace-item'
    | 'reorder-items'
    | 'optimize-order';
  readonly sourceVersion?: number;
  readonly dayNumber?: number;
  readonly itemId?: string;
  readonly orderedItemIds?: readonly string[];
  readonly instruction?: string;
  readonly previousTripStatus?: TripStatus;
}

export type TripPlanGenerationReservationResult =
  | { readonly status: 'reserved'; readonly reservation: TripPlanGenerationReservation }
  | { readonly status: 'not_found' }
  | { readonly status: 'in_progress' };

export type TripPlanRestoreReservationResult =
  | { readonly status: 'reserved'; readonly reservation: TripPlanGenerationReservation }
  | { readonly status: 'not_found' }
  | { readonly status: 'in_progress' }
  | { readonly status: 'source_not_ready' };

export type TripPlanEditReservationResult =
  | { readonly status: 'reserved'; readonly reservation: TripPlanGenerationReservation }
  | { readonly status: 'not_found' }
  | { readonly status: 'in_progress' }
  | { readonly status: 'source_not_ready' };

export type TripPlanDayRegenerationReservationResult =
  | { readonly status: 'reserved'; readonly reservation: TripPlanGenerationReservation }
  | { readonly status: 'not_found' }
  | { readonly status: 'in_progress' }
  | { readonly status: 'source_not_ready' }
  | { readonly status: 'day_not_found' };

/** Repository boundary for authenticated TripPlan version persistence. */
export interface TripPlanRepository {
  reserveGeneration(
    userId: string,
    tripId: string,
    createdAt: Date,
  ): Promise<TripPlanGenerationReservationResult>;

  /** Optional extension retained separately so existing generation fakes remain valid. */
  reserveDayRegeneration?(
    userId: string,
    tripId: string,
    sourceVersion: number,
    dayNumber: number,
    instruction: string | undefined,
    createdAt: Date,
  ): Promise<TripPlanDayRegenerationReservationResult>;

  /** Reserve a new immutable version by copying a ready source snapshot. */
  reserveRestore?(
    userId: string,
    tripId: string,
    sourceVersion: number,
    createdAt: Date,
  ): Promise<TripPlanRestoreReservationResult>;

  /** Reserve a new immutable version by applying controlled edits to a ready source. */
  reserveEdit?(
    userId: string,
    tripId: string,
    sourceVersion: number,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult>;

  /** Reserve a new immutable version for replacing one verified itinerary POI. */
  reserveReplaceItem?(
    userId: string,
    tripId: string,
    sourceVersion: number,
    itemId: string,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult>;

  /** Alias retained for adapters that name the operation itemReplacement. */
  reserveItemReplacement?(
    userId: string,
    tripId: string,
    sourceVersion: number,
    itemId: string,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult>;

  /** Reserve a new immutable version for reordering one complete day. */
  reserveReorderItems?(
    userId: string,
    tripId: string,
    sourceVersion: number,
    dayNumber: number,
    orderedItemIds: readonly string[],
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult>;

  /** Reserve a new immutable version for automatic same-day route ordering. */
  reserveOptimizeOrder?(
    userId: string,
    tripId: string,
    sourceVersion: number,
    dayNumber: number,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult>;

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
      const previousRows = await tx
        .select({ status: trips.status })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
        .limit(1);
      const previousTripStatus = previousRows[0]?.status as TripStatus | undefined;
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
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
          ),
        );
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
          operation: 'generate',
          ...(previousTripStatus === undefined ? {} : { previousTripStatus }),
        },
      };
    });
  }

  public async reserveDayRegeneration(
    userId: string,
    tripId: string,
    sourceVersion: number,
    dayNumber: number,
    instruction: string | undefined,
    createdAt: Date,
  ): Promise<TripPlanDayRegenerationReservationResult> {
    const database = this.requireDatabase();
    return database.transaction(async (tx) => {
      const ownerRows = await tx
        .select({ status: trips.status })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
        .limit(1);
      const owner = ownerRows[0];
      if (owner === undefined) return { status: 'not_found' as const };
      if (owner.status === 'generating') return { status: 'in_progress' as const };

      const sourceRows = await tx
        .select({ version: tripPlanVersions })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
            eq(tripPlanVersions.version, sourceVersion),
            eq(tripPlanVersions.status, 'ready'),
          ),
        )
        .limit(1);
      const source = sourceRows[0]?.version;
      if (source === undefined) return { status: 'source_not_ready' as const };
      const sourcePlan = parseStoredPlan(source.planSnapshot, 'ready');
      if (sourcePlan === undefined) return { status: 'source_not_ready' as const };
      if (!sourcePlan.days.some((day) => day.dayNumber === dayNumber)) {
        return { status: 'day_not_found' as const };
      }

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
        const current = await tx
          .select({ status: trips.status })
          .from(trips)
          .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
          .limit(1);
        return current[0]?.status === 'generating'
          ? ({ status: 'in_progress' } as const)
          : ({ status: 'not_found' } as const);
      }

      const maxVersionRows = await tx
        .select({ maxVersion: sql<number | null>`max(${tripPlanVersions.version})` })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
          ),
        );
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
          operation: 'regenerate-day' as const,
          sourceVersion,
          dayNumber,
          ...(instruction === undefined ? {} : { instruction }),
          previousTripStatus: owner.status as TripStatus,
        },
      };
    });
  }

  public async reserveRestore(
    userId: string,
    tripId: string,
    sourceVersion: number,
    createdAt: Date,
  ): Promise<TripPlanRestoreReservationResult> {
    const database = this.requireDatabase();
    return database.transaction(async (tx) => {
      const ownerRows = await tx
        .select({ trip: trips })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
        .limit(1);
      const owner = ownerRows[0]?.trip;
      if (owner === undefined) return { status: 'not_found' as const };
      if (owner.status === 'generating') return { status: 'in_progress' as const };

      const sourceRows = await tx
        .select({ version: tripPlanVersions })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
            eq(tripPlanVersions.version, sourceVersion),
            eq(tripPlanVersions.status, 'ready'),
          ),
        )
        .limit(1);
      const source = sourceRows[0]?.version;
      if (source === undefined || parseStoredPlan(source.planSnapshot, 'ready') === undefined) {
        return { status: 'source_not_ready' as const };
      }

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
        const current = await tx
          .select({ status: trips.status })
          .from(trips)
          .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
          .limit(1);
        return current[0]?.status === 'generating'
          ? ({ status: 'in_progress' } as const)
          : ({ status: 'not_found' } as const);
      }

      const maxVersionRows = await tx
        .select({ maxVersion: sql<number | null>`max(${tripPlanVersions.version})` })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
          ),
        );
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
          operation: 'restore' as const,
          sourceVersion,
          previousTripStatus: owner.status as TripStatus,
        },
      };
    });
  }

  public async reserveEdit(
    userId: string,
    tripId: string,
    sourceVersion: number,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult> {
    const database = this.requireDatabase();
    return database.transaction(async (tx) => {
      const ownerRows = await tx
        .select({ trip: trips })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
        .limit(1);
      const owner = ownerRows[0]?.trip;
      if (owner === undefined) return { status: 'not_found' as const };
      if (owner.status === 'generating') return { status: 'in_progress' as const };

      const sourceRows = await tx
        .select({ version: tripPlanVersions })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
            eq(tripPlanVersions.version, sourceVersion),
            eq(tripPlanVersions.status, 'ready'),
          ),
        )
        .limit(1);
      const source = sourceRows[0]?.version;
      if (source === undefined || parseStoredPlan(source.planSnapshot, 'ready') === undefined) {
        return { status: 'source_not_ready' as const };
      }

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
        const current = await tx
          .select({ status: trips.status })
          .from(trips)
          .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
          .limit(1);
        return current[0]?.status === 'generating'
          ? ({ status: 'in_progress' } as const)
          : ({ status: 'not_found' } as const);
      }

      const maxVersionRows = await tx
        .select({ maxVersion: sql<number | null>`max(${tripPlanVersions.version})` })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
          ),
        );
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
          operation: 'edit' as const,
          sourceVersion,
          previousTripStatus: owner.status as TripStatus,
        },
      };
    });
  }

  public async reserveReorderItems(
    userId: string,
    tripId: string,
    sourceVersion: number,
    dayNumber: number,
    orderedItemIds: readonly string[] | undefined,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult> {
    const database = this.requireDatabase();
    return database.transaction(async (tx) => {
      const ownerRows = await tx
        .select({ trip: trips })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
        .limit(1);
      const owner = ownerRows[0]?.trip;
      if (owner === undefined) return { status: 'not_found' as const };
      if (owner.status === 'generating') return { status: 'in_progress' as const };

      const sourceRows = await tx
        .select({ version: tripPlanVersions })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
            eq(tripPlanVersions.version, sourceVersion),
            eq(tripPlanVersions.status, 'ready'),
          ),
        )
        .limit(1);
      const source = sourceRows[0]?.version;
      const sourcePlan =
        source === undefined ? undefined : parseStoredPlan(source.planSnapshot, 'ready');
      const sourceDay = sourcePlan?.days.find((day) => day.dayNumber === dayNumber);
      const sourceIds = sourceDay?.items.map((item) => item.id) ?? [];
      if (
        sourceDay === undefined ||
        (orderedItemIds !== undefined &&
          (sourceIds.length !== orderedItemIds.length ||
            new Set(orderedItemIds).size !== orderedItemIds.length ||
            sourceIds.some((itemId) => !orderedItemIds.includes(itemId))))
      ) {
        return { status: 'source_not_ready' as const };
      }

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
        const current = await tx
          .select({ status: trips.status })
          .from(trips)
          .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
          .limit(1);
        return current[0]?.status === 'generating'
          ? ({ status: 'in_progress' } as const)
          : ({ status: 'not_found' } as const);
      }

      const maxVersionRows = await tx
        .select({ maxVersion: sql<number | null>`max(${tripPlanVersions.version})` })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
          ),
        );
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
          operation:
            orderedItemIds === undefined ? ('optimize-order' as const) : ('reorder-items' as const),
          sourceVersion,
          dayNumber,
          ...(orderedItemIds === undefined ? {} : { orderedItemIds: [...orderedItemIds] }),
          previousTripStatus: owner.status as TripStatus,
        },
      };
    });
  }

  public async reserveReplaceItem(
    userId: string,
    tripId: string,
    sourceVersion: number,
    itemId: string,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult> {
    const database = this.requireDatabase();
    return database.transaction(async (tx) => {
      const ownerRows = await tx
        .select({ trip: trips })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
        .limit(1);
      const owner = ownerRows[0]?.trip;
      if (owner === undefined) return { status: 'not_found' as const };
      if (owner.status === 'generating') return { status: 'in_progress' as const };

      const sourceRows = await tx
        .select({ version: tripPlanVersions })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
            eq(tripPlanVersions.version, sourceVersion),
            eq(tripPlanVersions.status, 'ready'),
          ),
        )
        .limit(1);
      const source = sourceRows[0]?.version;
      const sourcePlan =
        source === undefined ? undefined : parseStoredPlan(source.planSnapshot, 'ready');
      if (
        source === undefined ||
        sourcePlan === undefined ||
        !sourcePlan.days.some((day) => day.items.some((item) => item.id === itemId))
      ) {
        return { status: 'source_not_ready' as const };
      }

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
        const current = await tx
          .select({ status: trips.status })
          .from(trips)
          .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
          .limit(1);
        return current[0]?.status === 'generating'
          ? ({ status: 'in_progress' } as const)
          : ({ status: 'not_found' } as const);
      }

      const maxVersionRows = await tx
        .select({ maxVersion: sql<number | null>`max(${tripPlanVersions.version})` })
        .from(tripPlanVersions)
        .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
        .where(
          and(
            eq(tripPlanVersions.tripId, tripId),
            eq(trips.id, tripId),
            eq(trips.userId, userId),
            isNull(trips.deletedAt),
          ),
        );
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
          operation: 'replace-item' as const,
          sourceVersion,
          itemId,
          previousTripStatus: owner.status as TripStatus,
        },
      };
    });
  }

  public async reserveOptimizeOrder(
    userId: string,
    tripId: string,
    sourceVersion: number,
    dayNumber: number,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult> {
    const reserved = await this.reserveReorderItems(
      userId,
      tripId,
      sourceVersion,
      dayNumber,
      undefined,
      createdAt,
    );
    if (reserved.status !== 'reserved') return reserved;
    return {
      status: 'reserved',
      reservation: {
        ...reserved.reservation,
        operation: 'optimize-order',
        sourceVersion,
        dayNumber,
        previousTripStatus: reserved.reservation.previousTripStatus,
      },
    };
  }

  public reserveItemReplacement(
    userId: string,
    tripId: string,
    sourceVersion: number,
    itemId: string,
    createdAt: Date,
  ): Promise<TripPlanEditReservationResult> {
    return this.reserveReplaceItem(userId, tripId, sourceVersion, itemId, createdAt);
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
        .set({
          status:
            (reservation.operation === 'regenerate-day' ||
              reservation.operation === 'restore' ||
              reservation.operation === 'edit' ||
              reservation.operation === 'replace-item' ||
              reservation.operation === 'reorder-items' ||
              reservation.operation === 'optimize-order') &&
            reservation.previousTripStatus === 'ready'
              ? 'ready'
              : 'failed',
          updatedAt: failedAt,
        })
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
