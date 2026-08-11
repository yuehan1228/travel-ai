import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { CreateTripInputSchema, ListTripsInputSchema } from '@travel-guide/shared-schemas';
import type { CreateTripInput, ListTripsInput, TripStatus } from '@travel-guide/shared-types';

import { DATABASE } from '../../../database/database.tokens';
import type { Database } from '../../../database/database.types';
import { trips, type Trip } from '../../../database/schema/trips.schema';
import { TRIP_REPOSITORY } from '../trip.tokens';

export interface TripRecord {
  readonly id: string;
  readonly userId: string;
  readonly cityName: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly travelerCount: number;
  readonly status: TripStatus;
  readonly inputSnapshot: CreateTripInput;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface TripRepository {
  create(userId: string, input: CreateTripInput): Promise<TripRecord>;

  listByUserId(
    userId: string,
    input: ListTripsInput,
  ): Promise<{
    items: TripRecord[];
    total: number;
  }>;

  findByIdForUser(userId: string, tripId: string): Promise<TripRecord | undefined>;

  updateByIdForUser(
    userId: string,
    tripId: string,
    input: CreateTripInput,
  ): Promise<TripRecord | undefined>;

  softDeleteByIdForUser(userId: string, tripId: string): Promise<boolean>;
}

const toTripRecord = (trip: Trip): TripRecord => {
  const parsedInput = CreateTripInputSchema.parse(trip.inputSnapshot);

  return {
    id: trip.id,
    userId: trip.userId,
    cityName: trip.cityName,
    startDate: trip.startDate,
    endDate: trip.endDate,
    travelerCount: trip.travelerCount,
    status: trip.status as TripStatus,
    inputSnapshot: parsedInput,
    createdAt: trip.createdAt,
    updatedAt: trip.updatedAt,
    deletedAt: trip.deletedAt,
  };
};

const parseCreateInput = (input: CreateTripInput): CreateTripInput =>
  CreateTripInputSchema.parse(input);

@Injectable()
export class DrizzleTripRepository implements TripRepository {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public async create(userId: string, input: CreateTripInput): Promise<TripRecord> {
    const normalizedInput = parseCreateInput(input);
    const now = new Date();
    const inserted = await this.database
      .insert(trips)
      .values({
        id: randomUUID(),
        userId,
        cityName: normalizedInput.destination.cityName,
        startDate: normalizedInput.startDate,
        endDate: normalizedInput.endDate,
        travelerCount: normalizedInput.travelerCount,
        status: 'draft',
        inputSnapshot: normalizedInput,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const created = inserted[0];
    if (created === undefined) {
      throw new Error('Trip could not be created');
    }

    return toTripRecord(created);
  }

  public async listByUserId(
    userId: string,
    input: ListTripsInput,
  ): Promise<{ items: TripRecord[]; total: number }> {
    const normalizedInput = ListTripsInputSchema.parse(input);
    const page = normalizedInput.page ?? 1;
    const pageSize = normalizedInput.pageSize ?? 20;

    // Deleted records are never visible, including when a caller asks for the
    // deleted status. This keeps soft deletion semantics consistent.
    if (normalizedInput.status === 'deleted') {
      return { items: [], total: 0 };
    }

    const conditions = [eq(trips.userId, userId), isNull(trips.deletedAt)];
    if (normalizedInput.status !== undefined) {
      conditions.push(eq(trips.status, normalizedInput.status));
    }
    const where = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.database
        .select()
        .from(trips)
        .where(where)
        .orderBy(desc(trips.updatedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.database.select({ count: count() }).from(trips).where(where),
    ]);

    return {
      items: rows.map(toTripRecord),
      total: Number(totalRows[0]?.count ?? 0),
    };
  }

  public async findByIdForUser(userId: string, tripId: string): Promise<TripRecord | undefined> {
    const result = await this.database
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
      .limit(1);

    const found = result[0];
    return found === undefined ? undefined : toTripRecord(found);
  }

  public async updateByIdForUser(
    userId: string,
    tripId: string,
    input: CreateTripInput,
  ): Promise<TripRecord | undefined> {
    const normalizedInput = parseCreateInput(input);
    const updated = await this.database
      .update(trips)
      .set({
        cityName: normalizedInput.destination.cityName,
        startDate: normalizedInput.startDate,
        endDate: normalizedInput.endDate,
        travelerCount: normalizedInput.travelerCount,
        inputSnapshot: normalizedInput,
        updatedAt: new Date(),
      })
      .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
      .returning();

    const result = updated[0];
    return result === undefined ? undefined : toTripRecord(result);
  }

  public async softDeleteByIdForUser(userId: string, tripId: string): Promise<boolean> {
    const deleted = await this.database
      .update(trips)
      .set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(trips.deletedAt)))
      .returning({ id: trips.id });

    return deleted.length > 0;
  }
}

export { TRIP_REPOSITORY };
