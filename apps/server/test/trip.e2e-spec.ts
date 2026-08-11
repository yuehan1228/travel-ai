import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  ApiFailureSchema,
  CreateTripInputSchema,
  LoginResultSchema,
  TripDetailSchema,
  TripListResultSchema,
  createApiSuccessSchema,
} from '@travel-guide/shared-schemas';
import type { CreateTripInput, ListTripsInput } from '@travel-guide/shared-types';
import type { TripRecord, TripRepository } from '../src/modules/trips/repositories/trip.repository';

import { createApp } from '../src/create-app';
import { createTestAuthEnvironment } from '../src/modules/auth/config/auth-environment';
import type { UserRecord, UserRepository } from '../src/modules/auth/repositories/user.repository';
import type { WechatProvider } from '../src/modules/auth/providers/wechat.provider';

const firstUserId = '123e4567-e89b-12d3-a456-426614174000';
const secondUserId = '123e4567-e89b-12d3-a456-426614174001';

const input: CreateTripInput = {
  destination: { cityName: '杭州', cityCode: 'HZ' },
  origin: '上海',
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'relaxed',
  transportPreference: 'public_transport',
};

class FakeProvider implements WechatProvider {
  public async exchangeCode(code: string): Promise<{ openid: string }> {
    return { openid: code };
  }
}

class FakeUserRepository implements UserRepository {
  private readonly users = new Map<string, UserRecord>([
    ['one', { id: firstUserId, nickname: '', avatarUrl: '', status: 'active' }],
    ['two', { id: secondUserId, nickname: '', avatarUrl: '', status: 'active' }],
  ]);

  public async findOrCreateByWechatIdentity(input: { openid: string }): Promise<UserRecord> {
    return this.users.get(input.openid) ?? this.users.get('one')!;
  }
}

class FakeTripRepository implements TripRepository {
  private readonly records = new Map<string, TripRecord>();

  public async create(userId: string, tripInput: CreateTripInput): Promise<TripRecord> {
    const parsed = CreateTripInputSchema.parse(tripInput);
    const now = new Date('2026-08-11T00:00:00.000Z');
    const record: TripRecord = {
      id: `${this.records.size + 1}`.padStart(8, '0') + '-e89b-12d3-a456-426614174000',
      userId,
      cityName: parsed.destination.cityName,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      travelerCount: parsed.travelerCount,
      status: 'draft',
      inputSnapshot: parsed,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.records.set(record.id, record);
    return record;
  }

  public async listByUserId(
    userId: string,
    listInput: ListTripsInput,
  ): Promise<{ items: TripRecord[]; total: number }> {
    const page = listInput.page ?? 1;
    const pageSize = listInput.pageSize ?? 20;
    const records = [...this.records.values()].filter(
      (record) =>
        record.userId === userId &&
        record.deletedAt === null &&
        (listInput.status === undefined || record.status === listInput.status),
    );
    return {
      items: records.slice((page - 1) * pageSize, page * pageSize),
      total: records.length,
    };
  }

  public async findByIdForUser(userId: string, tripId: string): Promise<TripRecord | undefined> {
    const record = this.records.get(tripId);
    return record?.userId === userId && record.deletedAt === null ? record : undefined;
  }

  public async updateByIdForUser(
    userId: string,
    tripId: string,
    tripInput: CreateTripInput,
  ): Promise<TripRecord | undefined> {
    const existing = await this.findByIdForUser(userId, tripId);
    if (existing === undefined) {
      return undefined;
    }
    const parsed = CreateTripInputSchema.parse(tripInput);
    const updated = {
      ...existing,
      cityName: parsed.destination.cityName,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      travelerCount: parsed.travelerCount,
      inputSnapshot: parsed,
      updatedAt: new Date('2026-08-11T00:01:00.000Z'),
    };
    this.records.set(tripId, updated);
    return updated;
  }

  public async softDeleteByIdForUser(userId: string, tripId: string): Promise<boolean> {
    const existing = await this.findByIdForUser(userId, tripId);
    if (existing === undefined) {
      return false;
    }
    this.records.set(tripId, {
      ...existing,
      status: 'deleted',
      deletedAt: new Date('2026-08-11T00:02:00.000Z'),
      updatedAt: new Date('2026-08-11T00:02:00.000Z'),
    });
    return true;
  }
}

describe('Trip API', () => {
  let app: NestFastifyApplication;
  const repository = new FakeTripRepository();

  beforeAll(async () => {
    app = await createApp(
      { nodeEnv: 'test', port: 0 },
      {
        authEnvironment: createTestAuthEnvironment(),
        wechatProvider: new FakeProvider(),
        userRepository: new FakeUserRepository(),
        tripRepository: repository,
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = async (code: string): Promise<string> => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/auth/login',
      payload: { code },
    });
    return createApiSuccessSchema(LoginResultSchema).parse(JSON.parse(response.payload)).data
      .accessToken;
  };

  it('rejects unauthenticated access', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/trips',
    });
    expect(response.statusCode).toBe(401);
    expect(ApiFailureSchema.parse(JSON.parse(response.payload)).error.code).toBe(
      'AUTH_TOKEN_INVALID',
    );
  });

  it('creates, lists, updates and soft deletes a trip with request IDs', async () => {
    const token = await login('one');
    const createdResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/trips',
        headers: { authorization: `Bearer ${token}`, 'x-request-id': 'trip-create-1' },
        payload: input,
      });
    const created = createApiSuccessSchema(TripDetailSchema).parse(
      JSON.parse(createdResponse.payload),
    );
    expect(createdResponse.statusCode).toBe(201);
    expect(createdResponse.headers['x-request-id']).toBe('trip-create-1');
    expect(created.data.destination.cityName).toBe('杭州');

    const listResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/trips?page=1&pageSize=10',
        headers: { authorization: `Bearer ${token}` },
      });
    const list = createApiSuccessSchema(TripListResultSchema).parse(
      JSON.parse(listResponse.payload),
    );
    expect(list.data.items).toHaveLength(1);

    const detailResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/trips/${created.data.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
    const detail = createApiSuccessSchema(TripDetailSchema).parse(
      JSON.parse(detailResponse.payload),
    );
    expect(detailResponse.statusCode).toBe(200);
    expect(detail.data.id).toBe(created.data.id);

    const updatedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'PATCH',
        url: `/trips/${created.data.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { travelerCount: 3 },
      });
    const updated = createApiSuccessSchema(TripDetailSchema).parse(
      JSON.parse(updatedResponse.payload),
    );
    expect(updated.data.travelerCount).toBe(3);

    const deletedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'DELETE',
        url: `/trips/${created.data.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
    expect(deletedResponse.statusCode).toBe(200);
    expect(JSON.parse(deletedResponse.payload).data.deleted).toBe(true);

    const afterDelete = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/trips/${created.data.id}`,
        headers: { authorization: `Bearer ${token}` },
      });
    expect(afterDelete.statusCode).toBe(404);
    expect(ApiFailureSchema.parse(JSON.parse(afterDelete.payload)).error.code).toBe(
      'TRIP_NOT_FOUND',
    );
  });

  it('does not reveal another user trip and validates request bodies', async () => {
    const firstToken = await login('one');
    const secondToken = await login('two');
    const createdResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/trips',
        headers: { authorization: `Bearer ${firstToken}` },
        payload: input,
      });
    const createdId = JSON.parse(createdResponse.payload).data.id as string;

    const crossUser = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/trips/${createdId}`,
        headers: { authorization: `Bearer ${secondToken}` },
      });
    expect(crossUser.statusCode).toBe(404);
    expect(ApiFailureSchema.parse(JSON.parse(crossUser.payload)).error.code).toBe('TRIP_NOT_FOUND');

    const crossUserUpdate = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'PATCH',
        url: `/trips/${createdId}`,
        headers: { authorization: `Bearer ${secondToken}` },
        payload: { travelerCount: 4 },
      });
    expect(crossUserUpdate.statusCode).toBe(404);
    expect(ApiFailureSchema.parse(JSON.parse(crossUserUpdate.payload)).error.code).toBe(
      'TRIP_NOT_FOUND',
    );

    const crossUserDelete = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'DELETE',
        url: `/trips/${createdId}`,
        headers: { authorization: `Bearer ${secondToken}` },
      });
    expect(crossUserDelete.statusCode).toBe(404);
    expect(ApiFailureSchema.parse(JSON.parse(crossUserDelete.payload)).error.code).toBe(
      'TRIP_NOT_FOUND',
    );

    const stillOwned = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/trips/${createdId}`,
        headers: { authorization: `Bearer ${firstToken}` },
      });
    expect(stillOwned.statusCode).toBe(200);

    const invalid = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'PATCH',
        url: `/trips/${createdId}`,
        headers: { authorization: `Bearer ${firstToken}` },
        payload: {},
      });
    expect(invalid.statusCode).toBe(400);
    expect(ApiFailureSchema.parse(JSON.parse(invalid.payload)).error.code).toBe(
      'TRIP_VALIDATION_ERROR',
    );
  });
});
