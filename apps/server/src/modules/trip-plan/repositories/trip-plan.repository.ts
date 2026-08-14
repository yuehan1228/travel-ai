import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  CreateTripInputSchema,
  RouteMatrixResultSchema,
  RouteOrderExplanationResultSchema,
  RouteOrderResultSchema,
  TripPlanSchema,
  TripPlanOptimizationAuditResultSchema,
  TripPlanVersionStatusSchema,
} from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  RouteMatrixResult,
  RouteMode,
  RouteOrderExplanationResult,
  RouteOrderResult,
  TripPlan,
  TripPlanGenerationResult,
  TripPlanVersionStatus,
  TripPlanVersionSummary,
  TripPlanOptimizationAuditResult,
  TripStatus,
} from '@travel-guide/shared-types';

import { DATABASE } from '../../../database/database.tokens';
import type { Database } from '../../../database/database.types';
import {
  tripPlanDays,
  tripPlanItems,
  tripPlanOptimizationEvidence,
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

/** Evidence captured from the exact matrix/order/explanation used by optimize-order. */
export interface TripPlanOptimizationEvidenceInput {
  readonly sourceVersion: number;
  readonly dayNumber: number;
  readonly mode: RouteMode;
  readonly startItemId?: string;
  readonly endItemId?: string;
  readonly matrixSnapshot: RouteMatrixResult;
  readonly orderSnapshot: RouteOrderResult;
  readonly explanationSnapshot: RouteOrderExplanationResult;
  readonly generatedAt: Date;
}

/** Raised when persisted evidence cannot be safely replayed. */
export class TripPlanAuditValidationError extends Error {
  public readonly code = 'TRIP_PLAN_AUDIT_VALIDATION_ERROR' as const;

  public constructor(message = 'Stored TripPlan optimization evidence is invalid') {
    super(message);
    this.name = 'TripPlanAuditValidationError';
  }
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
    optimizationEvidence?: TripPlanOptimizationEvidenceInput,
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

  /** Optional persisted optimization evidence; absent rows fail closed as unavailable. */
  findOptimizationAuditForUser?(
    userId: string,
    tripId: string,
    version: number,
    dayNumber: number,
  ): Promise<TripPlanOptimizationAuditResult | undefined>;
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

const sameStringArray = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const timeToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (value: number): string =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

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
    optimizationEvidence?: TripPlanOptimizationEvidenceInput,
  ): Promise<TripPlanVersionRecord> {
    const database = this.requireDatabase();
    const validatedPlan = TripPlanSchema.parse(plan);
    if (optimizationEvidence !== undefined && reservation.operation !== 'optimize-order') {
      throw new Error('Optimization evidence requires an optimize-order reservation');
    }
    if (reservation.operation === 'optimize-order' && optimizationEvidence === undefined) {
      throw new Error('Optimization evidence is required for optimize-order');
    }
    if (optimizationEvidence !== undefined) {
      if (
        optimizationEvidence.sourceVersion !== reservation.sourceVersion ||
        optimizationEvidence.dayNumber !== reservation.dayNumber ||
        optimizationEvidence.mode !== optimizationEvidence.matrixSnapshot.mode ||
        optimizationEvidence.mode !== optimizationEvidence.orderSnapshot.mode ||
        JSON.stringify(optimizationEvidence.explanationSnapshot.order) !==
          JSON.stringify(optimizationEvidence.orderSnapshot) ||
        optimizationEvidence.generatedAt.getTime() !== generatedAt.getTime()
      ) {
        throw new Error('Optimization evidence does not match its reservation');
      }
      if (!RouteMatrixResultSchema.safeParse(optimizationEvidence.matrixSnapshot).success) {
        throw new TripPlanAuditValidationError();
      }
      if (!RouteOrderResultSchema.safeParse(optimizationEvidence.orderSnapshot).success) {
        throw new TripPlanAuditValidationError();
      }
      if (
        !RouteOrderExplanationResultSchema.safeParse(optimizationEvidence.explanationSnapshot)
          .success
      ) {
        throw new TripPlanAuditValidationError();
      }
    }
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

      if (optimizationEvidence !== undefined) {
        const source = await tx
          .select({ id: tripPlanVersions.id })
          .from(tripPlanVersions)
          .where(
            and(
              eq(tripPlanVersions.tripId, tripId),
              eq(tripPlanVersions.version, optimizationEvidence.sourceVersion),
              eq(tripPlanVersions.status, 'ready'),
            ),
          )
          .limit(1);
        if (source.length === 0) throw new Error('Optimization source version is not ready');

        await tx.insert(tripPlanOptimizationEvidence).values({
          id: randomUUID(),
          versionId: reservation.versionId,
          tripId,
          sourceVersion: optimizationEvidence.sourceVersion,
          dayNumber: optimizationEvidence.dayNumber,
          mode: optimizationEvidence.mode,
          evidenceVersion: '1.0',
          startItemId: optimizationEvidence.startItemId,
          endItemId: optimizationEvidence.endItemId,
          matrixSnapshot: optimizationEvidence.matrixSnapshot,
          orderSnapshot: optimizationEvidence.orderSnapshot,
          explanationSnapshot: optimizationEvidence.explanationSnapshot,
          generatedAt: optimizationEvidence.generatedAt,
        });
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

  public async findOptimizationAuditForUser(
    userId: string,
    tripId: string,
    version: number,
    dayNumber: number,
  ): Promise<TripPlanOptimizationAuditResult | undefined> {
    const database = this.requireDatabase();
    const rows = await database
      .select({ evidence: tripPlanOptimizationEvidence, target: tripPlanVersions })
      .from(tripPlanOptimizationEvidence)
      .innerJoin(tripPlanVersions, eq(tripPlanVersions.id, tripPlanOptimizationEvidence.versionId))
      .innerJoin(trips, eq(trips.id, tripPlanOptimizationEvidence.tripId))
      .where(
        and(
          eq(trips.userId, userId),
          eq(trips.id, tripId),
          isNull(trips.deletedAt),
          eq(tripPlanVersions.tripId, tripId),
          eq(tripPlanVersions.version, version),
          eq(tripPlanVersions.status, 'ready'),
          eq(tripPlanOptimizationEvidence.dayNumber, dayNumber),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return undefined;
    const evidence = row.evidence;
    if (
      evidence.tripId !== tripId ||
      evidence.versionId !== row.target.id ||
      evidence.mode !== evidence.matrixSnapshot.mode ||
      evidence.mode !== evidence.orderSnapshot.mode ||
      evidence.evidenceVersion !== '1.0' ||
      row.target.generatedAt === null ||
      evidence.generatedAt.getTime() !== row.target.generatedAt.getTime()
    ) {
      throw new TripPlanAuditValidationError();
    }

    const matrix = RouteMatrixResultSchema.safeParse(evidence.matrixSnapshot);
    const order = RouteOrderResultSchema.safeParse(evidence.orderSnapshot);
    const explanation = RouteOrderExplanationResultSchema.safeParse(evidence.explanationSnapshot);
    if (!matrix.success || !order.success || !explanation.success) {
      throw new TripPlanAuditValidationError();
    }
    const matrixCellByPair = new Map(
      matrix.data.cells.map((cell) => [`${cell.originId}\u0000${cell.destinationId}`, cell]),
    );
    for (const leg of order.data.legs) {
      const cell = matrixCellByPair.get(`${leg.originId}\u0000${leg.destinationId}`);
      if (
        cell?.status !== 'available' ||
        cell.estimate === undefined ||
        cell.estimate.dataSource === 'unavailable' ||
        cell.estimate.distanceMeters !== leg.estimate.distanceMeters ||
        cell.estimate.durationSeconds !== leg.estimate.durationSeconds
      ) {
        throw new TripPlanAuditValidationError();
      }
    }
    for (const decision of explanation.data.decisions) {
      for (const candidate of decision.candidates) {
        const cell = matrixCellByPair.get(`${decision.originId}\u0000${candidate.destinationId}`);
        if (cell === undefined) throw new TripPlanAuditValidationError();
        if (candidate.status === 'unavailable') {
          if (cell.status !== 'unavailable' || candidate.rejectionReason !== 'route_unavailable') {
            throw new TripPlanAuditValidationError();
          }
          continue;
        }
        if (
          cell.status !== 'available' ||
          cell.estimate === undefined ||
          cell.estimate.dataSource === 'unavailable' ||
          candidate.durationSeconds !== cell.estimate.durationSeconds ||
          candidate.distanceMeters !== cell.estimate.distanceMeters ||
          (candidate.rejectionReason !== undefined && candidate.rejectionReason !== 'fixed_end')
        ) {
          throw new TripPlanAuditValidationError();
        }
      }
    }
    if (
      explanation.data.order.mode !== order.data.mode ||
      explanation.data.order.algorithm !== order.data.algorithm ||
      explanation.data.order.isOptimal !== order.data.isOptimal ||
      explanation.data.order.totalDistanceMeters !== order.data.totalDistanceMeters ||
      explanation.data.order.totalDurationSeconds !== order.data.totalDurationSeconds ||
      explanation.data.order.generatedAt !== order.data.generatedAt ||
      order.data.generatedAt !== matrix.data.generatedAt ||
      !sameStringArray(explanation.data.order.warnings, order.data.warnings) ||
      explanation.data.order.orderedPointIds.length !== order.data.orderedPointIds.length ||
      explanation.data.order.orderedPointIds.some(
        (id, index) => id !== order.data.orderedPointIds[index],
      )
    ) {
      throw new TripPlanAuditValidationError();
    }

    const targetPlanParsed = TripPlanSchema.safeParse(row.target.planSnapshot);
    if (!targetPlanParsed.success || targetPlanParsed.data.tripId !== tripId) {
      throw new TripPlanAuditValidationError();
    }
    const sourceRows = await database
      .select({ version: tripPlanVersions })
      .from(tripPlanVersions)
      .innerJoin(trips, eq(trips.id, tripPlanVersions.tripId))
      .where(
        and(
          eq(trips.userId, userId),
          eq(trips.id, tripId),
          isNull(trips.deletedAt),
          eq(tripPlanVersions.tripId, tripId),
          eq(tripPlanVersions.version, evidence.sourceVersion),
          eq(tripPlanVersions.status, 'ready'),
        ),
      )
      .limit(1);
    const sourceRow = sourceRows[0]?.version;
    if (sourceRow === undefined) throw new TripPlanAuditValidationError();
    const sourcePlanParsed = TripPlanSchema.safeParse(sourceRow.planSnapshot);
    if (!sourcePlanParsed.success || sourcePlanParsed.data.tripId !== tripId) {
      throw new TripPlanAuditValidationError();
    }

    const targetDay = targetPlanParsed.data.days.find((day) => day.dayNumber === dayNumber);
    const sourceDay = sourcePlanParsed.data.days.find((day) => day.dayNumber === dayNumber);
    if (targetDay === undefined || sourceDay === undefined) {
      throw new TripPlanAuditValidationError();
    }
    const sourceItems = new Map(sourceDay.items.map((item) => [item.id, item]));
    const targetRealItems = targetDay.items.filter((item) => item.place !== undefined);
    if (
      !sameStringArray(
        order.data.orderedPointIds,
        targetRealItems.map((item) => item.id),
      )
    ) {
      throw new TripPlanAuditValidationError();
    }
    if (matrix.data.points.length !== targetRealItems.length) {
      throw new TripPlanAuditValidationError();
    }
    for (const item of targetRealItems) {
      const point = matrix.data.points.find((candidate) => candidate.id === item.id);
      if (
        point === undefined ||
        item.place === undefined ||
        point.endpoint.placeId !== item.place.id ||
        point.endpoint.location.longitude !== item.place.location.longitude ||
        point.endpoint.location.latitude !== item.place.location.latitude
      ) {
        throw new TripPlanAuditValidationError();
      }
    }
    const earliestStart = Math.min(...sourceDay.items.map((item) => timeToMinutes(item.startTime)));
    let cursor = earliestStart;
    let previousPlaceItem: (typeof targetDay.items)[number] | undefined;
    for (const item of targetDay.items) {
      const previous = sourceItems.get(item.id);
      if (previous === undefined) throw new TripPlanAuditValidationError();
      const duration = timeToMinutes(previous.endTime) - timeToMinutes(previous.startTime);
      const route =
        item.place !== undefined && previousPlaceItem !== undefined ? item.route : undefined;
      const travelMinutes =
        route === undefined || route.dataSource === 'unavailable'
          ? 0
          : Math.ceil(route.durationSeconds / 60);
      const expectedStart = cursor + travelMinutes;
      const expectedEnd = expectedStart + duration;
      if (
        item.startTime !== minutesToTime(expectedStart) ||
        item.endTime !== minutesToTime(expectedEnd)
      ) {
        throw new TripPlanAuditValidationError();
      }
      cursor = expectedEnd;
      if (item.place !== undefined) previousPlaceItem = item;
    }
    for (let index = 1; index < targetRealItems.length; index += 1) {
      const item = targetRealItems[index]!;
      const route = item.route;
      const leg = order.data.legs[index - 1];
      if (
        route === undefined ||
        route.dataSource === 'unavailable' ||
        leg === undefined ||
        route.mode !== order.data.mode ||
        route.distanceMeters !== leg.estimate.distanceMeters ||
        route.durationSeconds !== leg.estimate.durationSeconds ||
        route.origin.placeId !== targetRealItems[index - 1]!.place?.id ||
        route.destination.placeId !== item.place?.id
      ) {
        throw new TripPlanAuditValidationError();
      }
    }
    const timelineChanges = targetDay.items.map((item) => {
      const previous = sourceItems.get(item.id);
      if (previous === undefined) throw new TripPlanAuditValidationError();
      const route = item.route;
      return {
        itemId: item.id,
        previousStartTime: previous.startTime,
        previousEndTime: previous.endTime,
        nextStartTime: item.startTime,
        nextEndTime: item.endTime,
        routeStatus:
          route === undefined
            ? ('not_applicable' as const)
            : route.dataSource === 'unavailable'
              ? ('unavailable' as const)
              : ('available' as const),
        ...(route === undefined || route.dataSource === 'unavailable'
          ? {}
          : {
              routeDurationSeconds: route.durationSeconds,
              routeDistanceMeters: route.distanceMeters,
            }),
      };
    });
    const audit: TripPlanOptimizationAuditResult = {
      tripId,
      version,
      sourceVersion: evidence.sourceVersion,
      dayNumber,
      mode: evidence.mode as RouteMode,
      algorithm: 'nearest_neighbor',
      isOptimal: false,
      orderedItemIds: targetDay.items.map((item) => item.id),
      ...(evidence.startItemId === null ? {} : { fixedStartItemId: evidence.startItemId }),
      ...(evidence.endItemId === null ? {} : { fixedEndItemId: evidence.endItemId }),
      decisions: explanation.data.decisions.map((decision) => ({
        step: decision.step,
        originItemId: decision.originId,
        selectedDestinationItemId: decision.selectedDestinationId,
        reason: decision.reason,
        candidates: decision.candidates.map((candidate) => ({
          destinationItemId: candidate.destinationId,
          status: candidate.status,
          ...(candidate.durationSeconds === undefined
            ? {}
            : { durationSeconds: candidate.durationSeconds }),
          ...(candidate.distanceMeters === undefined
            ? {}
            : { distanceMeters: candidate.distanceMeters }),
          ...(candidate.rejectionReason === undefined
            ? {}
            : { rejectionReason: candidate.rejectionReason }),
        })),
      })),
      timelineChanges,
      warnings: [
        ...new Set([...explanation.data.order.warnings, explanation.data.algorithmNotice]),
      ],
      generatedAt: row.target.generatedAt.toISOString(),
    };
    const parsedAudit = TripPlanOptimizationAuditResultSchema.safeParse(audit);
    if (!parsedAudit.success) throw new TripPlanAuditValidationError();
    return parsedAudit.data;
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
