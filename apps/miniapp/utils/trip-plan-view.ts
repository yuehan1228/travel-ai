import {
  TripIdSchema,
  EditTripPlanResultSchema,
  TripPlanGenerationResultSchema,
  RegenerateTripPlanDayResultSchema,
  ReplaceTripPlanItemResultSchema,
  RestoreTripPlanVersionResultSchema,
  TripPlanSchema,
  TripPlanVersionDiffResultSchema,
  ReorderTripPlanItemsResultSchema,
  OptimizeTripPlanDayResultSchema,
  TripPlanVersionListResultSchema,
  TripPlanOptimizationAuditResultSchema,
} from '@travel-guide/shared-schemas';
import type {
  DailyWeather,
  EditTripPlanInput,
  EditTripPlanResult,
  FoodRecommendation,
  HotelAreaRecommendation,
  Place,
  RouteEstimate,
  TripPlan,
  TripPlanGenerationResult,
  RegenerateTripPlanDayResult,
  ReplaceTripPlanItemResult,
  RestoreTripPlanVersionResult,
  TripPlanItem,
  TripPlanItemType,
  TripPlanVersionListResult,
  TripPlanVersionSummary,
  TripPlanVersionDiffResult,
  ReorderTripPlanItemsResult,
  OptimizeTripPlanDayResult,
  TripPlanOptimizationAuditResult,
} from '@travel-guide/shared-types';
import { z } from 'zod';

import { RequestError } from '../services/request-error';
import { MINIAPP_ROUTES } from '../config/routes';

export const MAX_VISIBLE_TRIP_PLAN_VERSIONS = 100;

const tripPlanVersionParamSchema = z
  .string()
  .regex(/^\d+$/, { message: 'version must be an integer' })
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647, {
    message: 'version is out of range',
  });

export const TripPlanRouteParamsSchema = z
  .object({
    tripId: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
  })
  .strict();

export interface TripPlanRouteParams {
  readonly tripId: string;
  readonly version?: number;
}

const invalidTripPlanResponse = (): RequestError =>
  new RequestError({
    code: 'INVALID_RESPONSE',
    message: '攻略数据暂时无法识别',
  });

/** Parse and validate WeChat query parameters before any authenticated request. */
export const parseTripPlanRouteParams = (value: unknown): TripPlanRouteParams => {
  const parsed = TripPlanRouteParamsSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidTripPlanResponse();
  }

  const tripId = TripIdSchema.safeParse(parsed.data.tripId);
  if (!tripId.success) {
    throw invalidTripPlanResponse();
  }

  if (parsed.data.version === undefined) {
    return { tripId: tripId.data };
  }

  const version = tripPlanVersionParamSchema.safeParse(parsed.data.version);
  if (!version.success) {
    throw invalidTripPlanResponse();
  }

  return { tripId: tripId.data, version: version.data };
};

export const buildTripGeneratingUrl = (tripId: string): string => {
  const parsedTripId = TripIdSchema.parse(tripId);
  return `${MINIAPP_ROUTES.tripGenerating}?tripId=${encodeURIComponent(parsedTripId)}`;
};

export const buildTripPlanUrl = (tripId: string, version?: number): string => {
  const parsedTripId = TripIdSchema.parse(tripId);
  if (version === undefined) {
    return `${MINIAPP_ROUTES.tripPlan}?tripId=${encodeURIComponent(parsedTripId)}`;
  }

  const parsedVersion = tripPlanVersionParamSchema.parse(String(version));
  return `${MINIAPP_ROUTES.tripPlan}?tripId=${encodeURIComponent(parsedTripId)}&version=${parsedVersion}`;
};

export type TripPlanViewStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface TripPlanViewState {
  readonly tripId: string;
  readonly status: TripPlanViewStatus;
  readonly plan?: TripPlan;
  readonly allVersions: TripPlanVersionSummary[];
  readonly readyVersions: TripPlanVersionSummary[];
  readonly latestVersion?: number;
  readonly selectedVersion?: number;
  readonly isSwitching: boolean;
  readonly regeneratingDay?: number;
  readonly optimizingDay?: number;
  readonly replacingItem?: string;
  readonly reorderingItem?: string;
  /** Local item-id permutations awaiting an explicit save. */
  readonly reorderDrafts: Readonly<Record<string, string[]>>;
  readonly errorMessage: string;
  readonly diff?: TripPlanVersionDiffResult;
  readonly diffFromVersion?: number;
  readonly diffToVersion?: number;
  readonly isDiffLoading: boolean;
  readonly restoringVersion?: number;
  readonly isEditing: boolean;
  readonly editInput?: EditTripPlanInput;
  readonly audit?: TripPlanOptimizationAuditResult;
  readonly auditDayNumber?: number;
  readonly isAuditLoading: boolean;
}

export interface TripPlanOptimizationAuditCandidateDisplay {
  readonly destinationLabel: string;
  readonly status: TripPlanOptimizationAuditResult['decisions'][number]['candidates'][number]['status'];
  readonly durationSeconds?: number;
  readonly distanceMeters?: number;
  readonly rejectionReason?: string;
}

export interface TripPlanOptimizationAuditDecisionDisplay {
  readonly step: number;
  readonly originLabel: string;
  readonly selectedDestinationLabel: string;
  readonly reason: TripPlanOptimizationAuditResult['decisions'][number]['reason'];
  readonly candidates: TripPlanOptimizationAuditCandidateDisplay[];
}

export interface TripPlanOptimizationAuditTimelineDisplay {
  readonly itemLabel: string;
  readonly previousStartTime: string;
  readonly previousEndTime: string;
  readonly nextStartTime: string;
  readonly nextEndTime: string;
  readonly routeStatus: TripPlanOptimizationAuditResult['timelineChanges'][number]['routeStatus'];
  readonly routeDurationSeconds?: number;
  readonly routeDistanceMeters?: number;
}

/** User-facing audit projection; internal UUIDs never cross into the WXML layer. */
export interface TripPlanOptimizationAuditDisplayModel {
  readonly dayNumber: number;
  readonly mode: TripPlanOptimizationAuditResult['mode'];
  readonly algorithm: TripPlanOptimizationAuditResult['algorithm'];
  readonly fixedStartLabel?: string;
  readonly fixedEndLabel?: string;
  readonly decisions: TripPlanOptimizationAuditDecisionDisplay[];
  readonly timelineChanges: TripPlanOptimizationAuditTimelineDisplay[];
  readonly warnings: string[];
}

export const createTripPlanOptimizationAuditDisplayModel = (
  audit: TripPlanOptimizationAuditResult,
  plan: TripPlan | undefined,
): TripPlanOptimizationAuditDisplayModel => {
  const nameById = new Map(
    plan?.days.flatMap((day) => day.items).map((item) => [item.id, item.name]) ?? [],
  );
  const label = (itemId: string): string => nameById.get(itemId) ?? '未知条目';
  return {
    dayNumber: audit.dayNumber,
    mode: audit.mode,
    algorithm: audit.algorithm,
    ...(audit.fixedStartItemId === undefined
      ? {}
      : { fixedStartLabel: label(audit.fixedStartItemId) }),
    ...(audit.fixedEndItemId === undefined ? {} : { fixedEndLabel: label(audit.fixedEndItemId) }),
    decisions: audit.decisions.map((decision) => ({
      step: decision.step,
      originLabel: label(decision.originItemId),
      selectedDestinationLabel: label(decision.selectedDestinationItemId),
      reason: decision.reason,
      candidates: decision.candidates.map((candidate) => ({
        destinationLabel: label(candidate.destinationItemId),
        status: candidate.status,
        ...(candidate.durationSeconds === undefined
          ? {}
          : { durationSeconds: candidate.durationSeconds }),
        ...(candidate.distanceMeters === undefined
          ? {}
          : { distanceMeters: candidate.distanceMeters }),
        ...(candidate.rejectionReason === undefined
          ? {}
          : { rejectionReason: candidate.rejectionReason }),
      })),
    })),
    timelineChanges: audit.timelineChanges.map((change) => ({
      itemLabel: label(change.itemId),
      previousStartTime: change.previousStartTime,
      previousEndTime: change.previousEndTime,
      nextStartTime: change.nextStartTime,
      nextEndTime: change.nextEndTime,
      routeStatus: change.routeStatus,
      ...(change.routeDurationSeconds === undefined
        ? {}
        : { routeDurationSeconds: change.routeDurationSeconds }),
      ...(change.routeDistanceMeters === undefined
        ? {}
        : { routeDistanceMeters: change.routeDistanceMeters }),
    })),
    warnings: [...audit.warnings],
  };
};

export interface TripPlanViewStateRegistry<TPage extends object> {
  get(page: TPage): TripPlanViewState | undefined;
  has(page: TPage): boolean;
  set(page: TPage, state: TripPlanViewState): void;
  delete(page: TPage): void;
}

export const createTripPlanViewStateRegistry = <
  TPage extends object,
>(): TripPlanViewStateRegistry<TPage> => {
  const states = new WeakMap<TPage, TripPlanViewState>();
  return {
    get: (page) => states.get(page),
    has: (page) => states.has(page),
    set: (page, state) => states.set(page, state),
    delete: (page) => {
      states.delete(page);
    },
  };
};

export const createTripPlanViewState = (tripId: string): TripPlanViewState => ({
  tripId,
  status: 'idle',
  allVersions: [],
  readyVersions: [],
  isSwitching: false,
  regeneratingDay: undefined,
  optimizingDay: undefined,
  replacingItem: undefined,
  reorderingItem: undefined,
  reorderDrafts: {},
  errorMessage: '',
  isDiffLoading: false,
  restoringVersion: undefined,
  isEditing: false,
  editInput: undefined,
  audit: undefined,
  auditDayNumber: undefined,
  isAuditLoading: false,
});

export const getVisibleTripPlanVersions = (
  versions: readonly TripPlanVersionSummary[],
): TripPlanVersionSummary[] => versions.slice(0, MAX_VISIBLE_TRIP_PLAN_VERSIONS);

export const getReadyTripPlanVersions = (
  versions: readonly TripPlanVersionSummary[],
): TripPlanVersionSummary[] =>
  getVisibleTripPlanVersions(versions).filter((version) => version.status === 'ready');

export const parseLatestTripPlanResult = (value: unknown): TripPlanVersionListResult => {
  const parsed = TripPlanVersionListResultSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidTripPlanResponse();
  }

  if (parsed.data.plan !== undefined) {
    const parsedPlan = TripPlanSchema.safeParse(parsed.data.plan);
    if (!parsedPlan.success) {
      throw invalidTripPlanResponse();
    }
  }

  return parsed.data;
};

export const parseTripPlanVersionResult = (value: unknown): TripPlanGenerationResult => {
  const parsed = TripPlanGenerationResultSchema.safeParse(value);
  if (!parsed.success || (parsed.data.status === 'ready' && parsed.data.plan === undefined)) {
    throw invalidTripPlanResponse();
  }

  return parsed.data;
};

export const parseTripPlanDayRegenerationResult = (value: unknown): RegenerateTripPlanDayResult => {
  const parsed = RegenerateTripPlanDayResultSchema.safeParse(value);
  if (!parsed.success || (parsed.data.status === 'ready' && parsed.data.plan === undefined)) {
    throw invalidTripPlanResponse();
  }

  return parsed.data;
};

export const parseTripPlanItemReplacementResult = (value: unknown): ReplaceTripPlanItemResult => {
  const parsed = ReplaceTripPlanItemResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.status !== 'ready') throw invalidTripPlanResponse();
  return parsed.data;
};

export const parseTripPlanDiffResult = (value: unknown): TripPlanVersionDiffResult => {
  const parsed = TripPlanVersionDiffResultSchema.safeParse(value);
  if (!parsed.success) throw invalidTripPlanResponse();
  return parsed.data;
};

export const parseTripPlanRestoreResult = (value: unknown): RestoreTripPlanVersionResult => {
  const parsed = RestoreTripPlanVersionResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.status !== 'ready') throw invalidTripPlanResponse();
  return parsed.data;
};

export const parseTripPlanEditResult = (value: unknown): EditTripPlanResult => {
  const parsed = EditTripPlanResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.status !== 'ready') throw invalidTripPlanResponse();
  return parsed.data;
};

export const parseTripPlanReorderResult = (value: unknown): ReorderTripPlanItemsResult => {
  const parsed = ReorderTripPlanItemsResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.status !== 'ready') throw invalidTripPlanResponse();
  return parsed.data;
};

export const parseTripPlanOptimizeResult = (value: unknown): OptimizeTripPlanDayResult => {
  const parsed = OptimizeTripPlanDayResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.status !== 'ready') throw invalidTripPlanResponse();
  return parsed.data;
};

export const parseTripPlanOptimizationAuditResult = (
  value: unknown,
): TripPlanOptimizationAuditResult => {
  const parsed = TripPlanOptimizationAuditResultSchema.safeParse(value);
  if (!parsed.success) throw invalidTripPlanResponse();
  return parsed.data;
};

export const beginTripPlanOptimizationAudit = (
  state: TripPlanViewState,
  dayNumber: number,
): TripPlanViewState =>
  state.isAuditLoading ||
  state.isSwitching ||
  state.regeneratingDay !== undefined ||
  state.optimizingDay !== undefined ||
  state.replacingItem !== undefined ||
  state.reorderingItem !== undefined ||
  state.isEditing ||
  state.isDiffLoading ||
  state.restoringVersion !== undefined ||
  state.status !== 'ready' ||
  !Number.isSafeInteger(dayNumber) ||
  dayNumber < 1 ||
  dayNumber > 14
    ? state
    : { ...state, isAuditLoading: true, auditDayNumber: dayNumber, errorMessage: '' };

export const applyTripPlanOptimizationAuditResult = (
  state: TripPlanViewState,
  result: TripPlanOptimizationAuditResult,
): TripPlanViewState => {
  const parsed = parseTripPlanOptimizationAuditResult(result);
  if (
    parsed.tripId !== state.tripId ||
    (state.selectedVersion !== undefined && parsed.version !== state.selectedVersion)
  ) {
    throw invalidTripPlanResponse();
  }
  return {
    ...state,
    audit: parsed,
    auditDayNumber: parsed.dayNumber,
    isAuditLoading: false,
    errorMessage: '',
  };
};

export const beginTripPlanOptimization = (
  state: TripPlanViewState,
  dayNumber: number,
): TripPlanViewState =>
  state.optimizingDay === undefined &&
  state.regeneratingDay === undefined &&
  state.replacingItem === undefined &&
  state.reorderingItem === undefined &&
  !state.isEditing &&
  !state.isSwitching &&
  state.status === 'ready' &&
  Number.isSafeInteger(dayNumber) &&
  dayNumber >= 1 &&
  dayNumber <= 14
    ? { ...state, optimizingDay: dayNumber, errorMessage: '' }
    : state;

export const applyTripPlanOptimizationResult = (
  state: TripPlanViewState,
  result: OptimizeTripPlanDayResult,
): TripPlanViewState => {
  const parsed = parseTripPlanOptimizeResult(result);
  if (parsed.tripId !== state.tripId) throw invalidTripPlanResponse();
  const allVersions = getVisibleTripPlanVersions([
    parsed.summary,
    ...state.allVersions.filter((item) => item.version !== parsed.version),
  ]);
  return {
    ...state,
    status: 'ready',
    plan: parsed.plan,
    allVersions,
    readyVersions: getReadyTripPlanVersions(allVersions),
    latestVersion: parsed.version,
    selectedVersion: parsed.version,
    isSwitching: false,
    optimizingDay: undefined,
    regeneratingDay: undefined,
    replacingItem: undefined,
    reorderingItem: undefined,
    reorderDrafts: {},
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
    restoringVersion: undefined,
    audit: undefined,
    auditDayNumber: undefined,
    isAuditLoading: false,
    errorMessage: '',
  };
};

export const beginTripPlanItemReorder = (
  state: TripPlanViewState,
  itemKey: string,
): TripPlanViewState =>
  state.reorderingItem === undefined &&
  state.regeneratingDay === undefined &&
  state.replacingItem === undefined &&
  !state.isEditing &&
  !state.isSwitching &&
  state.status === 'ready' &&
  itemKey.length > 0
    ? { ...state, reorderingItem: itemKey, errorMessage: '' }
    : state;

const reorderDraftKey = (dayNumber: number): string => String(dayNumber);

/** Apply only a local permutation; the immutable ready plan remains untouched. */
export const applyTripPlanItemReorderDraft = (
  state: TripPlanViewState,
  dayNumber: number,
  orderedItemIds: readonly string[],
): TripPlanViewState => {
  if (state.status !== 'ready' || state.plan === undefined || state.reorderingItem !== undefined) {
    return state;
  }
  const day = state.plan.days.find((candidate) => candidate.dayNumber === dayNumber);
  if (day === undefined) return state;
  const sourceIds = day.items.map((item) => item.id);
  if (
    sourceIds.length !== orderedItemIds.length ||
    new Set(orderedItemIds).size !== orderedItemIds.length ||
    sourceIds.some((itemId) => !orderedItemIds.includes(itemId))
  ) {
    return state;
  }
  if (sourceIds.every((itemId, index) => itemId === orderedItemIds[index])) {
    const rest = { ...state.reorderDrafts };
    delete rest[reorderDraftKey(dayNumber)];
    return { ...state, reorderDrafts: rest };
  }
  return {
    ...state,
    reorderDrafts: {
      ...state.reorderDrafts,
      [reorderDraftKey(dayNumber)]: [...orderedItemIds],
    },
    errorMessage: '',
  };
};

/** Restore one day's local order to the immutable ready snapshot. */
export const restoreTripPlanItemReorderDraft = (
  state: TripPlanViewState,
  dayNumber: number,
): TripPlanViewState => {
  const key = reorderDraftKey(dayNumber);
  if (!(key in state.reorderDrafts) || state.reorderingItem !== undefined) return state;
  const rest = { ...state.reorderDrafts };
  delete rest[key];
  return { ...state, reorderDrafts: rest, errorMessage: '' };
};

export const hasTripPlanReorderDraft = (state: TripPlanViewState, dayNumber?: number): boolean =>
  dayNumber === undefined
    ? Object.keys(state.reorderDrafts).length > 0
    : Object.prototype.hasOwnProperty.call(state.reorderDrafts, reorderDraftKey(dayNumber));

/** Swap one item in a local order draft; boundary moves are deterministic no-ops. */
export const moveTripPlanItemInOrder = (
  orderedItemIds: readonly string[],
  itemId: string,
  direction: 'up' | 'down',
): string[] | undefined => {
  const index = orderedItemIds.indexOf(itemId);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= orderedItemIds.length) return undefined;
  const next = [...orderedItemIds];
  next[index] = next[targetIndex]!;
  next[targetIndex] = itemId;
  return next;
};

/** Pure confirmation gate used before a reorder request is allowed to start. */
export const isTripPlanReorderConfirmationAccepted = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'confirm' in value && value.confirm === true;

/** Pure confirmation gate used before an automatic optimization request starts. */
export const isTripPlanOptimizationConfirmationAccepted = isTripPlanReorderConfirmationAccepted;

export const applyTripPlanReorderResult = (
  state: TripPlanViewState,
  result: ReorderTripPlanItemsResult,
): TripPlanViewState => {
  const parsed = parseTripPlanReorderResult(result);
  if (parsed.tripId !== state.tripId) throw invalidTripPlanResponse();
  const allVersions = getVisibleTripPlanVersions([
    parsed.summary,
    ...state.allVersions.filter((item) => item.version !== parsed.version),
  ]);
  return {
    ...state,
    status: 'ready',
    plan: parsed.plan,
    allVersions,
    readyVersions: getReadyTripPlanVersions(allVersions),
    latestVersion: parsed.version,
    selectedVersion: parsed.version,
    isSwitching: false,
    regeneratingDay: undefined,
    optimizingDay: undefined,
    replacingItem: undefined,
    reorderingItem: undefined,
    reorderDrafts: {},
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
    restoringVersion: undefined,
    audit: undefined,
    auditDayNumber: undefined,
    isAuditLoading: false,
    errorMessage: '',
  };
};

export const beginTripPlanLoad = (state: TripPlanViewState): TripPlanViewState => ({
  ...state,
  status: 'loading',
  isSwitching: false,
  regeneratingDay: undefined,
  optimizingDay: undefined,
  replacingItem: undefined,
  reorderingItem: undefined,
  reorderDrafts: {},
  errorMessage: '',
  isDiffLoading: false,
  restoringVersion: undefined,
  audit: undefined,
  auditDayNumber: undefined,
  isAuditLoading: false,
});

export const beginTripPlanVersionSwitch = (state: TripPlanViewState): TripPlanViewState =>
  state.isEditing || hasTripPlanReorderDraft(state)
    ? state
    : {
        ...state,
        isSwitching: true,
        regeneratingDay: undefined,
        optimizingDay: undefined,
        replacingItem: undefined,
        reorderingItem: undefined,
        reorderDrafts: {},
        audit: undefined,
        auditDayNumber: undefined,
        isAuditLoading: false,
        errorMessage: '',
      };

export const beginTripPlanDiff = (
  state: TripPlanViewState,
  fromVersion: number,
  toVersion: number,
): TripPlanViewState => {
  if (
    state.isDiffLoading ||
    state.isEditing ||
    state.isSwitching ||
    state.restoringVersion !== undefined ||
    hasTripPlanReorderDraft(state) ||
    !Number.isSafeInteger(fromVersion) ||
    !Number.isSafeInteger(toVersion) ||
    fromVersion < 1 ||
    toVersion < 1 ||
    fromVersion === toVersion
  ) {
    return state;
  }
  return {
    ...state,
    diffFromVersion: fromVersion,
    diffToVersion: toVersion,
    isDiffLoading: true,
    errorMessage: '',
  };
};

export const applyTripPlanDiffResult = (
  state: TripPlanViewState,
  result: TripPlanVersionDiffResult,
): TripPlanViewState => {
  const parsed = parseTripPlanDiffResult(result);
  if (parsed.tripId !== state.tripId) throw invalidTripPlanResponse();
  return {
    ...state,
    diff: parsed,
    diffFromVersion: parsed.fromVersion,
    diffToVersion: parsed.toVersion,
    isDiffLoading: false,
    errorMessage: '',
  };
};

export const beginTripPlanVersionRestore = (
  state: TripPlanViewState,
  version: number,
): TripPlanViewState => {
  if (
    state.restoringVersion !== undefined ||
    state.isEditing ||
    hasTripPlanReorderDraft(state) ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version === state.selectedVersion
  ) {
    return state;
  }
  return { ...state, restoringVersion: version, errorMessage: '' };
};

export const applyTripPlanVersionRestoreResult = (
  state: TripPlanViewState,
  result: RestoreTripPlanVersionResult,
): TripPlanViewState => {
  const parsed = parseTripPlanRestoreResult(result);
  if (parsed.tripId !== state.tripId) throw invalidTripPlanResponse();
  const allVersions = getVisibleTripPlanVersions([
    parsed.summary,
    ...state.allVersions.filter((item) => item.version !== parsed.version),
  ]);
  return {
    ...state,
    status: 'ready',
    plan: parsed.plan,
    allVersions,
    readyVersions: getReadyTripPlanVersions(allVersions),
    latestVersion: parsed.version,
    selectedVersion: parsed.version,
    isSwitching: false,
    optimizingDay: undefined,
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
    restoringVersion: undefined,
    replacingItem: undefined,
    reorderingItem: undefined,
    reorderDrafts: {},
    errorMessage: '',
  };
};

export const beginTripPlanEdit = (
  state: TripPlanViewState,
  input: EditTripPlanInput,
): TripPlanViewState => {
  if (
    state.isEditing ||
    state.isSwitching ||
    state.restoringVersion !== undefined ||
    state.regeneratingDay !== undefined ||
    state.optimizingDay !== undefined ||
    hasTripPlanReorderDraft(state) ||
    state.status !== 'ready' ||
    state.selectedVersion !== input.sourceVersion
  ) {
    return state;
  }
  return { ...state, isEditing: true, editInput: input, errorMessage: '' };
};

export const applyTripPlanEditResult = (
  state: TripPlanViewState,
  result: EditTripPlanResult,
): TripPlanViewState => {
  const parsed = parseTripPlanEditResult(result);
  if (parsed.tripId !== state.tripId) throw invalidTripPlanResponse();
  const allVersions = getVisibleTripPlanVersions([
    parsed.summary,
    ...state.allVersions.filter((item) => item.version !== parsed.version),
  ]);
  return {
    ...state,
    status: 'ready',
    plan: parsed.plan,
    allVersions,
    readyVersions: getReadyTripPlanVersions(allVersions),
    latestVersion: parsed.version,
    selectedVersion: parsed.version,
    isSwitching: false,
    regeneratingDay: undefined,
    optimizingDay: undefined,
    replacingItem: undefined,
    isEditing: false,
    editInput: undefined,
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
    restoringVersion: undefined,
    reorderDrafts: {},
    audit: undefined,
    auditDayNumber: undefined,
    isAuditLoading: false,
    errorMessage: '',
  };
};

export const beginTripPlanDayRegeneration = (
  state: TripPlanViewState,
  dayNumber: number,
): TripPlanViewState =>
  state.regeneratingDay === undefined &&
  !state.isEditing &&
  !hasTripPlanReorderDraft(state) &&
  Number.isSafeInteger(dayNumber) &&
  dayNumber >= 1 &&
  dayNumber <= 14
    ? {
        ...state,
        regeneratingDay: dayNumber,
        optimizingDay: undefined,
        replacingItem: undefined,
        reorderingItem: undefined,
        reorderDrafts: {},
        errorMessage: '',
      }
    : state;

export const applyLatestTripPlanResult = (
  state: TripPlanViewState,
  result: TripPlanVersionListResult,
): TripPlanViewState => {
  const parsed = parseLatestTripPlanResult(result);
  const allVersions = getVisibleTripPlanVersions(parsed.items);
  const readyVersions = getReadyTripPlanVersions(allVersions);
  const hasPlan = parsed.plan !== undefined && parsed.latestVersion !== undefined;
  return {
    ...state,
    status: hasPlan ? 'ready' : 'empty',
    plan: hasPlan ? parsed.plan : undefined,
    allVersions,
    readyVersions,
    latestVersion: parsed.latestVersion,
    selectedVersion: parsed.latestVersion,
    isSwitching: false,
    regeneratingDay: undefined,
    optimizingDay: undefined,
    replacingItem: undefined,
    reorderingItem: undefined,
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    errorMessage: hasPlan ? '' : '暂时没有可用攻略。',
    isDiffLoading: false,
    restoringVersion: undefined,
    reorderDrafts: {},
    audit: undefined,
    auditDayNumber: undefined,
    isAuditLoading: false,
  };
};

export const beginTripPlanItemReplacement = (
  state: TripPlanViewState,
  itemKey: string,
): TripPlanViewState =>
  state.regeneratingDay === undefined &&
  state.replacingItem === undefined &&
  state.reorderingItem === undefined &&
  !hasTripPlanReorderDraft(state) &&
  !state.isEditing &&
  !state.isSwitching &&
  state.status === 'ready' &&
  itemKey.length > 0
    ? { ...state, replacingItem: itemKey, errorMessage: '' }
    : state;

export const applyTripPlanItemReplacementResult = (
  state: TripPlanViewState,
  result: ReplaceTripPlanItemResult,
): TripPlanViewState => {
  const parsed = parseTripPlanItemReplacementResult(result);
  if (parsed.tripId !== state.tripId) throw invalidTripPlanResponse();
  const allVersions = getVisibleTripPlanVersions([
    parsed.summary,
    ...state.allVersions.filter((item) => item.version !== parsed.version),
  ]);
  return {
    ...state,
    status: 'ready',
    plan: parsed.plan,
    allVersions,
    readyVersions: getReadyTripPlanVersions(allVersions),
    latestVersion: parsed.version,
    selectedVersion: parsed.version,
    isSwitching: false,
    regeneratingDay: undefined,
    replacingItem: undefined,
    reorderingItem: undefined,
    reorderDrafts: {},
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
    restoringVersion: undefined,
    audit: undefined,
    auditDayNumber: undefined,
    isAuditLoading: false,
    errorMessage: '',
  };
};

/** Apply a version only after strict validation and only when it is ready. */
export const applyTripPlanVersionResult = (
  state: TripPlanViewState,
  result: TripPlanGenerationResult,
): TripPlanViewState => {
  const parsed = parseTripPlanVersionResult(result);
  if (parsed.status !== 'ready' || parsed.plan === undefined) {
    return {
      ...state,
      isSwitching: false,
      optimizingDay: undefined,
      errorMessage: '该版本尚未准备好，仍显示当前攻略。',
    };
  }

  return {
    ...state,
    status: 'ready',
    plan: parsed.plan,
    selectedVersion: parsed.version,
    isSwitching: false,
    regeneratingDay: undefined,
    optimizingDay: undefined,
    replacingItem: undefined,
    reorderingItem: undefined,
    reorderDrafts: {},
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
    audit: undefined,
    auditDayNumber: undefined,
    isAuditLoading: false,
    errorMessage: '',
  };
};

/** Apply a ready day replacement while keeping the complete new immutable plan. */
export const applyTripPlanDayRegenerationResult = (
  state: TripPlanViewState,
  result: RegenerateTripPlanDayResult,
): TripPlanViewState => {
  const parsed = parseTripPlanDayRegenerationResult(result);
  if (parsed.status !== 'ready' || parsed.plan === undefined) {
    return {
      ...state,
      regeneratingDay: undefined,
      optimizingDay: undefined,
      errorMessage: '本日攻略尚未准备好，仍显示当前攻略。',
    };
  }
  const allVersions = getVisibleTripPlanVersions([
    parsed.summary,
    ...state.allVersions.filter((item) => item.version !== parsed.version),
  ]);
  return {
    ...state,
    status: 'ready',
    plan: parsed.plan,
    allVersions,
    readyVersions: getReadyTripPlanVersions(allVersions),
    latestVersion: parsed.version,
    selectedVersion: parsed.version,
    isSwitching: false,
    regeneratingDay: undefined,
    replacingItem: undefined,
    reorderingItem: undefined,
    reorderDrafts: {},
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
    audit: undefined,
    auditDayNumber: undefined,
    isAuditLoading: false,
    errorMessage: '',
  };
};

/** Errors intentionally retain the current plan to avoid a blank page after a failed switch. */
export const applyTripPlanViewError = (
  state: TripPlanViewState,
  errorMessage: string,
): TripPlanViewState => ({
  ...state,
  status: state.plan === undefined ? 'error' : 'ready',
  isSwitching: false,
  regeneratingDay: undefined,
  optimizingDay: undefined,
  replacingItem: undefined,
  reorderingItem: undefined,
  isDiffLoading: false,
  restoringVersion: undefined,
  isAuditLoading: false,
  errorMessage,
});

const errorCode = (error: unknown): string | undefined => {
  if (!(error instanceof RequestError)) {
    return undefined;
  }
  return error.apiCode ?? error.code;
};

/** Stable Chinese copy for the page; provider details and raw API messages stay hidden. */
export const getTripPlanUserMessage = (error: unknown): string => {
  switch (errorCode(error)) {
    case 'AUTH_TOKEN_INVALID':
      return '登录状态已失效，请重新登录。';
    case 'TRIP_NOT_FOUND':
      return '未找到该旅行需求，请返回重新开始。';
    case 'TRIP_PLAN_NOT_FOUND':
      return '暂时没有可用攻略。';
    case 'TRIP_PLAN_DAY_NOT_FOUND':
    case 'TRIP_PLAN_SOURCE_VERSION_NOT_READY':
      return '该版本或日期不可用，请重新加载攻略。';
    case 'TRIP_PLAN_GENERATION_IN_PROGRESS':
      return '攻略正在生成中，请稍候再试。';
    case 'TRIP_PLAN_DIFF_VALIDATION_ERROR':
      return '版本差异请求无效，请重新选择版本。';
    case 'TRIP_PLAN_VALIDATION_ERROR':
      return '攻略请求无效，请检查旅行需求。';
    case 'TRIP_PLAN_UNAVAILABLE':
      return '当前真实数据不足，暂时无法生成攻略。';
    case 'TRIP_PLAN_REPLACEMENT_UNAVAILABLE':
    case 'ROUTE_UNAVAILABLE':
      return '替换地点的真实路线暂时不可用，请稍后重试。';
    case 'TRIP_PLAN_REORDER_UNAVAILABLE':
      return '调整顺序所需的真实路线暂时不可用，请稍后重试。';
    case 'TRIP_PLAN_OPTIMIZE_UNAVAILABLE':
      return '自动优化所需的真实路线暂时不可用，请稍后重试。';
    case 'TRIP_PLAN_AUDIT_NOT_FOUND':
      return '该日期暂时没有可查看的优化依据。';
    case 'TRIP_PLAN_AUDIT_UNAVAILABLE':
      return '该版本未保存完整的路线优化依据，暂时无法回放。';
    case 'TRIP_PLAN_AUDIT_VALIDATION_ERROR':
      return '优化依据校验失败，请重新加载攻略。';
    case 'TRIP_PLAN_PROVIDER_ERROR':
    case 'TRIP_PLAN_OUTPUT_INVALID':
    case 'TRIP_PLAN_ENTITY_MISMATCH':
    case 'TRIP_PLAN_PERSISTENCE_ERROR':
      return '攻略生成暂时失败，请稍后重试。';
    case 'INVALID_RESPONSE':
      return '攻略数据暂时无法识别，请稍后重试。';
    case 'NETWORK_ERROR':
      return '暂时无法连接服务，请稍后重试。';
    case 'REQUEST_TIMEOUT':
      return '服务响应超时，请稍后重试。';
    default:
      return '攻略服务暂时不可用，请稍后重试。';
  }
};

export const TRIP_PLAN_ITEM_TYPE_LABELS: Record<TripPlanItemType, string> = {
  attraction: '景点',
  food: '餐饮',
  transport: '交通',
  hotel: '住宿',
  rest: '休息',
};

export const formatTripPlanMoney = (amount: number): string =>
  `¥${amount.toFixed(2).replace(/\.00$/, '')}`;

export interface WeatherPresentation {
  readonly sourceLabel: string;
  readonly conditionText: string;
  readonly temperatureText: string;
  readonly precipitationText: string;
  readonly notice?: string;
  readonly isReference: boolean;
  readonly isUnavailable: boolean;
}

export const formatTripPlanWeather = (weather: DailyWeather): WeatherPresentation => {
  if (weather.source === 'unavailable') {
    return {
      sourceLabel: '暂无可靠天气数据',
      conditionText: '天气信息暂缺',
      temperatureText: '',
      precipitationText: '',
      isReference: false,
      isUnavailable: true,
    };
  }

  const temperatures = [weather.minTemperatureC, weather.maxTemperatureC].filter(
    (value): value is number => value !== undefined,
  );
  const temperatureText =
    temperatures.length === 2
      ? `${temperatures[0]}～${temperatures[1]}℃`
      : temperatures.length === 1
        ? `${temperatures[0]}℃`
        : '';
  const precipitationText =
    weather.precipitationProbability === undefined
      ? ''
      : `降水概率 ${weather.precipitationProbability}%`;

  if (weather.source === 'climate_reference') {
    return {
      sourceLabel: '历史气候参考',
      conditionText: weather.conditionText,
      temperatureText,
      precipitationText,
      notice: '当前距离出行时间较远，以下天气为历史气候参考。',
      isReference: true,
      isUnavailable: false,
    };
  }

  return {
    sourceLabel: '天气预报',
    conditionText: weather.conditionText,
    temperatureText,
    precipitationText,
    isReference: false,
    isUnavailable: false,
  };
};

export interface RoutePresentation {
  readonly modeLabel: string;
  readonly sourceLabel: string;
  readonly distanceText: string;
  readonly durationText: string;
  readonly tollText: string;
  readonly isUnavailable: boolean;
}

const routeModeLabel = (mode: RouteEstimate['mode']): string =>
  mode === 'walking' ? '步行' : '驾车';

const routeSourceLabel = (source: RouteEstimate['dataSource']): string => {
  if (source === 'cache') return '已验证缓存';
  if (source === 'map_provider') return '地图服务';
  return '路线暂不可用';
};

export const formatTripPlanRoute = (
  route: RouteEstimate | undefined,
): RoutePresentation | undefined => {
  if (route === undefined) {
    return undefined;
  }

  if (route.dataSource === 'unavailable') {
    return {
      modeLabel: routeModeLabel(route.mode),
      sourceLabel: routeSourceLabel(route.dataSource),
      distanceText: '',
      durationText: '',
      tollText: '',
      isUnavailable: true,
    };
  }

  return {
    modeLabel: routeModeLabel(route.mode),
    sourceLabel: routeSourceLabel(route.dataSource),
    distanceText:
      route.distanceMeters >= 1_000
        ? `${(route.distanceMeters / 1_000).toFixed(1)} 公里`
        : `${route.distanceMeters} 米`,
    durationText: `${Math.max(1, Math.round(route.durationSeconds / 60))} 分钟`,
    tollText: route.tollsCny === undefined ? '' : `通行费 ${formatTripPlanMoney(route.tollsCny)}`,
    isUnavailable: false,
  };
};

export const isRenderableTripPlan = (plan: unknown): plan is TripPlan =>
  TripPlanSchema.safeParse(plan).success;

export const getTripPlanItemPlace = (item: TripPlanItem): TripPlanItem['place'] => item.place;

export interface TripPlanPlacePresentation {
  readonly name: string;
  readonly categoryText: string;
  readonly address: string;
  readonly ratingText: string;
  readonly openingHours: string;
}

const formatPlace = (place: Place | undefined): TripPlanPlacePresentation | undefined => {
  if (place === undefined) return undefined;
  return {
    name: place.name,
    categoryText: place.categoryText,
    address: place.address,
    ratingText: place.rating === undefined ? '' : `评分 ${place.rating.toFixed(1)}`,
    openingHours: place.openingHours ?? '',
  };
};

export interface TripPlanItemPresentation {
  readonly id: string;
  readonly typeLabel: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly name: string;
  readonly description: string;
  readonly recommendationReason: string;
  readonly estimatedCostText: string;
  readonly tips: string[];
  readonly place?: TripPlanPlacePresentation;
  readonly route?: RoutePresentation;
}

export interface TripPlanDayPresentation {
  readonly dayNumber: number;
  readonly date: string;
  readonly summary: string;
  readonly weather: WeatherPresentation;
  readonly items: TripPlanItemPresentation[];
  readonly estimatedCostText: string;
  readonly warnings: TripPlanWarningPresentation[];
}

export interface TripPlanOptimizationEndpointOption {
  readonly id: string;
  readonly label: string;
}

/** Build picker choices from concrete places while keeping internal IDs out of UI labels. */
export const getTripPlanOptimizationEndpointOptions = (
  day: TripPlanDayPresentation,
): TripPlanOptimizationEndpointOption[] => [
  { id: '', label: '不固定' },
  ...day.items
    .filter((item) => item.place !== undefined)
    .map((item) => ({ id: item.id, label: item.name })),
];

export interface TripPlanWarningPresentation {
  readonly severityLabel: string;
  readonly message: string;
}

export interface TripPlanRecommendationPresentation {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly recommendationReason: string;
  readonly cuisine: string;
  readonly place?: TripPlanPlacePresentation;
  readonly tips: string[];
}

export interface TripPlanBudgetRow {
  readonly label: string;
  readonly amountText: string;
}

export interface TripPlanDisplayModel {
  readonly tripId: string;
  readonly cityName: string;
  readonly dateRange: string;
  readonly travelerText: string;
  readonly generatedAt: string;
  readonly summary: string;
  readonly days: TripPlanDayPresentation[];
  readonly hotelRecommendations: TripPlanRecommendationPresentation[];
  readonly foodRecommendations: TripPlanRecommendationPresentation[];
  readonly budgetTotalText: string;
  readonly budgetRows: TripPlanBudgetRow[];
  readonly transportationTips: string[];
  readonly generalTips: string[];
}

const warningSeverityLabel = (severity: 'info' | 'warning'): string =>
  severity === 'warning' ? '提醒' : '提示';

const formatRecommendation = (
  recommendation: HotelAreaRecommendation | FoodRecommendation,
): TripPlanRecommendationPresentation => ({
  id: recommendation.id,
  name: 'areaName' in recommendation ? recommendation.areaName : recommendation.name,
  description: recommendation.description,
  recommendationReason: recommendation.recommendationReason,
  cuisine: 'cuisine' in recommendation ? (recommendation.cuisine ?? '') : '',
  place: formatPlace(recommendation.place),
  tips: recommendation.tips,
});

export const createTripPlanDisplayModel = (input: TripPlan): TripPlanDisplayModel => {
  const parsed = TripPlanSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidTripPlanResponse();
  }
  const plan = parsed.data;

  return {
    tripId: plan.tripId,
    cityName: plan.cityName,
    dateRange: `${plan.startDate} 至 ${plan.endDate}`,
    travelerText: `${plan.travelerCount} 人出行`,
    generatedAt: plan.generatedAt,
    summary: plan.summary,
    days: plan.days.map((day) => ({
      dayNumber: day.dayNumber,
      date: day.date,
      summary: day.summary,
      weather: formatTripPlanWeather(day.weather),
      items: day.items.map((item) => ({
        id: item.id,
        typeLabel: TRIP_PLAN_ITEM_TYPE_LABELS[item.type],
        startTime: item.startTime,
        endTime: item.endTime,
        name: item.name,
        description: item.description,
        recommendationReason: item.recommendationReason,
        estimatedCostText: formatTripPlanMoney(item.estimatedCostCny),
        tips: item.tips,
        place: formatPlace(item.place),
        route: formatTripPlanRoute(item.route),
      })),
      estimatedCostText: formatTripPlanMoney(day.estimatedCostCny),
      warnings: day.warnings.map((warning) => ({
        severityLabel: warningSeverityLabel(warning.severity),
        message: warning.message,
      })),
    })),
    hotelRecommendations: plan.hotelRecommendations.map(formatRecommendation),
    foodRecommendations: plan.foodRecommendations.map(formatRecommendation),
    budgetTotalText: formatTripPlanMoney(plan.budget.totalCny),
    budgetRows: [
      { label: '住宿', amountText: formatTripPlanMoney(plan.budget.accommodationCny) },
      { label: '交通', amountText: formatTripPlanMoney(plan.budget.transportationCny) },
      { label: '餐饮', amountText: formatTripPlanMoney(plan.budget.foodCny) },
      { label: '景点', amountText: formatTripPlanMoney(plan.budget.attractionsCny) },
      { label: '其他', amountText: formatTripPlanMoney(plan.budget.otherCny) },
    ],
    transportationTips: plan.transportationTips,
    generalTips: plan.generalTips,
  };
};
