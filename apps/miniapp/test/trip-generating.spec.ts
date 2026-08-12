import { describe, expect, it } from 'vitest';

import { RequestError } from '../services/request-error';
import {
  advanceTripGenerationPhase,
  canStartTripGeneration,
  createGenerationStageController,
  createTripGeneratingState,
  failTripGeneration,
  finishTripGeneration,
  startTripGeneration,
  isTripGenerationAuthFailure,
  TRIP_GENERATION_PHASES,
} from '../utils/trip-generating';

describe('TripPlan generation state model', () => {
  it('loops through six qualitative phases without a progress percentage', () => {
    expect(TRIP_GENERATION_PHASES).toEqual([
      '正在准备旅行需求…',
      '正在查询天气…',
      '正在筛选景点…',
      '正在规划路线…',
      '正在生成攻略…',
      '正在保存攻略…',
    ]);
    let state = startTripGeneration(
      createTripGeneratingState('123e4567-e89b-12d3-a456-426614174000'),
    );
    expect(state.phaseMessage).toBe(TRIP_GENERATION_PHASES[0]);
    expect(state.status).toBe('generating');

    for (let index = 1; index < TRIP_GENERATION_PHASES.length; index += 1) {
      state = advanceTripGenerationPhase(state);
      expect(state.phaseMessage).toBe(TRIP_GENERATION_PHASES[index]);
    }
    expect(advanceTripGenerationPhase(state).phaseMessage).toBe(TRIP_GENERATION_PHASES[0]);
    expect(JSON.stringify(state)).not.toContain('percent');
  });

  it('protects a duplicate start and keeps retry possible after failure', () => {
    const state = startTripGeneration(
      createTripGeneratingState('123e4567-e89b-12d3-a456-426614174000'),
    );
    expect(startTripGeneration(state)).toEqual(state);
    expect(canStartTripGeneration(state)).toBe(false);
    const failed = failTripGeneration(state, '稍后重试');
    expect(failed.status).toBe('failed');
    expect(canStartTripGeneration(failed)).toBe(true);
  });

  it('only treats a ready result carrying a plan as success', () => {
    const state = startTripGeneration(
      createTripGeneratingState('123e4567-e89b-12d3-a456-426614174000'),
    );
    const result = {
      version: 1,
      status: 'failed' as const,
      tripId: state.tripId,
      summary: {
        id: '223e4567-e89b-12d3-a456-426614174000',
        tripId: state.tripId,
        version: 1,
        schemaVersion: '1.0' as const,
        status: 'failed' as const,
        createdAt: '2026-08-11T00:00:00.000Z',
      },
    };
    expect(finishTripGeneration(state, result).status).toBe('failed');
  });

  it('owns and clears one timer per controller instance', () => {
    const callbacks: Array<() => void> = [];
    const cleared: unknown[] = [];
    const timerAdapter = {
      set: (callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      clear: (timer: unknown) => cleared.push(timer),
    };
    const first = createGenerationStageController('123e4567-e89b-12d3-a456-426614174000', {
      timerAdapter,
    });
    const second = createGenerationStageController('123e4567-e89b-12d3-a456-426614174001', {
      timerAdapter,
    });

    expect(first.start()).toBe(true);
    expect(second.start()).toBe(true);
    expect(callbacks).toHaveLength(2);
    callbacks[0]?.();
    expect(first.getState().phaseIndex).toBe(1);
    expect(second.getState().phaseIndex).toBe(0);
    first.clear();
    expect(cleared).toEqual([1]);
    second.finish({
      version: 1,
      status: 'failed',
      tripId: second.getState().tripId,
      summary: {
        id: '223e4567-e89b-12d3-a456-426614174000',
        tripId: second.getState().tripId,
        version: 1,
        schemaVersion: '1.0',
        status: 'failed',
        createdAt: '2026-08-11T00:00:00.000Z',
      },
    });
    expect(cleared).toEqual([1, 2]);
  });

  it('classifies token failures so the page can show re-login while the service clears auth', () => {
    expect(
      isTripGenerationAuthFailure(
        new RequestError({ code: 'API_ERROR', apiCode: 'AUTH_TOKEN_INVALID', message: 'expired' }),
      ),
    ).toBe(true);
    expect(isTripGenerationAuthFailure(new Error('other'))).toBe(false);
  });
});
