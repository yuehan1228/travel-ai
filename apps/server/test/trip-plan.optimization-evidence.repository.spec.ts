import { describe, expect, it } from 'vitest';

import { RouteMatrixResultSchema, TripPlanSchema } from '@travel-guide/shared-schemas';
import type { Database } from '../src/database/database.types';
import { tripPlanOptimizationEvidence } from '../src/database/schema';
import { calculateNearestNeighborOrderWithExplanation } from '../src/modules/routes/route-order.algorithm';
import {
  DrizzleTripPlanRepository,
  type TripPlanGenerationReservation,
  type TripPlanOptimizationEvidenceInput,
} from '../src/modules/trip-plan/repositories/trip-plan.repository';
import type { TripPlan } from '@travel-guide/shared-types';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const userId = '223e4567-e89b-12d3-a456-426614174000';
const firstId = '323e4567-e89b-12d3-a456-426614174000';
const secondId = '423e4567-e89b-12d3-a456-426614174000';
const firstPlaceId = '523e4567-e89b-12d3-a456-426614174000';
const secondPlaceId = '623e4567-e89b-12d3-a456-426614174000';
const now = new Date('2026-08-11T00:00:00.000Z');

const plan = (): TripPlan =>
  TripPlanSchema.parse({
    schemaVersion: '1.0',
    tripId,
    cityName: '杭州',
    startDate: '2026-08-12',
    endDate: '2026-08-12',
    travelerCount: 2,
    summary: '行程',
    days: [
      {
        dayNumber: 1,
        date: '2026-08-12',
        summary: '第一天',
        weather: {
          date: '2026-08-12',
          condition: 'clear',
          conditionText: '晴',
          source: 'forecast',
          isReference: false,
        },
        items: [],
        estimatedCostCny: 0,
        warnings: [],
      },
    ],
    hotelRecommendations: [],
    foodRecommendations: [],
    budget: {
      currency: 'CNY',
      totalCny: 0,
      accommodationCny: 0,
      transportationCny: 0,
      foodCny: 0,
      attractionsCny: 0,
      otherCny: 0,
    },
    transportationTips: [],
    generalTips: [],
    generatedAt: now.toISOString(),
  });

const matrix = RouteMatrixResultSchema.parse({
  points: [
    {
      id: firstId,
      endpoint: {
        location: { longitude: 120.15, latitude: 30.25 },
        placeId: firstPlaceId,
      },
    },
    {
      id: secondId,
      endpoint: {
        location: { longitude: 120.16, latitude: 30.25 },
        placeId: secondPlaceId,
      },
    },
  ],
  mode: 'walking',
  cells: [
    {
      originId: firstId,
      destinationId: secondId,
      status: 'available',
      estimate: {
        origin: {
          location: { longitude: 120.15, latitude: 30.25 },
          placeId: firstPlaceId,
        },
        destination: {
          location: { longitude: 120.16, latitude: 30.25 },
          placeId: secondPlaceId,
        },
        mode: 'walking',
        dataSource: 'map_provider',
        provider: 'fake-route',
        fetchedAt: now.toISOString(),
        distanceMeters: 100,
        durationSeconds: 120,
      },
    },
    {
      originId: secondId,
      destinationId: firstId,
      status: 'available',
      estimate: {
        origin: {
          location: { longitude: 120.16, latitude: 30.25 },
          placeId: secondPlaceId,
        },
        destination: {
          location: { longitude: 120.15, latitude: 30.25 },
          placeId: firstPlaceId,
        },
        mode: 'walking',
        dataSource: 'map_provider',
        provider: 'fake-route',
        fetchedAt: now.toISOString(),
        distanceMeters: 100,
        durationSeconds: 120,
      },
    },
  ],
  generatedAt: now.toISOString(),
});

const order = calculateNearestNeighborOrderWithExplanation(matrix, secondId, firstId).order;
const explanation = calculateNearestNeighborOrderWithExplanation(matrix, secondId, firstId);
const evidence: TripPlanOptimizationEvidenceInput = {
  sourceVersion: 1,
  dayNumber: 1,
  mode: 'walking',
  startItemId: secondId,
  endItemId: firstId,
  matrixSnapshot: matrix,
  orderSnapshot: order,
  explanationSnapshot: explanation,
  generatedAt: now,
};

const sourceItem = (
  id: string,
  placeId: string,
  longitude: number,
  startTime: string,
  endTime: string,
) => ({
  id,
  type: 'attraction' as const,
  startTime,
  endTime,
  name: id === firstId ? '一' : '二',
  description: '景点',
  recommendationReason: '真实地点',
  place: {
    id: placeId,
    provider: 'fake-map',
    providerPlaceId: placeId,
    name: id === firstId ? '一' : '二',
    category: 'attraction' as const,
    categoryText: '景点',
    address: '杭州',
    location: { longitude, latitude: 30.25 },
    verifiedAt: now.toISOString(),
    dataSource: 'cache' as const,
  },
  estimatedCostCny: 0,
  tips: [],
  dataSources: ['map_provider' as const],
});

const sourcePlan = (): TripPlan =>
  TripPlanSchema.parse({
    ...plan(),
    days: [
      {
        ...plan().days[0]!,
        items: [
          sourceItem(firstId, firstPlaceId, 120.15, '09:00', '10:00'),
          sourceItem(secondId, secondPlaceId, 120.16, '10:30', '11:30'),
        ],
        estimatedCostCny: 0,
      },
    ],
  });

const targetPlan = (): TripPlan => {
  const source = sourcePlan();
  return TripPlanSchema.parse({
    ...source,
    generatedAt: now.toISOString(),
    days: [
      {
        ...source.days[0]!,
        items: [
          { ...source.days[0]!.items[1]!, startTime: '09:00', endTime: '10:00' },
          {
            ...source.days[0]!.items[0]!,
            startTime: '10:02',
            endTime: '11:02',
            route: matrix.cells[1]!.estimate,
            dataSources: ['map_provider', 'route_provider'],
          },
        ],
      },
    ],
  });
};

interface SelectBuilder {
  from(table: unknown): SelectBuilder;
  innerJoin(table: unknown, condition: unknown): SelectBuilder;
  where(condition: unknown): SelectBuilder;
  limit(value: number): Promise<readonly unknown[]>;
}

interface UpdateBuilder {
  set(values: unknown): UpdateBuilder;
  where(condition: unknown): UpdateBuilder;
  returning(): Promise<readonly unknown[]>;
}

interface InsertBuilder {
  values(values: unknown): Promise<void>;
}

interface FakeTransaction {
  select(fields?: unknown): SelectBuilder;
  update(table: unknown): UpdateBuilder;
  insert(table: unknown): InsertBuilder;
}

const reservation = (
  operation: TripPlanGenerationReservation['operation'],
): TripPlanGenerationReservation => ({
  versionId: '723e4567-e89b-12d3-a456-426614174000',
  version: 2,
  tripId,
  userId,
  input: {
    destination: { cityName: '杭州' },
    startDate: '2026-08-12',
    endDate: '2026-08-12',
    travelerCount: 2,
    preferences: ['nature'],
    pace: 'relaxed',
    transportPreference: 'public_transport',
  },
  createdAt: now,
  operation,
  sourceVersion: 1,
  dayNumber: 1,
  previousTripStatus: 'ready',
});

const createFakeDatabase = (failEvidenceInsert = false) => {
  const events: string[] = [];
  const insertedTables: unknown[] = [];
  let selectCount = 0;
  let updateCount = 0;
  let inTransaction = false;
  const targetVersion = {
    id: '723e4567-e89b-12d3-a456-426614174000',
    tripId,
    version: 2,
    schemaVersion: '1.0',
    status: 'ready',
    planSnapshot: plan(),
    generatedAt: now,
    createdAt: now,
  };
  const tx: FakeTransaction = {
    select: () => {
      const result =
        selectCount++ === 0 ? [{ id: tripId }] : [{ id: '823e4567-e89b-12d3-a456-426614174000' }];
      const builder: SelectBuilder = {
        from: () => builder,
        innerJoin: () => builder,
        where: () => builder,
        limit: async () => result,
      };
      return builder;
    },
    update: () => {
      const builder: UpdateBuilder = {
        set: () => builder,
        where: () => builder,
        returning: async () => {
          events.push(updateCount++ === 0 ? 'version-ready' : 'trip-ready');
          return updateCount === 1 ? [targetVersion] : [{ id: tripId }];
        },
      };
      return builder;
    },
    insert: (table) => ({
      values: async () => {
        insertedTables.push(table);
        if (table === tripPlanOptimizationEvidence) {
          events.push('evidence-insert');
          if (failEvidenceInsert) throw new Error('evidence insert failed');
        } else {
          events.push('day-or-item-insert');
        }
      },
    }),
  };
  const database = {
    transaction: async <T>(callback: (transaction: FakeTransaction) => Promise<T>): Promise<T> => {
      inTransaction = true;
      const snapshot = [...insertedTables];
      const eventSnapshot = [...events];
      try {
        return await callback(tx);
      } catch (error: unknown) {
        insertedTables.splice(0, insertedTables.length, ...snapshot);
        events.splice(0, events.length, ...eventSnapshot);
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  };
  return {
    database: database as unknown as Database,
    events,
    insertedTables,
    get inTransaction() {
      return inTransaction;
    },
  };
};

const createReadDatabase = (
  storedEvidence: Record<string, unknown>,
  target = targetPlan(),
  source = sourcePlan(),
  sourceReady = true,
) => {
  let selectCount = 0;
  const targetRow = {
    id: '723e4567-e89b-12d3-a456-426614174000',
    tripId,
    version: 2,
    schemaVersion: '1.0',
    status: 'ready',
    planSnapshot: target,
    generatedAt: now,
    createdAt: now,
  };
  const sourceRow = {
    id: '823e4567-e89b-12d3-a456-426614174000',
    tripId,
    version: 1,
    schemaVersion: '1.0',
    status: sourceReady ? 'ready' : 'failed',
    planSnapshot: sourceReady ? source : null,
    generatedAt: now,
    createdAt: now,
  };
  const database = {
    select: () => {
      const result =
        selectCount++ === 0
          ? [{ evidence: storedEvidence, target: targetRow }]
          : sourceReady
            ? [{ version: sourceRow }]
            : [];
      const builder: SelectBuilder = {
        from: () => builder,
        innerJoin: () => builder,
        where: () => builder,
        limit: async () => result,
      };
      return builder;
    },
  };
  return database as unknown as Database;
};

describe('TASK-026 optimization evidence persistence', () => {
  it('writes evidence after the version/day rows and before Trip ready in one transaction', async () => {
    const fake = createFakeDatabase();
    const repository = new DrizzleTripPlanRepository(fake.database);
    await repository.saveReady(
      userId,
      tripId,
      reservation('optimize-order'),
      plan(),
      now,
      evidence,
    );
    expect(fake.events).toEqual([
      'version-ready',
      'day-or-item-insert',
      'evidence-insert',
      'trip-ready',
    ]);
    expect(fake.insertedTables).toContain(tripPlanOptimizationEvidence);
    expect(fake.inTransaction).toBe(false);
  });

  it('rolls back evidence and never reaches Trip ready when evidence insert fails', async () => {
    const fake = createFakeDatabase(true);
    const repository = new DrizzleTripPlanRepository(fake.database);
    await expect(
      repository.saveReady(userId, tripId, reservation('optimize-order'), plan(), now, evidence),
    ).rejects.toThrow('evidence insert failed');
    expect(fake.insertedTables).toEqual([]);
    expect(fake.events).toEqual([]);
    expect(fake.inTransaction).toBe(false);
  });

  it('requires evidence only for optimize-order and rejects evidence on other operations', async () => {
    const fake = createFakeDatabase();
    const repository = new DrizzleTripPlanRepository(fake.database);
    await expect(
      repository.saveReady(userId, tripId, reservation('optimize-order'), plan(), now),
    ).rejects.toThrow('Optimization evidence is required');
    await expect(
      repository.saveReady(userId, tripId, reservation('reorder-items'), plan(), now, evidence),
    ).rejects.toThrow('Optimization evidence requires an optimize-order reservation');
    expect(fake.events).toEqual([]);
  });

  it('replays stored evidence and fails closed for tampered measurements or unavailable source', async () => {
    const stored = {
      id: '923e4567-e89b-12d3-a456-426614174000',
      versionId: '723e4567-e89b-12d3-a456-426614174000',
      tripId,
      sourceVersion: 1,
      dayNumber: 1,
      mode: 'walking',
      evidenceVersion: '1.0',
      startItemId: secondId,
      endItemId: firstId,
      matrixSnapshot: matrix,
      orderSnapshot: order,
      explanationSnapshot: explanation,
      generatedAt: now,
      createdAt: now,
    };
    const repository = new DrizzleTripPlanRepository(createReadDatabase(stored));
    const audit = await repository.findOptimizationAuditForUser(userId, tripId, 2, 1);
    expect(audit?.orderedItemIds).toEqual([secondId, firstId]);
    expect(audit?.timelineChanges[1]?.routeDurationSeconds).toBe(120);

    const tampered = {
      ...stored,
      orderSnapshot: { ...order, totalDistanceMeters: 999 },
    };
    await expect(
      new DrizzleTripPlanRepository(createReadDatabase(tampered)).findOptimizationAuditForUser(
        userId,
        tripId,
        2,
        1,
      ),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_AUDIT_VALIDATION_ERROR' });

    await expect(
      new DrizzleTripPlanRepository(
        createReadDatabase(stored, targetPlan(), sourcePlan(), false),
      ).findOptimizationAuditForUser(userId, tripId, 2, 1),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_AUDIT_VALIDATION_ERROR' });
  });

  it.each([
    [
      'matrix',
      () => ({
        ...storedBase(),
        matrixSnapshot: {
          ...matrix,
          cells: matrix.cells.map((cell) =>
            cell.status === 'available'
              ? { ...cell, estimate: { ...cell.estimate!, distanceMeters: 999 } }
              : cell,
          ),
        },
      }),
    ],
    [
      'explanation',
      () => ({
        ...storedBase(),
        explanationSnapshot: {
          ...explanation,
          decisions: explanation.decisions.map((decision) => ({
            ...decision,
            candidates: decision.candidates.map((candidate) =>
              candidate.status === 'available' ? { ...candidate, durationSeconds: 999 } : candidate,
            ),
          })),
        },
      }),
    ],
  ])('rejects %s snapshot tampering', async (_label, build) => {
    await expect(
      new DrizzleTripPlanRepository(createReadDatabase(build())).findOptimizationAuditForUser(
        userId,
        tripId,
        2,
        1,
      ),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_AUDIT_VALIDATION_ERROR' });
  });

  it('rejects target RouteEstimate, timeline and cross-trip source tampering', async () => {
    const stored = storedBase();
    const routeTampered = targetPlan();
    const routeTamperedItem = routeTampered.days[0]!.items[1]!;
    if (
      routeTamperedItem.route === undefined ||
      routeTamperedItem.route.dataSource === 'unavailable'
    ) {
      throw new Error('expected available target route');
    }
    routeTampered.days[0]!.items[1] = {
      ...routeTamperedItem,
      route: { ...routeTamperedItem.route, distanceMeters: 999 },
    };
    await expect(
      new DrizzleTripPlanRepository(
        createReadDatabase(stored, routeTampered),
      ).findOptimizationAuditForUser(userId, tripId, 2, 1),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_AUDIT_VALIDATION_ERROR' });

    const timelineTampered = targetPlan();
    timelineTampered.days[0]!.items[1]!.startTime = '10:03';
    timelineTampered.days[0]!.items[1]!.endTime = '11:03';
    await expect(
      new DrizzleTripPlanRepository(
        createReadDatabase(stored, timelineTampered),
      ).findOptimizationAuditForUser(userId, tripId, 2, 1),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_AUDIT_VALIDATION_ERROR' });

    const crossTripSource = TripPlanSchema.parse({
      ...sourcePlan(),
      tripId: 'a23e4567-e89b-12d3-a456-426614174000',
    });
    await expect(
      new DrizzleTripPlanRepository(
        createReadDatabase(stored, targetPlan(), crossTripSource),
      ).findOptimizationAuditForUser(userId, tripId, 2, 1),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_AUDIT_VALIDATION_ERROR' });
  });
});

function storedBase(): Record<string, unknown> {
  return {
    id: '923e4567-e89b-12d3-a456-426614174000',
    versionId: '723e4567-e89b-12d3-a456-426614174000',
    tripId,
    sourceVersion: 1,
    dayNumber: 1,
    mode: 'walking',
    evidenceVersion: '1.0',
    startItemId: secondId,
    endItemId: firstId,
    matrixSnapshot: matrix,
    orderSnapshot: order,
    explanationSnapshot: explanation,
    generatedAt: now,
    createdAt: now,
  };
}
