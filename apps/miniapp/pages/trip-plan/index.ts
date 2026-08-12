import type {
  RegenerateTripPlanDayInput,
  TripPlanVersionSummary,
} from '@travel-guide/shared-types';

import { tripPlanService } from '../../services/trip-plan.service';
import {
  applyLatestTripPlanResult,
  applyTripPlanDayRegenerationResult,
  applyTripPlanViewError,
  applyTripPlanVersionResult,
  beginTripPlanLoad,
  beginTripPlanDayRegeneration,
  beginTripPlanVersionSwitch,
  createTripPlanDisplayModel,
  createTripPlanViewState,
  createTripPlanViewStateRegistry,
  getTripPlanUserMessage,
  parseTripPlanRouteParams,
  type TripPlanDisplayModel,
  type TripPlanViewState,
} from '../../utils/trip-plan-view';

interface TripPlanRouteOptions {
  tripId?: string;
  version?: string;
  [key: string]: unknown;
}

interface VersionOption {
  readonly value: string;
  readonly label: string;
  readonly status: TripPlanVersionSummary['status'];
  readonly statusLabel: string;
}

interface TripPlanPageData {
  tripId: string;
  status: TripPlanViewState['status'];
  isLoading: boolean;
  isSwitching: boolean;
  errorMessage: string;
  plan?: TripPlanDisplayModel;
  allVersions: VersionOption[];
  readyVersions: VersionOption[];
  allVersionLabels: string[];
  readyVersionLabels: string[];
  versionPickerIndex: number;
  selectedVersion?: number;
  regeneratingDay?: number;
  regenerateInstructions: Record<string, string>;
}

type TripPlanPageDisplayModel = Omit<TripPlanDisplayModel, 'days'> & {
  days: Array<
    TripPlanDisplayModel['days'][number] & {
      regenerateInstruction: string;
      isRegenerating: boolean;
    }
  >;
};

const viewStates = createTripPlanViewStateRegistry<PageInstance<TripPlanPageData>>();

const getViewState = (page: PageInstance<TripPlanPageData>): TripPlanViewState =>
  viewStates.get(page) ?? createTripPlanViewState(page.data.tripId);

const setViewState = (page: PageInstance<TripPlanPageData>, state: TripPlanViewState): void => {
  viewStates.set(page, state);
};

const toVersionOptions = (versions: readonly TripPlanVersionSummary[]): VersionOption[] =>
  versions.map((version) => ({
    value: String(version.version),
    label: `第 ${version.version} 版 · ${version.createdAt.slice(0, 10)}`,
    status: version.status,
    statusLabel:
      version.status === 'ready'
        ? '可查看'
        : version.status === 'generating'
          ? '生成中'
          : '生成失败',
  }));

const selectedVersionIndex = (versions: readonly VersionOption[], version?: number): number => {
  if (version === undefined) return 0;
  const index = versions.findIndex((item) => item.value === String(version));
  return index < 0 ? 0 : index;
};

const syncPage = (
  page: PageInstance<TripPlanPageData>,
  state: TripPlanViewState,
  plan: TripPlanDisplayModel | undefined,
): void => {
  const allVersions = toVersionOptions(state.allVersions);
  const readyVersions = toVersionOptions(state.readyVersions);
  const display: TripPlanPageDisplayModel | undefined =
    plan === undefined
      ? undefined
      : {
          ...plan,
          days: plan.days.map((day) => ({
            ...day,
            regenerateInstruction: page.data.regenerateInstructions[String(day.dayNumber)] ?? '',
            isRegenerating: state.regeneratingDay === day.dayNumber,
          })),
        };
  page.setData({
    tripId: state.tripId,
    status: state.status,
    isLoading: state.status === 'loading',
    isSwitching: state.isSwitching,
    errorMessage: state.errorMessage,
    plan: display,
    allVersions,
    readyVersions,
    allVersionLabels: allVersions.map((item) => `${item.label} · ${item.statusLabel}`),
    readyVersionLabels: readyVersions.map((item) => item.label),
    versionPickerIndex: selectedVersionIndex(readyVersions, state.selectedVersion),
    selectedVersion: state.selectedVersion,
    regeneratingDay: state.regeneratingDay,
  });
};

const displayPlan = (state: TripPlanViewState): TripPlanDisplayModel | undefined =>
  state.plan === undefined ? undefined : createTripPlanDisplayModel(state.plan);

const loadLatest = async (page: PageInstance<TripPlanPageData>): Promise<void> => {
  if (page.data.isLoading || page.data.tripId.length === 0) return;
  let state = beginTripPlanLoad(getViewState(page));
  setViewState(page, state);
  syncPage(page, state, page.data.plan);

  try {
    const result = await tripPlanService.getLatestTripPlan(page.data.tripId);
    if (!viewStates.has(page)) return;
    state = applyLatestTripPlanResult(getViewState(page), result);
    setViewState(page, state);
    syncPage(page, state, displayPlan(state));
  } catch (error: unknown) {
    if (!viewStates.has(page)) return;
    state = applyTripPlanViewError(getViewState(page), getTripPlanUserMessage(error));
    setViewState(page, state);
    syncPage(page, state, page.data.plan);
  }
};

const loadVersion = async (
  page: PageInstance<TripPlanPageData>,
  version: number,
): Promise<void> => {
  if (page.data.isSwitching || page.data.tripId.length === 0) return;
  const oldPlan = page.data.plan;
  let state = beginTripPlanVersionSwitch(getViewState(page));
  setViewState(page, state);
  syncPage(page, state, oldPlan);

  try {
    const result = await tripPlanService.getTripPlanVersion(page.data.tripId, version);
    if (!viewStates.has(page)) return;
    state = applyTripPlanVersionResult(getViewState(page), result);
    setViewState(page, state);
    syncPage(page, state, displayPlan(state));
  } catch (error: unknown) {
    if (!viewStates.has(page)) return;
    state = applyTripPlanViewError(getViewState(page), getTripPlanUserMessage(error));
    setViewState(page, state);
    // Keep the old display model if the requested version is unavailable or invalid.
    syncPage(page, state, oldPlan);
  }
};

interface TripPlanPageEvent {
  readonly currentTarget?: { readonly dataset?: Record<string, string | undefined> };
  readonly detail?: { readonly value?: string };
}

const dayNumberFromEvent = (event: TripPlanPageEvent): number | undefined => {
  const value = event.currentTarget?.dataset?.dayNumber;
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const dayNumber = Number(value);
  return Number.isSafeInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 14
    ? dayNumber
    : undefined;
};

const updateDayInstruction = (
  page: PageInstance<TripPlanPageData>,
  event: TripPlanPageEvent,
): void => {
  const dayNumber = dayNumberFromEvent(event);
  const value = event.detail?.value;
  if (dayNumber === undefined || value === undefined) return;
  page.setData({
    regenerateInstructions: {
      ...page.data.regenerateInstructions,
      [String(dayNumber)]: value.slice(0, 500),
    },
  });
};

const regenerateDay = async (
  page: PageInstance<TripPlanPageData>,
  dayNumber: number,
): Promise<void> => {
  const state = getViewState(page);
  if (
    page.data.isSwitching ||
    state.regeneratingDay !== undefined ||
    state.selectedVersion === undefined ||
    page.data.tripId.length === 0
  ) {
    return;
  }

  const instruction = page.data.regenerateInstructions[String(dayNumber)]?.trim();
  const request: RegenerateTripPlanDayInput = {
    sourceVersion: state.selectedVersion,
    dayNumber,
    ...(instruction === undefined || instruction.length === 0 ? {} : { instruction }),
  };
  const oldPlan = page.data.plan;
  let nextState = beginTripPlanDayRegeneration(state, dayNumber);
  setViewState(page, nextState);
  syncPage(page, nextState, oldPlan);

  try {
    const result = await tripPlanService.regenerateTripPlanDay(page.data.tripId, request);
    if (!viewStates.has(page)) return;
    nextState = applyTripPlanDayRegenerationResult(getViewState(page), result);
    setViewState(page, nextState);
    syncPage(page, nextState, displayPlan(nextState));
  } catch (error: unknown) {
    if (!viewStates.has(page)) return;
    nextState = applyTripPlanViewError(getViewState(page), getTripPlanUserMessage(error));
    setViewState(page, nextState);
    // A failed replacement keeps the old immutable plan visible for retry.
    syncPage(page, nextState, oldPlan);
  }
};

Page<TripPlanPageData>({
  data: {
    tripId: '',
    status: 'idle',
    isLoading: false,
    isSwitching: false,
    errorMessage: '',
    allVersions: [],
    readyVersions: [],
    allVersionLabels: [],
    readyVersionLabels: [],
    versionPickerIndex: 0,
    regenerateInstructions: {},
  },

  onLoad(this: PageInstance<TripPlanPageData>, options: TripPlanRouteOptions): void {
    try {
      const route = parseTripPlanRouteParams(options);
      setViewState(this, createTripPlanViewState(route.tripId));
      this.setData({ tripId: route.tripId, errorMessage: '', status: 'idle', isLoading: false });
      void loadLatest(this).then(() => {
        if (!viewStates.has(this)) return;
        const state = getViewState(this);
        if (
          route.version !== undefined &&
          route.version !== state.selectedVersion &&
          state.readyVersions.some((item) => item.version === route.version)
        ) {
          void loadVersion(this, route.version);
        }
      });
    } catch {
      viewStates.delete(this);
      this.setData({
        status: 'error',
        isLoading: false,
        errorMessage: '页面参数无效，请返回重新开始。',
      });
    }
  },

  onVersionChange(
    this: PageInstance<TripPlanPageData>,
    event: { detail: { value: string } },
  ): void {
    if (this.data.isSwitching) return;
    const selected = this.data.readyVersions[Number(event.detail.value)];
    if (selected === undefined) return;
    try {
      const parsed = parseTripPlanRouteParams({
        tripId: this.data.tripId,
        version: selected.value,
      });
      const state = getViewState(this);
      if (parsed.version === undefined || parsed.version === state.selectedVersion) return;
      void loadVersion(this, parsed.version);
    } catch (error: unknown) {
      const state = applyTripPlanViewError(getViewState(this), getTripPlanUserMessage(error));
      setViewState(this, state);
      syncPage(this, state, this.data.plan);
    }
  },

  onRegenerateInstructionInput(
    this: PageInstance<TripPlanPageData>,
    event: TripPlanPageEvent,
  ): void {
    updateDayInstruction(this, event);
  },

  onRegenerateDay(this: PageInstance<TripPlanPageData>, event: TripPlanPageEvent): void {
    const dayNumber = dayNumberFromEvent(event);
    if (dayNumber === undefined) return;
    void regenerateDay(this, dayNumber);
  },

  onRetry(this: PageInstance<TripPlanPageData>): void {
    void loadLatest(this);
  },

  onUnload(this: PageInstance<TripPlanPageData>): void {
    viewStates.delete(this);
  },
});
