import { Inject, Injectable } from '@nestjs/common';

import {
  CreateTripInputSchema,
  ListTripsInputSchema,
  TripIdSchema,
  UpdateTripInputSchema,
} from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  ListTripsInput,
  TripDeleteResult,
  TripDetail,
  TripListResult,
  TripSummary,
  UpdateTripInput,
} from '@travel-guide/shared-types';

import { TRIP_REPOSITORY } from './trip.tokens';
import { TripException } from './trip.errors';
import type { TripRecord, TripRepository } from './repositories/trip.repository';

const toTimestamp = (value: Date): string => value.toISOString();

const toSummary = (record: TripRecord): TripSummary => ({
  id: record.id,
  status: record.status,
  destination: record.inputSnapshot.destination,
  startDate: record.startDate,
  endDate: record.endDate,
  travelerCount: record.travelerCount,
  createdAt: toTimestamp(record.createdAt),
  updatedAt: toTimestamp(record.updatedAt),
});

const toDetail = (record: TripRecord): TripDetail => ({
  ...record.inputSnapshot,
  id: record.id,
  status: record.status,
  createdAt: toTimestamp(record.createdAt),
  updatedAt: toTimestamp(record.updatedAt),
});

const validationError = (): TripException =>
  new TripException('TRIP_VALIDATION_ERROR', 400, 'The trip input is invalid');

const notFoundError = (): TripException =>
  new TripException('TRIP_NOT_FOUND', 404, 'The requested trip was not found');

const persistenceError = (): TripException =>
  new TripException('TRIP_PERSISTENCE_ERROR', 500, 'The trip could not be persisted');

@Injectable()
export class TripService {
  public constructor(@Inject(TRIP_REPOSITORY) private readonly repository: TripRepository) {}

  public async create(userId: string, input: CreateTripInput): Promise<TripDetail> {
    const parsed = CreateTripInputSchema.safeParse(input);
    if (!parsed.success) {
      throw validationError();
    }

    try {
      const created = await this.repository.create(userId, parsed.data);
      return toDetail(created);
    } catch {
      throw persistenceError();
    }
  }

  public async list(userId: string, input: ListTripsInput = {}): Promise<TripListResult> {
    const parsed = ListTripsInputSchema.safeParse(input);
    if (!parsed.success) {
      throw validationError();
    }

    try {
      const result = await this.repository.listByUserId(userId, parsed.data);
      const page = parsed.data.page ?? 1;
      const pageSize = parsed.data.pageSize ?? 20;
      return {
        items: result.items.map(toSummary),
        pagination: {
          page,
          pageSize,
          total: result.total,
          totalPages: result.total === 0 ? 0 : Math.ceil(result.total / pageSize),
        },
      };
    } catch {
      throw persistenceError();
    }
  }

  public async get(userId: string, tripId: string): Promise<TripDetail> {
    this.assertTripId(tripId);

    try {
      const found = await this.repository.findByIdForUser(userId, tripId);
      if (found === undefined) {
        throw notFoundError();
      }

      return toDetail(found);
    } catch (error: unknown) {
      if (error instanceof TripException) {
        throw error;
      }

      throw persistenceError();
    }
  }

  public async update(userId: string, tripId: string, input: UpdateTripInput): Promise<TripDetail> {
    this.assertTripId(tripId);
    const parsedUpdate = UpdateTripInputSchema.safeParse(input);
    if (!parsedUpdate.success) {
      throw validationError();
    }

    try {
      const existing = await this.repository.findByIdForUser(userId, tripId);
      if (existing === undefined) {
        throw notFoundError();
      }

      const merged = CreateTripInputSchema.safeParse({
        ...existing.inputSnapshot,
        ...parsedUpdate.data,
      });
      if (!merged.success) {
        throw validationError();
      }

      const updated = await this.repository.updateByIdForUser(userId, tripId, merged.data);
      if (updated === undefined) {
        throw notFoundError();
      }

      return toDetail(updated);
    } catch (error: unknown) {
      if (error instanceof TripException) {
        throw error;
      }

      throw persistenceError();
    }
  }

  public async remove(userId: string, tripId: string): Promise<TripDeleteResult> {
    this.assertTripId(tripId);

    try {
      const deleted = await this.repository.softDeleteByIdForUser(userId, tripId);
      if (!deleted) {
        throw notFoundError();
      }

      return { id: tripId, deleted: true };
    } catch (error: unknown) {
      if (error instanceof TripException) {
        throw error;
      }

      throw persistenceError();
    }
  }

  private assertTripId(tripId: string): void {
    if (!TripIdSchema.safeParse(tripId).success) {
      throw validationError();
    }
  }
}
