import type { TripPlanGenerationResult } from '@travel-guide/shared-types';

/**
 * Generation copy is deliberately qualitative. The API does not expose progress,
 * so the miniapp must never imply a percentage or a completed stage on its own.
 */
export const TRIP_GENERATION_PHASES = [
  '正在准备旅行需求…',
  '正在查询天气…',
  '正在筛选景点…',
  '正在规划路线…',
  '正在生成攻略…',
  '正在保存攻略…',
] as const;

export type TripGenerationPhase = (typeof TRIP_GENERATION_PHASES)[number];

export type TripGeneratingStatus = 'idle' | 'generating' | 'ready' | 'failed' | 'auth-required';

export interface TripGeneratingState {
  readonly tripId: string;
  readonly status: TripGeneratingStatus;
  readonly phaseIndex: number;
  readonly phaseMessage: TripGenerationPhase;
  readonly result?: TripPlanGenerationResult;
  readonly errorMessage: string;
}

export const createTripGeneratingState = (tripId: string): TripGeneratingState => ({
  tripId,
  status: 'idle',
  phaseIndex: 0,
  phaseMessage: TRIP_GENERATION_PHASES[0],
  errorMessage: '',
});

export const startTripGeneration = (state: TripGeneratingState): TripGeneratingState => {
  if (state.status === 'generating') {
    return state;
  }

  return {
    ...state,
    status: 'generating',
    phaseIndex: 0,
    phaseMessage: TRIP_GENERATION_PHASES[0],
    result: undefined,
    errorMessage: '',
  };
};

export const advanceTripGenerationPhase = (state: TripGeneratingState): TripGeneratingState => {
  if (state.status !== 'generating') {
    return state;
  }

  const phaseIndex = (state.phaseIndex + 1) % TRIP_GENERATION_PHASES.length;
  return {
    ...state,
    phaseIndex,
    phaseMessage: TRIP_GENERATION_PHASES[phaseIndex],
  };
};

export const finishTripGeneration = (
  state: TripGeneratingState,
  result: TripPlanGenerationResult,
): TripGeneratingState => ({
  ...state,
  status: result.status === 'ready' && result.plan !== undefined ? 'ready' : 'failed',
  result: result.status === 'ready' && result.plan !== undefined ? result : undefined,
  errorMessage:
    result.status === 'ready' && result.plan !== undefined ? '' : '攻略未能生成，请稍后重试。',
});

export const failTripGeneration = (
  state: TripGeneratingState,
  errorMessage: string,
): TripGeneratingState => ({
  ...state,
  status: 'failed',
  result: undefined,
  errorMessage,
});

export const requireTripGenerationAuth = (state: TripGeneratingState): TripGeneratingState => ({
  ...state,
  status: 'auth-required',
  result: undefined,
  errorMessage: '登录状态已失效，请重新登录。',
});

export const canStartTripGeneration = (state: TripGeneratingState): boolean =>
  state.status !== 'generating';

export interface GenerationTimerAdapter {
  set(callback: () => void, intervalMs: number): unknown;
  clear(timer: unknown): void;
}

/** Default adapter keeps timer ownership outside the pure state model. */
export const defaultGenerationTimerAdapter: GenerationTimerAdapter = {
  set: (callback, intervalMs) => setInterval(callback, intervalMs),
  clear: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
};

export const TRIP_GENERATION_PHASE_INTERVAL_MS = 1_800;

export interface GenerationStageController {
  getState(): TripGeneratingState;
  start(): boolean;
  advance(): TripGeneratingState;
  finish(result: TripPlanGenerationResult): TripGeneratingState;
  fail(errorMessage: string): TripGeneratingState;
  requireAuth(): TripGeneratingState;
  clear(): void;
}

export interface GenerationStageControllerOptions {
  readonly timerAdapter?: GenerationTimerAdapter;
  readonly intervalMs?: number;
  readonly onStateChange?: (state: TripGeneratingState) => void;
}

/**
 * Own one stage timer per page/controller instance. The page can dispose this
 * controller on unload without affecting another generation page.
 */
export const createGenerationStageController = (
  tripId: string,
  options: GenerationStageControllerOptions = {},
): GenerationStageController => {
  const adapter = options.timerAdapter ?? defaultGenerationTimerAdapter;
  const intervalMs = options.intervalMs ?? TRIP_GENERATION_PHASE_INTERVAL_MS;
  let state = createTripGeneratingState(tripId);
  let timer: unknown;

  const emit = (): void => {
    options.onStateChange?.(state);
  };

  const clear = (): void => {
    if (timer !== undefined) {
      adapter.clear(timer);
      timer = undefined;
    }
  };

  const startTimer = (): void => {
    clear();
    timer = adapter.set(() => {
      if (state.status !== 'generating') {
        clear();
        return;
      }
      state = advanceTripGenerationPhase(state);
      emit();
    }, intervalMs);
  };

  return {
    getState: () => state,
    start: (): boolean => {
      if (!canStartTripGeneration(state)) return false;
      state = startTripGeneration(state);
      emit();
      startTimer();
      return true;
    },
    advance: (): TripGeneratingState => {
      state = advanceTripGenerationPhase(state);
      emit();
      return state;
    },
    finish: (result): TripGeneratingState => {
      clear();
      state = finishTripGeneration(state, result);
      emit();
      return state;
    },
    fail: (errorMessage): TripGeneratingState => {
      clear();
      state = failTripGeneration(state, errorMessage);
      emit();
      return state;
    },
    requireAuth: (): TripGeneratingState => {
      clear();
      state = requireTripGenerationAuth(state);
      emit();
      return state;
    },
    clear,
  };
};

export const isTripGenerationAuthFailure = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly apiCode?: unknown };
  return candidate.code === 'AUTH_TOKEN_INVALID' || candidate.apiCode === 'AUTH_TOKEN_INVALID';
};
