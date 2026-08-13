import { describe, expect, it } from 'vitest';

import type { TripPlan } from '@travel-guide/shared-types';
import { TripPlanSchema } from '@travel-guide/shared-schemas';

import { RequestError } from '../services/request-error';
import {
  applyLatestTripPlanResult,
  applyTripPlanDiffResult,
  applyTripPlanVersionRestoreResult,
  applyTripPlanDayRegenerationResult,
  applyTripPlanEditResult,
  applyTripPlanItemReorderDraft,
  applyTripPlanReorderResult,
  applyTripPlanViewError,
  applyTripPlanVersionResult,
  beginTripPlanDayRegeneration,
  beginTripPlanEdit,
  beginTripPlanDiff,
  beginTripPlanVersionRestore,
  beginTripPlanItemReorder,
  beginTripPlanOptimization,
  applyTripPlanOptimizationResult,
  applyTripPlanOptimizationAuditResult,
  beginTripPlanOptimizationAudit,
  createTripPlanDisplayModel,
  createTripPlanOptimizationAuditDisplayModel,
  createTripPlanViewState,
  createTripPlanViewStateRegistry,
  formatTripPlanRoute,
  formatTripPlanWeather,
  getVisibleTripPlanVersions,
  getReadyTripPlanVersions,
  getTripPlanOptimizationEndpointOptions,
  isTripPlanOptimizationConfirmationAccepted,
  isTripPlanReorderConfirmationAccepted,
  moveTripPlanItemInOrder,
  restoreTripPlanItemReorderDraft,
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

const draftFirstId = '423e4567-e89b-12d3-a456-426614174000';
const draftSecondId = '523e4567-e89b-12d3-a456-426614174000';
const reorderDraftPlan: TripPlan = {
  ...plan,
  days: [
    {
      ...plan.days[0],
      items: [
        {
          id: draftFirstId,
          type: 'rest',
          startTime: '09:00',
          endTime: '10:00',
          name: '一',
          description: '一',
          recommendationReason: '一',
          estimatedCostCny: 1,
          tips: [],
          dataSources: ['ai_generated'],
        },
        {
          id: draftSecondId,
          type: 'rest',
          startTime: '10:30',
          endTime: '11:30',
          name: '二',
          description: '二',
          recommendationReason: '二',
          estimatedCostCny: 2,
          tips: [],
          dataSources: ['ai_generated'],
        },
      ],
      estimatedCostCny: 3,
    },
  ],
  budget: {
    ...plan.budget,
    totalCny: 3,
    otherCny: 3,
  },
};

describe('TripPlan view adapters', () => {
  it('handles reorder boundaries and keeps cancellation from opening the save gate', () => {
    const first = '423e4567-e89b-12d3-a456-426614174000';
    const second = '523e4567-e89b-12d3-a456-426614174000';
    const third = '623e4567-e89b-12d3-a456-426614174000';
    expect(moveTripPlanItemInOrder([first, second, third], first, 'up')).toBeUndefined();
    expect(moveTripPlanItemInOrder([first, second, third], third, 'down')).toBeUndefined();
    expect(moveTripPlanItemInOrder([first, second, third], second, 'up')).toEqual([
      second,
      first,
      third,
    ]);
    expect(moveTripPlanItemInOrder([first, second, third], second, 'down')).toEqual([
      first,
      third,
      second,
    ]);
    expect(isTripPlanReorderConfirmationAccepted({ confirm: false })).toBe(false);
    expect(isTripPlanReorderConfirmationAccepted({ cancel: true })).toBe(false);
    expect(isTripPlanReorderConfirmationAccepted({ confirm: true })).toBe(true);
    expect(isTripPlanOptimizationConfirmationAccepted({ cancel: true })).toBe(false);
    expect(isTripPlanOptimizationConfirmationAccepted({ confirm: true })).toBe(true);
  });

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

  it('exposes only labels for concrete-place optimization picker choices', () => {
    const options = getTripPlanOptimizationEndpointOptions(
      createTripPlanDisplayModel(plan).days[0]!,
    );
    expect(options).toEqual([{ id: '', label: '不固定' }]);
    expect(options.map((item) => item.label)).not.toContain(draftFirstId);

    const concrete = TripPlanSchema.parse({
      ...reorderDraftPlan,
      days: [
        {
          ...reorderDraftPlan.days[0],
          items: [
            {
              ...reorderDraftPlan.days[0]!.items[0]!,
              type: 'attraction',
              place: {
                id: '623e4567-e89b-12d3-a456-426614174000',
                provider: 'fake-map',
                providerPlaceId: 'place-1',
                name: '西湖',
                category: 'attraction',
                categoryText: '景点',
                address: '杭州',
                location: { longitude: 120.15, latitude: 30.25 },
                verifiedAt: generatedAt,
                dataSource: 'cache',
              },
              dataSources: ['map_provider'],
            },
            reorderDraftPlan.days[0]!.items[1]!,
          ],
        },
      ],
      budget: { ...reorderDraftPlan.budget, attractionsCny: 1, otherCny: 2 },
    });
    expect(
      getTripPlanOptimizationEndpointOptions(createTripPlanDisplayModel(concrete).days[0]!),
    ).toEqual([
      { id: '', label: '不固定' },
      { id: draftFirstId, label: '一' },
    ]);
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

  it('single-flights reorder and switches only after a ready result', () => {
    const state = applyLatestTripPlanResult(createTripPlanViewState(tripId), {
      items: [readySummary],
      latestVersion: 1,
      plan,
    });
    const loading = beginTripPlanItemReorder(state, '1:223e4567-e89b-12d3-a456-426614174000');
    expect(loading.reorderingItem).toContain('1:');
    expect(beginTripPlanItemReorder(loading, '1:other')).toBe(loading);
    const nextSummary = {
      ...readySummary,
      id: '323e4567-e89b-12d3-a456-426614174000',
      version: 2,
    };
    const switched = applyTripPlanReorderResult(loading, {
      tripId,
      sourceVersion: 1,
      dayNumber: 1,
      version: 2,
      status: 'ready',
      plan,
      summary: nextSummary,
    });
    expect(switched.selectedVersion).toBe(2);
    expect(switched.reorderingItem).toBeUndefined();
    expect(applyTripPlanViewError(loading, '调整失败').plan).toEqual(plan);
  });

  it('keeps reorder moves local, supports restore, and preserves the draft after save failure', () => {
    const state = applyLatestTripPlanResult(createTripPlanViewState(tripId), {
      items: [readySummary],
      latestVersion: 1,
      plan: reorderDraftPlan,
    });
    const moved = applyTripPlanItemReorderDraft(state, 1, [draftSecondId, draftFirstId]);
    expect(moved.reorderDrafts['1']).toEqual([draftSecondId, draftFirstId]);
    expect(moved.plan?.days[0]?.items.map((item) => item.id)).toEqual([
      draftFirstId,
      draftSecondId,
    ]);
    const saving = beginTripPlanItemReorder(moved, '1:save');
    const failed = applyTripPlanViewError(saving, '保存失败');
    expect(failed.reorderingItem).toBeUndefined();
    expect(failed.reorderDrafts['1']).toEqual([draftSecondId, draftFirstId]);
    const restored = restoreTripPlanItemReorderDraft(failed, 1);
    expect(restored.reorderDrafts).toEqual({});
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

  it('guards optimization with confirmation state and switches only on a ready result', () => {
    const state = applyLatestTripPlanResult(createTripPlanViewState(tripId), {
      items: [readySummary],
      latestVersion: 1,
      plan,
    });
    const loading = beginTripPlanOptimization(state, 1);
    expect(loading.optimizingDay).toBe(1);
    expect(beginTripPlanOptimization(loading, 1)).toBe(loading);
    const optimized = applyTripPlanOptimizationResult(loading, {
      tripId,
      sourceVersion: 1,
      version: 2,
      dayNumber: 1,
      status: 'ready',
      plan,
      summary: { ...readySummary, version: 2, id: '723e4567-e89b-12d3-a456-426614174000' },
    });
    expect(optimized.selectedVersion).toBe(2);
    expect(optimized.optimizingDay).toBeUndefined();
    expect(applyTripPlanViewError(loading, '优化失败').plan).toEqual(plan);
  });

  it('single-flights audit loading and keeps the current plan on failure', () => {
    const state = applyLatestTripPlanResult(createTripPlanViewState(tripId), {
      items: [readySummary],
      latestVersion: 1,
      plan,
    });
    const loading = beginTripPlanOptimizationAudit(state, 1);
    expect(loading.isAuditLoading).toBe(true);
    expect(beginTripPlanOptimizationAudit(loading, 1)).toBe(loading);
    const audit = applyTripPlanOptimizationAuditResult(loading, {
      tripId,
      version: 1,
      sourceVersion: 2,
      dayNumber: 1,
      mode: 'walking',
      algorithm: 'nearest_neighbor',
      isOptimal: false,
      orderedItemIds: [draftFirstId],
      decisions: [],
      timelineChanges: [
        {
          itemId: draftFirstId,
          previousStartTime: '09:00',
          previousEndTime: '10:00',
          nextStartTime: '09:00',
          nextEndTime: '10:00',
          routeStatus: 'not_applicable',
        },
      ],
      warnings: ['Nearest-neighbor is deterministic but not globally optimal.'],
      generatedAt,
    });
    expect(audit.audit?.algorithm).toBe('nearest_neighbor');
    expect(audit.isAuditLoading).toBe(false);
    expect(applyTripPlanViewError(loading, '依据不可用').plan).toEqual(plan);
  });

  it('projects audit UUIDs to stable item labels for the read-only page', () => {
    const projected = createTripPlanOptimizationAuditDisplayModel(
      {
        tripId,
        version: 2,
        sourceVersion: 1,
        dayNumber: 1,
        mode: 'walking',
        algorithm: 'nearest_neighbor',
        isOptimal: false,
        fixedStartItemId: draftFirstId,
        orderedItemIds: [draftFirstId],
        decisions: [],
        timelineChanges: [
          {
            itemId: draftFirstId,
            previousStartTime: '09:00',
            previousEndTime: '10:00',
            nextStartTime: '09:00',
            nextEndTime: '10:00',
            routeStatus: 'not_applicable',
          },
        ],
        warnings: ['Nearest-neighbor is deterministic but not globally optimal.'],
        generatedAt,
      },
      plan,
    );
    expect(projected.timelineChanges[0]?.itemLabel).toBe('未知条目');
    expect(projected.fixedStartLabel).toBe('未知条目');
    expect(JSON.stringify(projected)).not.toContain(draftFirstId);
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
