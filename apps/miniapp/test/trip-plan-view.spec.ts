import { describe, expect, it } from 'vitest';

import type { TripPlan } from '@travel-guide/shared-types';

import { RequestError } from '../services/request-error';
import {
  applyLatestTripPlanResult,
  applyTripPlanDiffResult,
  applyTripPlanVersionRestoreResult,
  applyTripPlanDayRegenerationResult,
  applyTripPlanEditResult,
  applyTripPlanViewError,
  applyTripPlanVersionResult,
  beginTripPlanDayRegeneration,
  beginTripPlanEdit,
  beginTripPlanDiff,
  beginTripPlanVersionRestore,
  createTripPlanDisplayModel,
  createTripPlanViewState,
  createTripPlanViewStateRegistry,
  formatTripPlanRoute,
  formatTripPlanWeather,
  getVisibleTripPlanVersions,
  getReadyTripPlanVersions,
  parseLatestTripPlanResult,
  parseTripPlanRouteParams,
} from '../utils/trip-plan-view';

const tripId = '123e4567-e89b-12d3-a456-426614174000';
const versionId = '223e4567-e89b-12d3-a456-426614174000';
const generatedAt = '2026-08-11T00:00:00.000Z';

const plan: TripPlan = {
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
};

const readySummary = {
  id: versionId,
  tripId,
  version: 1,
  schemaVersion: '1.0' as const,
  status: 'ready' as const,
  generatedAt,
  createdAt: generatedAt,
};

const threeDayPlan: TripPlan = {
  ...plan,
  endDate: '2026-08-14',
  days: [1, 2, 3].map((dayNumber) => ({
    ...plan.days[0],
    dayNumber,
    date: `2026-08-${String(11 + dayNumber).padStart(2, '0')}`,
    summary: `第${dayNumber}天`,
    weather: {
      ...plan.days[0].weather,
      date: `2026-08-${String(11 + dayNumber).padStart(2, '0')}`,
    },
  })),
};

describe('TripPlan view adapters', () => {
  it('validates URL params before network and rejects malformed versions', () => {
    expect(parseTripPlanRouteParams({ tripId, version: '2' })).toEqual({ tripId, version: 2 });
    expect(() => parseTripPlanRouteParams({ tripId: 'not-a-uuid' })).toThrowError(RequestError);
    expect(() => parseTripPlanRouteParams({ tripId, version: '0' })).toThrowError(RequestError);
  });

  it('keeps all statuses in the visible list and only ready versions in the picker', () => {
    const versions = Array.from({ length: 101 }, (_, index) => ({
      ...readySummary,
      id: `123e4567-e89b-12d3-a456-${String(index + 1).padStart(12, '0')}`,
      version: index + 1,
    }));
    versions[0] = { ...versions[0], status: 'failed', generatedAt: undefined };
    expect(getVisibleTripPlanVersions(versions)).toHaveLength(100);
    expect(getVisibleTripPlanVersions(versions)[0]?.status).toBe('failed');
    expect(getReadyTripPlanVersions(versions)).toHaveLength(99);
    expect(getReadyTripPlanVersions(versions).every((item) => item.status === 'ready')).toBe(true);
  });

  it('renders forecast, climate reference and unavailable weather without inventing measurements', () => {
    expect(formatTripPlanWeather(plan.days[0].weather).sourceLabel).toBe('天气预报');
    expect(
      formatTripPlanWeather({
        ...plan.days[0].weather,
        source: 'climate_reference',
        isReference: true,
        conditionText: '历史多云',
      }).notice,
    ).toContain('历史气候参考');
    const unavailable = formatTripPlanWeather({
      ...plan.days[0].weather,
      condition: 'unknown',
      conditionText: '未知',
      source: 'unavailable',
      isReference: false,
    });
    expect(unavailable.isUnavailable).toBe(true);
    expect(unavailable.temperatureText).toBe('');
  });

  it('does not fabricate a route when missing or unavailable', () => {
    expect(formatTripPlanRoute(undefined)).toBeUndefined();
    const unavailable = formatTripPlanRoute({
      origin: { location: { longitude: 120, latitude: 30 } },
      destination: { location: { longitude: 121, latitude: 31 } },
      mode: 'walking',
      dataSource: 'unavailable',
      provider: 'amap',
      fetchedAt: generatedAt,
    });
    expect(unavailable?.isUnavailable).toBe(true);
    expect(unavailable?.distanceText).toBe('');
  });

  it('strictly validates plans and preserves an old plan on version failure', () => {
    const state = createTripPlanViewState(tripId);
    const latest = applyLatestTripPlanResult(state, {
      items: [readySummary],
      latestVersion: 1,
      plan,
    });
    expect(latest.plan).toEqual(plan);
    expect(createTripPlanDisplayModel(plan).cityName).toBe('杭州');

    const failed = applyTripPlanViewError(latest, '切换失败');
    expect(failed.plan).toEqual(plan);

    const result = {
      version: 1,
      status: 'ready' as const,
      tripId,
      plan,
      summary: readySummary,
    };
    expect(applyTripPlanVersionResult(latest, result).plan).toEqual(plan);
    expect(() => parseLatestTripPlanResult({ items: [], unexpected: true })).toThrowError(
      RequestError,
    );
  });

  it('single-flights day replacement and switches only after a ready result', () => {
    const state = applyLatestTripPlanResult(createTripPlanViewState(tripId), {
      items: [readySummary],
      latestVersion: 1,
      plan,
    });
    const loading = beginTripPlanDayRegeneration(state, 1);
    expect(loading.regeneratingDay).toBe(1);
    expect(beginTripPlanDayRegeneration(loading, 2)).toBe(loading);

    const nextSummary = {
      ...readySummary,
      id: '323e4567-e89b-12d3-a456-426614174000',
      version: 2,
    };
    const nextPlan = { ...plan, summary: '新的第一天安排' };
    const switched = applyTripPlanDayRegenerationResult(loading, {
      version: 2,
      status: 'ready',
      tripId,
      plan: nextPlan,
      summary: nextSummary,
      sourceVersion: 1,
      dayNumber: 1,
    });
    expect(switched.plan?.summary).toBe('新的第一天安排');
    expect(switched.selectedVersion).toBe(2);
    expect(switched.regeneratingDay).toBeUndefined();
    expect(switched.readyVersions[0]?.version).toBe(2);
  });

  it('single-flights ready-only edits, switches on success, and keeps drafts on failure', () => {
    const state = applyLatestTripPlanResult(createTripPlanViewState(tripId), {
      items: [readySummary],
      latestVersion: 1,
      plan,
    });
    const input = { sourceVersion: 1, summary: '更新摘要' } as const;
    const editing = beginTripPlanEdit(state, input);
    expect(editing.isEditing).toBe(true);
    expect(beginTripPlanEdit(editing, input)).toBe(editing);
    const nextSummary = {
      ...readySummary,
      id: '323e4567-e89b-12d3-a456-426614174000',
      version: 2,
    };
    const switched = applyTripPlanEditResult(editing, {
      tripId,
      sourceVersion: 1,
      version: 2,
      status: 'ready',
      plan: { ...plan, summary: '更新摘要' },
      summary: nextSummary,
    });
    expect(switched.plan?.summary).toBe('更新摘要');
    expect(switched.selectedVersion).toBe(2);
    expect(switched.isEditing).toBe(false);
    expect(applyTripPlanViewError(editing, '保存失败').plan).toEqual(plan);
    expect(applyTripPlanViewError(editing, '保存失败').isEditing).toBe(true);
  });

  it('single-flights diff and restore while preserving the displayed plan on failure', () => {
    const state = applyLatestTripPlanResult(createTripPlanViewState(tripId), {
      items: [
        readySummary,
        { ...readySummary, version: 2, id: '323e4567-e89b-12d3-a456-426614174000' },
      ],
      latestVersion: 2,
      plan,
    });
    const diffLoading = beginTripPlanDiff(state, 1, 2);
    expect(diffLoading.isDiffLoading).toBe(true);
    expect(beginTripPlanDiff(diffLoading, 1, 2)).toBe(diffLoading);
    const compared = applyTripPlanDiffResult(diffLoading, {
      tripId,
      fromVersion: 1,
      toVersion: 2,
      dayChanges: [],
      hasChanges: false,
    });
    expect(compared.diff?.hasChanges).toBe(false);

    const restoring = beginTripPlanVersionRestore(compared, 1);
    expect(restoring.restoringVersion).toBe(1);
    expect(beginTripPlanVersionRestore(restoring, 2)).toBe(restoring);
    const restored = applyTripPlanVersionRestoreResult(restoring, {
      tripId,
      sourceVersion: 1,
      version: 3,
      status: 'ready',
      plan,
      summary: { ...readySummary, version: 3, id: '423e4567-e89b-12d3-a456-426614174000' },
    });
    expect(restored.selectedVersion).toBe(3);
    expect(restored.restoringVersion).toBeUndefined();
    expect(applyTripPlanViewError(restored, '恢复失败').plan).toEqual(plan);
  });

  it('renders all days and exposes generated metadata in the display model', () => {
    const display = createTripPlanDisplayModel(threeDayPlan);
    expect(display.days).toHaveLength(3);
    expect(display.generatedAt).toBe(generatedAt);
    expect(display.budgetTotalText).toBe('¥0');
  });

  it('retains generating and failed summaries while refusing non-ready switches', () => {
    const generatingSummary = {
      ...readySummary,
      id: '323e4567-e89b-12d3-a456-426614174000',
      version: 2,
      status: 'generating' as const,
      generatedAt: undefined,
    };
    const failedSummary = {
      ...readySummary,
      id: '423e4567-e89b-12d3-a456-426614174000',
      version: 3,
      status: 'failed' as const,
      generatedAt: undefined,
    };
    const latest = applyLatestTripPlanResult(createTripPlanViewState(tripId), {
      items: [failedSummary, generatingSummary, readySummary],
      latestVersion: 1,
      plan,
    });
    expect(latest.allVersions.map((item) => item.status)).toEqual([
      'failed',
      'generating',
      'ready',
    ]);
    expect(latest.readyVersions).toHaveLength(1);

    const nonReady = applyTripPlanVersionResult(latest, {
      version: 2,
      status: 'generating',
      tripId,
      summary: generatingSummary,
    });
    expect(nonReady.plan).toEqual(plan);
    expect(nonReady.selectedVersion).toBe(1);
    expect(nonReady.errorMessage).toContain('尚未准备好');
  });

  it('isolates state for two detail page instances', () => {
    const registry = createTripPlanViewStateRegistry<object>();
    const first = {};
    const second = {};
    const firstState = createTripPlanViewState(tripId);
    const secondState = createTripPlanViewState('223e4567-e89b-12d3-a456-426614174000');
    registry.set(first, firstState);
    registry.set(second, secondState);

    expect(registry.get(first)?.tripId).toBe(tripId);
    expect(registry.get(second)?.tripId).toBe(secondState.tripId);
    expect(registry.get(first)).not.toBe(registry.get(second));
  });

  it('removes a page state on unload without affecting another instance', () => {
    const registry = createTripPlanViewStateRegistry<object>();
    const first = {};
    const second = {};
    registry.set(first, createTripPlanViewState(tripId));
    registry.set(second, createTripPlanViewState(readySummary.tripId));
    registry.delete(first);

    expect(registry.has(first)).toBe(false);
    expect(registry.has(second)).toBe(true);
  });
});
