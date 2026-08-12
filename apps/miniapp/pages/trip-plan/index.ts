import type {
  EditTripPlanInput,
  RegenerateTripPlanDayInput,
  TripPlanVersionSummary,
  TripPlanVersionDiffResult,
} from '@travel-guide/shared-types';
import { EditTripPlanInputSchema } from '@travel-guide/shared-schemas';

import { tripPlanService } from '../../services/trip-plan.service';
import {
  applyLatestTripPlanResult,
  applyTripPlanDayRegenerationResult,
  applyTripPlanEditResult,
  applyTripPlanDiffResult,
  applyTripPlanVersionRestoreResult,
  applyTripPlanViewError,
  applyTripPlanVersionResult,
  beginTripPlanLoad,
  beginTripPlanDayRegeneration,
  beginTripPlanEdit,
  beginTripPlanDiff,
  beginTripPlanVersionSwitch,
  beginTripPlanVersionRestore,
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
  diff?: TripPlanVersionDiffResult;
  diffFromVersion: number;
  diffToVersion: number;
  diffFromPickerIndex: number;
  diffToPickerIndex: number;
  diffVersionLabels: string[];
  isDiffLoading: boolean;
  restoringVersion?: number;
  isEditing: boolean;
  editSummary: string;
  editDayDrafts: Record<string, { summary: string }>;
  editItemDrafts: Record<
    string,
    { description: string; recommendationReason: string; tips: string; estimatedCostCny: string }
  >;
}

type TripPlanPageDisplayModel = Omit<TripPlanDisplayModel, 'days'> & {
  days: Array<
    Omit<TripPlanDisplayModel['days'][number], 'items'> & {
      regenerateInstruction: string;
      isRegenerating: boolean;
      editSummary: string;
      items: Array<
        TripPlanDisplayModel['days'][number]['items'][number] & {
          editDescription: string;
          editRecommendationReason: string;
          editTips: string;
          editEstimatedCostCny: string;
        }
      >;
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
            editSummary: page.data.editDayDrafts[String(day.dayNumber)]?.summary ?? day.summary,
            items: day.items.map((item) => {
              const draft = page.data.editItemDrafts[`${day.dayNumber}:${item.id}`];
              return {
                ...item,
                editDescription: draft?.description ?? item.description,
                editRecommendationReason: draft?.recommendationReason ?? item.recommendationReason,
                editTips: draft?.tips ?? item.tips.join('\n'),
                editEstimatedCostCny:
                  draft?.estimatedCostCny ?? item.estimatedCostText.replace(/^¥/, ''),
              };
            }),
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
    diff: state.diff,
    diffFromVersion: state.diffFromVersion ?? 0,
    diffToVersion: state.diffToVersion ?? 0,
    diffFromPickerIndex: selectedVersionIndex(readyVersions, state.diffFromVersion),
    diffToPickerIndex: selectedVersionIndex(readyVersions, state.diffToVersion),
    diffVersionLabels: readyVersions.map((item) => item.label),
    isDiffLoading: state.isDiffLoading,
    restoringVersion: state.restoringVersion,
    isEditing: state.isEditing,
    editSummary: page.data.editSummary || display?.summary || '',
    editDayDrafts: page.data.editDayDrafts,
    editItemDrafts: page.data.editItemDrafts,
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

type EditDayField = 'summary';
type EditItemField = 'description' | 'recommendationReason' | 'tips' | 'estimatedCostCny';

const editDayNumberFromEvent = (event: TripPlanPageEvent): number | undefined => {
  const value = event.currentTarget?.dataset?.dayNumber;
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const dayNumber = Number(value);
  return Number.isSafeInteger(dayNumber) && dayNumber >= 1 && dayNumber <= 14
    ? dayNumber
    : undefined;
};

const updateEditSummary = (
  page: PageInstance<TripPlanPageData>,
  event: TripPlanPageEvent,
): void => {
  const value = event.detail?.value;
  if (value === undefined) return;
  page.setData({ editSummary: value.slice(0, 4_000) });
};

const updateEditDay = (page: PageInstance<TripPlanPageData>, event: TripPlanPageEvent): void => {
  const dayNumber = editDayNumberFromEvent(event);
  const field = event.currentTarget?.dataset?.field as EditDayField | undefined;
  const value = event.detail?.value;
  if (dayNumber === undefined || value === undefined) return;
  if (field !== 'summary') return;
  const current = page.data.editDayDrafts[String(dayNumber)] ?? { summary: '' };
  const limit = 2_000;
  page.setData({
    editDayDrafts: {
      ...page.data.editDayDrafts,
      [String(dayNumber)]: { ...current, [field]: value.slice(0, limit) },
    },
  });
};

const updateEditItem = (page: PageInstance<TripPlanPageData>, event: TripPlanPageEvent): void => {
  const dayNumber = editDayNumberFromEvent(event);
  const itemId = event.currentTarget?.dataset?.itemId;
  const field = event.currentTarget?.dataset?.field as EditItemField | undefined;
  const value = event.detail?.value;
  if (dayNumber === undefined || itemId === undefined || value === undefined) return;
  if (
    field !== 'description' &&
    field !== 'recommendationReason' &&
    field !== 'tips' &&
    field !== 'estimatedCostCny'
  ) {
    return;
  }
  const key = `${dayNumber}:${itemId}`;
  const current = page.data.editItemDrafts[key] ?? {
    description: '',
    recommendationReason: '',
    tips: '',
    estimatedCostCny: '',
  };
  const limit =
    field === 'tips'
      ? 10_000
      : field === 'description'
        ? 2_000
        : field === 'recommendationReason'
          ? 1_000
          : 32;
  page.setData({
    editItemDrafts: {
      ...page.data.editItemDrafts,
      [key]: { ...current, [field]: value.slice(0, limit) },
    },
  });
};

const parseEditMoney = (value: string): number | undefined => {
  if (value.trim().length === 0) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildEditInput = (
  page: PageInstance<TripPlanPageData>,
  state: TripPlanViewState,
): EditTripPlanInput | undefined => {
  if (state.selectedVersion === undefined || state.plan === undefined) return undefined;
  const dayEdits: EditTripPlanInput['dayEdits'] = [];
  const itemEdits: EditTripPlanInput['itemEdits'] = [];
  const summary = page.data.editSummary.trim();
  const input: EditTripPlanInput = {
    sourceVersion: state.selectedVersion,
    ...(summary.length > 0 && summary !== state.plan.summary ? { summary } : {}),
  };

  for (const day of state.plan.days) {
    const draft = page.data.editDayDrafts[String(day.dayNumber)];
    if (draft === undefined) continue;
    const dayEdit: { dayNumber: number; summary?: string } = { dayNumber: day.dayNumber };
    const daySummary = draft.summary.trim();
    if (daySummary.length > 0 && daySummary !== day.summary) dayEdit.summary = daySummary;
    if (Object.keys(dayEdit).length > 1) dayEdits.push(dayEdit);
  }

  for (const day of state.plan.days) {
    for (const item of day.items) {
      const draft = page.data.editItemDrafts[`${day.dayNumber}:${item.id}`];
      if (draft === undefined) continue;
      const itemEdit: {
        dayNumber: number;
        itemId: string;
        description?: string;
        recommendationReason?: string;
        tips?: string[];
        estimatedCostCny?: number;
      } = { dayNumber: day.dayNumber, itemId: item.id };
      const description = draft.description.trim();
      if (description.length > 0 && description !== item.description)
        itemEdit.description = description;
      const recommendationReason = draft.recommendationReason.trim();
      if (recommendationReason.length > 0 && recommendationReason !== item.recommendationReason)
        itemEdit.recommendationReason = recommendationReason;
      const tipsText = draft.tips.trim();
      const currentTips = item.tips.join('\n');
      if (tipsText !== currentTips)
        itemEdit.tips = tipsText.length === 0 ? [] : tipsText.split(/\r?\n/);
      const cost = parseEditMoney(draft.estimatedCostCny);
      if (cost !== undefined && cost !== item.estimatedCostCny) itemEdit.estimatedCostCny = cost;
      if (Object.keys(itemEdit).length > 2) itemEdits.push(itemEdit);
    }
  }

  const candidate = {
    ...input,
    ...(dayEdits.length === 0 ? {} : { dayEdits }),
    ...(itemEdits.length === 0 ? {} : { itemEdits }),
  };
  const parsed = EditTripPlanInputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
};

const submitEdit = async (page: PageInstance<TripPlanPageData>): Promise<void> => {
  const state = getViewState(page);
  if (
    page.data.isSwitching ||
    page.data.isEditing ||
    state.status !== 'ready' ||
    state.selectedVersion === undefined ||
    state.plan === undefined ||
    page.data.tripId.length === 0
  ) {
    return;
  }
  const input = buildEditInput(page, state);
  if (input === undefined) {
    const nextState = applyTripPlanViewError(state, '请至少修改一项攻略内容。');
    setViewState(page, nextState);
    syncPage(page, nextState, page.data.plan);
    return;
  }
  const oldPlan = page.data.plan;
  let nextState = beginTripPlanEdit(state, input);
  setViewState(page, nextState);
  syncPage(page, nextState, oldPlan);
  try {
    const result = await tripPlanService.editTripPlanVersion(
      page.data.tripId,
      input.sourceVersion,
      input,
    );
    if (!viewStates.has(page)) return;
    nextState = applyTripPlanEditResult(getViewState(page), result);
    setViewState(page, nextState);
    page.setData({ editSummary: '', editDayDrafts: {}, editItemDrafts: {} });
    syncPage(page, nextState, displayPlan(nextState));
  } catch (error: unknown) {
    if (!viewStates.has(page)) return;
    nextState = applyTripPlanViewError(getViewState(page), getTripPlanUserMessage(error));
    setViewState(page, nextState);
    // Keep both the old immutable plan and the user's draft inputs available for retry.
    syncPage(page, nextState, oldPlan);
  }
};

const loadDiff = async (
  page: PageInstance<TripPlanPageData>,
  fromVersion: number,
  toVersion: number,
): Promise<void> => {
  const current = getViewState(page);
  if (
    page.data.isDiffLoading ||
    page.data.tripId.length === 0 ||
    fromVersion === toVersion ||
    !current.readyVersions.some((item) => item.version === fromVersion) ||
    !current.readyVersions.some((item) => item.version === toVersion)
  ) {
    return;
  }
  let state = beginTripPlanDiff(current, fromVersion, toVersion);
  setViewState(page, state);
  syncPage(page, state, page.data.plan);
  try {
    const result = await tripPlanService.getTripPlanDiff(page.data.tripId, fromVersion, toVersion);
    if (!viewStates.has(page)) return;
    state = applyTripPlanDiffResult(getViewState(page), result);
    setViewState(page, state);
    syncPage(page, state, page.data.plan);
  } catch (error: unknown) {
    if (!viewStates.has(page)) return;
    state = applyTripPlanViewError(getViewState(page), getTripPlanUserMessage(error));
    setViewState(page, state);
    syncPage(page, state, page.data.plan);
  }
};

const restoreVersion = async (
  page: PageInstance<TripPlanPageData>,
  version: number,
): Promise<void> => {
  const state = getViewState(page);
  if (
    page.data.tripId.length === 0 ||
    state.isSwitching ||
    state.restoringVersion !== undefined ||
    state.selectedVersion === version ||
    !state.readyVersions.some((item) => item.version === version)
  ) {
    return;
  }
  const oldPlan = page.data.plan;
  let nextState = beginTripPlanVersionRestore(state, version);
  setViewState(page, nextState);
  syncPage(page, nextState, oldPlan);
  try {
    const result = await tripPlanService.restoreTripPlanVersion(page.data.tripId, version);
    if (!viewStates.has(page)) return;
    nextState = applyTripPlanVersionRestoreResult(getViewState(page), result);
    setViewState(page, nextState);
    syncPage(page, nextState, displayPlan(nextState));
  } catch (error: unknown) {
    if (!viewStates.has(page)) return;
    nextState = applyTripPlanViewError(getViewState(page), getTripPlanUserMessage(error));
    setViewState(page, nextState);
    syncPage(page, nextState, oldPlan);
  }
};

const pickerIndexFromEvent = (event: TripPlanPageEvent): number | undefined => {
  const value = event.detail?.value;
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const restoreVersionFromEvent = (event: TripPlanPageEvent): number | undefined => {
  const value = event.currentTarget?.dataset?.version;
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 2_147_483_647
    ? parsed
    : undefined;
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
    diffFromVersion: 0,
    diffToVersion: 0,
    diffFromPickerIndex: 0,
    diffToPickerIndex: 0,
    diffVersionLabels: [],
    isDiffLoading: false,
    isEditing: false,
    editSummary: '',
    editDayDrafts: {},
    editItemDrafts: {},
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

  onEditSummaryInput(this: PageInstance<TripPlanPageData>, event: TripPlanPageEvent): void {
    if (this.data.isEditing) return;
    updateEditSummary(this, event);
  },

  onEditDayInput(this: PageInstance<TripPlanPageData>, event: TripPlanPageEvent): void {
    if (this.data.isEditing) return;
    updateEditDay(this, event);
  },

  onEditItemInput(this: PageInstance<TripPlanPageData>, event: TripPlanPageEvent): void {
    if (this.data.isEditing) return;
    updateEditItem(this, event);
  },

  onSubmitEdit(this: PageInstance<TripPlanPageData>): void {
    void submitEdit(this);
  },

  onDiffFromChange(this: PageInstance<TripPlanPageData>, event: TripPlanPageEvent): void {
    const index = pickerIndexFromEvent(event);
    if (index === undefined) return;
    const ready = getViewState(this).readyVersions;
    const version = ready[index];
    if (version === undefined) return;
    this.setData({ diffFromVersion: version.version, diffFromPickerIndex: index });
  },

  onDiffToChange(this: PageInstance<TripPlanPageData>, event: TripPlanPageEvent): void {
    const index = pickerIndexFromEvent(event);
    if (index === undefined) return;
    const ready = getViewState(this).readyVersions;
    const version = ready[index];
    if (version === undefined) return;
    this.setData({ diffToVersion: version.version, diffToPickerIndex: index });
  },

  onCompareVersions(this: PageInstance<TripPlanPageData>): void {
    void loadDiff(this, this.data.diffFromVersion, this.data.diffToVersion);
  },

  onRestoreVersion(this: PageInstance<TripPlanPageData>, event: TripPlanPageEvent): void {
    const version = restoreVersionFromEvent(event);
    if (version === undefined) return;
    void restoreVersion(this, version);
  },

  onRetry(this: PageInstance<TripPlanPageData>): void {
    void loadLatest(this);
  },

  onUnload(this: PageInstance<TripPlanPageData>): void {
    viewStates.delete(this);
  },
});
