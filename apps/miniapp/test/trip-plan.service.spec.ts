import { describe, expect, it } from 'vitest';

import type {
  EditTripPlanResult,
  GenerateTripPlanInput,
  RegenerateTripPlanDayResult,
  RestoreTripPlanVersionResult,
  TripPlanGenerationResult,
  TripPlanVersionDiffResult,
  TripPlanVersionListResult,
  TripPlanVersionSummary,
  TripPlanItemReplacementCandidateList,
  ReplaceTripPlanItemResult,
} from '@travel-guide/shared-types';

import { createHttpClient, type RequestAdapter } from '../services/http-client';
import { TripPlanService, type TripPlanAuthService } from '../services/trip-plan.service';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const generatedAt = '2026-08-11T00:00:00.000Z';
const summary: TripPlanVersionSummary = {
  id: '223e4567-e89b-12d3-a456-426614174000',
  tripId,
  version: 1,
  schemaVersion: '1.0',
  status: 'ready',
  generatedAt,
  createdAt: generatedAt,
};
const plan = {
  schemaVersion: '1.0' as const,
  tripId,
  cityName: '杭州',
  startDate: '2026-08-12',
  endDate: '2026-08-12',
  travelerCount: 2,
  summary: '轻松安排。',
  days: [
    {
      dayNumber: 1,
      date: '2026-08-12',
      summary: '第一天',
      weather: {
        date: '2026-08-12',
        condition: 'clear' as const,
        conditionText: '晴',
        source: 'forecast' as const,
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
    currency: 'CNY' as const,
    totalCny: 0,
    accommodationCny: 0,
    transportationCny: 0,
    foodCny: 0,
    attractionsCny: 0,
    otherCny: 0,
  },
  transportationTips: [],
  generalTips: [],
  generatedAt,
};
const generationResult: TripPlanGenerationResult = {
  version: 1,
  status: 'ready',
  tripId,
  plan,
  summary,
};
const listResult: TripPlanVersionListResult = {
  items: [summary],
  latestVersion: 1,
  plan,
};
const dayRegenerationResult: RegenerateTripPlanDayResult = {
  ...generationResult,
  sourceVersion: 1,
  dayNumber: 1,
};
const diffResult: TripPlanVersionDiffResult = {
  tripId,
  fromVersion: 1,
  toVersion: 2,
  dayChanges: [],
  hasChanges: false,
};
const restoredSummary: TripPlanVersionSummary = {
  ...summary,
  id: '323e4567-e89b-12d3-a456-426614174000',
  version: 2,
};
const restoreResult: RestoreTripPlanVersionResult = {
  tripId,
  sourceVersion: 1,
  version: 2,
  status: 'ready',
  plan,
  summary: restoredSummary,
};
const candidatePlace = {
  id: '423e4567-e89b-12d3-a456-426614174000',
  provider: 'fake-map',
  providerPlaceId: 'replacement-1',
  name: '替换景点',
  category: 'attraction' as const,
  categoryText: '景点',
  address: '杭州市西湖区',
  location: { longitude: 120.15, latitude: 30.25 },
  verifiedAt: generatedAt,
  dataSource: 'cache' as const,
};
const candidateList: TripPlanItemReplacementCandidateList = {
  items: [
    {
      place: candidatePlace,
      recommendationReason: '已通过地点数据校验',
    },
  ],
  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
};
const itemReplacementResult: ReplaceTripPlanItemResult = {
  tripId,
  sourceVersion: 1,
  dayNumber: 1,
  itemId: '523e4567-e89b-12d3-a456-426614174000',
  version: 2,
  status: 'ready',
  plan,
  summary: { ...summary, id: '523e4567-e89b-12d3-a456-426614174000', version: 2 },
};

const createAuth = (token: string | undefined): TripPlanAuthService & { loggedOut: boolean } => {
  const auth = {
    loggedOut: false,
    getAccessToken: () => token,
    logout: () => {
      auth.loggedOut = true;
    },
  };
  return auth;
};

const createClient = (adapter: RequestAdapter) =>
  createHttpClient(
    { name: 'test', baseUrl: 'https://api.example.invalid', requestTimeout: 100 },
    adapter,
  );

describe('miniapp TripPlanService', () => {
  it('lists verified candidates and replaces an item with strict authenticated requests', async () => {
    const requests: Array<{ method: string; path: string; data: unknown }> = [];
    const service = new TripPlanService(
      createClient(async (options) => {
        requests.push({ method: options.method, path: options.url, data: options.data });
        const data = requests.length === 1 ? candidateList : itemReplacementResult;
        return { statusCode: 200, data: { success: true, data, requestId: 'replace-1' } };
      }),
      createAuth('plan-token'),
    );
    await expect(
      service.listReplacementCandidates(tripId, 1, 1, itemReplacementResult.itemId),
    ).resolves.toEqual(candidateList);
    await expect(
      service.replaceTripPlanItem(tripId, 1, {
        sourceVersion: 1,
        dayNumber: 1,
        itemId: itemReplacementResult.itemId,
        replacementPlaceId: candidatePlace.id,
      }),
    ).resolves.toEqual(itemReplacementResult);
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `GET https://api.example.invalid/trips/${tripId}/plan/1/items/${itemReplacementResult.itemId}/replacement-candidates?dayNumber=1`,
      `POST https://api.example.invalid/trips/${tripId}/plan/1/replace-item`,
    ]);
  });

  it('sends a strict controlled edit with matching URL/body version', async () => {
    const requests: Array<{ method: string; path: string; data: unknown }> = [];
    const editResult: EditTripPlanResult = {
      tripId,
      sourceVersion: 1,
      version: 2,
      status: 'ready',
      plan,
      summary: { ...summary, id: '323e4567-e89b-12d3-a456-426614174000', version: 2 },
    };
    const service = new TripPlanService(
      createClient(async (options) => {
        requests.push({ method: options.method, path: options.url, data: options.data });
        return { statusCode: 200, data: { success: true, data: editResult, requestId: 'edit-1' } };
      }),
      createAuth('plan-token'),
    );
    await expect(
      service.editTripPlanVersion(tripId, 1, {
        sourceVersion: 1,
        summary: '更新摘要',
      }),
    ).resolves.toEqual(editResult);
    expect(requests).toEqual([
      {
        method: 'PATCH',
        path: `https://api.example.invalid/trips/${tripId}/plan/1`,
        data: { sourceVersion: 1, summary: '更新摘要' },
      },
    ]);
    await expect(
      service.editTripPlanVersion(tripId, 2, { sourceVersion: 1, summary: '不匹配' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('uses strict shared schemas, Bearer auth and the three plan endpoints', async () => {
    const requests: Array<{ method: string; path: string; authorization: string; data: unknown }> =
      [];
    const responses: unknown[] = [
      { success: true, data: generationResult, requestId: 'plan-1' },
      { success: true, data: listResult, requestId: 'plan-2' },
      { success: true, data: generationResult, requestId: 'plan-3' },
      { success: true, data: dayRegenerationResult, requestId: 'plan-4' },
      { success: true, data: diffResult, requestId: 'plan-5' },
      { success: true, data: restoreResult, requestId: 'plan-6' },
    ];
    const service = new TripPlanService(
      createClient(async (options) => {
        requests.push({
          method: options.method,
          path: options.url,
          authorization: options.header?.Authorization ?? '',
          data: options.data,
        });
        return { statusCode: 200, data: responses.shift() };
      }),
      createAuth('plan-token'),
    );

    await expect(service.generateTripPlan(tripId, {} as GenerateTripPlanInput)).resolves.toEqual(
      generationResult,
    );
    await expect(service.getLatestTripPlan(tripId)).resolves.toEqual(listResult);
    await expect(service.getTripPlanVersion(tripId, 1)).resolves.toEqual(generationResult);
    await expect(
      service.regenerateTripPlanDay(tripId, {
        sourceVersion: 1,
        dayNumber: 1,
        instruction: '  更轻松  ',
      }),
    ).resolves.toEqual(dayRegenerationResult);
    await expect(service.getTripPlanDiff(tripId, 1, 2)).resolves.toEqual(diffResult);
    await expect(service.restoreTripPlanVersion(tripId, 1)).resolves.toEqual(restoreResult);
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/generate',
      'GET https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/plan',
      'GET https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/plan/1',
      'POST https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/regenerate-day',
      'GET https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/plan/diff?fromVersion=1&toVersion=2',
      'POST https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/plan/1/restore',
    ]);
    expect(requests.every((request) => request.authorization === 'Bearer plan-token')).toBe(true);
    expect(requests[0]?.data).toEqual({});
    expect(requests[3]?.data).toEqual({ sourceVersion: 1, dayNumber: 1, instruction: '更轻松' });
    expect(requests[5]?.data).toEqual({});
  });

  it('does not access network without a token and validates UUID/version locally', async () => {
    let requests = 0;
    const service = new TripPlanService(
      createClient(async () => {
        requests += 1;
        throw new Error('network should not be called');
      }),
      createAuth(undefined),
    );
    await expect(service.getLatestTripPlan(tripId)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    await expect(service.getTripPlanVersion('not-a-uuid', 1)).rejects.toThrow();
    await expect(service.getTripPlanVersion(tripId, 0)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(requests).toBe(0);
  });

  it('clears auth state on API token failure and rejects malformed responses', async () => {
    const auth = createAuth('expired-token');
    const service = new TripPlanService(
      createClient(async () => ({
        statusCode: 401,
        data: {
          success: false,
          error: { code: 'AUTH_TOKEN_INVALID', message: 'The access token is invalid' },
          requestId: 'plan-4',
        },
      })),
      auth,
    );
    await expect(service.getLatestTripPlan(tripId)).rejects.toMatchObject({
      apiCode: 'AUTH_TOKEN_INVALID',
    });
    expect(auth.loggedOut).toBe(true);

    const malformed = new TripPlanService(
      createClient(async () => ({
        statusCode: 200,
        data: { success: true, data: { items: [], unexpected: true }, requestId: 'plan-5' },
      })),
      createAuth('plan-token'),
    );
    await expect(malformed.getLatestTripPlan(tripId)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
