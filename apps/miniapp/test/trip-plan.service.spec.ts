import { describe, expect, it } from 'vitest';

import type {
  GenerateTripPlanInput,
  RegenerateTripPlanDayResult,
  TripPlanGenerationResult,
  TripPlanVersionListResult,
  TripPlanVersionSummary,
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
  it('uses strict shared schemas, Bearer auth and the three plan endpoints', async () => {
    const requests: Array<{ method: string; path: string; authorization: string; data: unknown }> =
      [];
    const responses: unknown[] = [
      { success: true, data: generationResult, requestId: 'plan-1' },
      { success: true, data: listResult, requestId: 'plan-2' },
      { success: true, data: generationResult, requestId: 'plan-3' },
      { success: true, data: dayRegenerationResult, requestId: 'plan-4' },
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
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/generate',
      'GET https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/plan',
      'GET https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/plan/1',
      'POST https://api.example.invalid/trips/123e4567-e89b-12d3-a456-426614174000/regenerate-day',
    ]);
    expect(requests.every((request) => request.authorization === 'Bearer plan-token')).toBe(true);
    expect(requests[0]?.data).toEqual({});
    expect(requests[3]?.data).toEqual({ sourceVersion: 1, dayNumber: 1, instruction: '更轻松' });
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
