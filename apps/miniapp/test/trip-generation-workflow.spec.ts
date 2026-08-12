import { describe, expect, it } from 'vitest';

import type { TripPlanGenerationResult } from '@travel-guide/shared-types';

import { RequestError } from '../services/request-error';
import { createGenerationStageController } from '../utils/trip-generating';
import { runTripPlanGeneration } from '../utils/trip-generation-workflow';
import { buildTripPlanUrl } from '../utils/trip-plan-view';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const generatedAt = '2026-08-11T00:00:00.000Z';

const readyResult: TripPlanGenerationResult = {
  version: 1,
  status: 'ready',
  tripId,
  summary: {
    id: '223e4567-e89b-12d3-a456-426614174000',
    tripId,
    version: 1,
    schemaVersion: '1.0',
    status: 'ready',
    generatedAt,
    createdAt: generatedAt,
  },
  plan: {
    schemaVersion: '1.0',
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
    generatedAt,
  },
};

const createController = () =>
  createGenerationStageController(tripId, {
    timerAdapter: {
      set: () => 1,
      clear: () => undefined,
    },
  });

describe('TripPlan generation workflow', () => {
  it('generates once and navigates to the ready version URL', async () => {
    const controller = createController();
    let generateCalls = 0;
    const navigated: string[] = [];

    await expect(
      runTripPlanGeneration({
        controller,
        generate: async () => {
          generateCalls += 1;
          return readyResult;
        },
        onReady: (result) => navigated.push(buildTripPlanUrl(result.tripId, result.version)),
        onAuthRequired: () => undefined,
        getErrorMessage: () => 'failed',
      }),
    ).resolves.toBe(true);

    expect(generateCalls).toBe(1);
    expect(navigated).toEqual([buildTripPlanUrl(tripId, 1)]);
    expect(controller.getState().status).toBe('ready');
  });

  it('does not start a second request while the first one is pending', async () => {
    const controller = createController();
    let generateCalls = 0;
    let release: ((result: TripPlanGenerationResult) => void) | undefined;
    const first = runTripPlanGeneration({
      controller,
      generate: () => {
        generateCalls += 1;
        return new Promise<TripPlanGenerationResult>((resolve) => {
          release = resolve;
        });
      },
      onReady: () => undefined,
      onAuthRequired: () => undefined,
      getErrorMessage: () => 'failed',
    });

    await expect(
      runTripPlanGeneration({
        controller,
        generate: async () => {
          generateCalls += 1;
          return readyResult;
        },
        onReady: () => undefined,
        onAuthRequired: () => undefined,
        getErrorMessage: () => 'failed',
      }),
    ).resolves.toBe(false);

    release?.(readyResult);
    await expect(first).resolves.toBe(true);
    expect(generateCalls).toBe(1);
  });

  it('does not update or navigate when a pending request resolves after its owner is inactive', async () => {
    const controller = createController();
    let active = true;
    let release: ((result: TripPlanGenerationResult) => void) | undefined;
    let readyCalls = 0;
    const pending = runTripPlanGeneration({
      controller,
      generate: () =>
        new Promise<TripPlanGenerationResult>((resolve) => {
          release = resolve;
        }),
      onReady: () => {
        readyCalls += 1;
      },
      onAuthRequired: () => undefined,
      getErrorMessage: () => 'failed',
      isActive: () => active,
    });

    active = false;
    release?.(readyResult);
    await expect(pending).resolves.toBe(false);
    expect(readyCalls).toBe(0);
    expect(controller.getState().status).toBe('generating');
  });

  it('does not fail or show auth when a pending request rejects after its owner is inactive', async () => {
    const controller = createController();
    let active = true;
    let reject: ((error: Error) => void) | undefined;
    let authCalls = 0;
    const pending = runTripPlanGeneration({
      controller,
      generate: () =>
        new Promise<TripPlanGenerationResult>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
      onReady: () => undefined,
      onAuthRequired: () => {
        authCalls += 1;
      },
      getErrorMessage: () => 'failed',
      isActive: () => active,
    });

    active = false;
    reject?.(new Error('owner unloaded'));
    await expect(pending).resolves.toBe(false);
    expect(authCalls).toBe(0);
    expect(controller.getState().status).toBe('generating');
  });

  it('allows a retry after a failed request', async () => {
    const controller = createController();
    let generateCalls = 0;
    const generate = async (): Promise<TripPlanGenerationResult> => {
      generateCalls += 1;
      throw new Error('temporary failure');
    };
    const options = {
      controller,
      generate,
      onReady: () => undefined,
      onAuthRequired: () => undefined,
      getErrorMessage: () => '稍后重试',
    };

    await expect(runTripPlanGeneration(options)).resolves.toBe(true);
    await expect(runTripPlanGeneration(options)).resolves.toBe(true);
    expect(generateCalls).toBe(2);
    expect(controller.getState().status).toBe('failed');
  });

  it('moves to auth-required without exposing auth details when the token is invalid', async () => {
    const controller = createController();
    let authRequiredCalls = 0;

    await expect(
      runTripPlanGeneration({
        controller,
        generate: async () => {
          throw new RequestError({
            code: 'API_ERROR',
            apiCode: 'AUTH_TOKEN_INVALID',
            message: 'expired token',
          });
        },
        onReady: () => undefined,
        onAuthRequired: () => {
          authRequiredCalls += 1;
        },
        getErrorMessage: () => '不应展示',
      }),
    ).resolves.toBe(true);

    expect(authRequiredCalls).toBe(1);
    expect(controller.getState().status).toBe('auth-required');
    expect(controller.getState().errorMessage).toContain('登录状态已失效');
  });
});
