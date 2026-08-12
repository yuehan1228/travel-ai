import {
  TripIdSchema,
  TripPlanGenerationResultSchema,
  RegenerateTripPlanDayResultSchema,
  RestoreTripPlanVersionResultSchema,
  TripPlanSchema,
  TripPlanVersionDiffResultSchema,
  TripPlanVersionListResultSchema,
} from '@travel-guide/shared-schemas';
import type {
  DailyWeather,
  FoodRecommendation,
  HotelAreaRecommendation,
  Place,
  RouteEstimate,
  TripPlan,
  TripPlanGenerationResult,
  RegenerateTripPlanDayResult,
  RestoreTripPlanVersionResult,
  TripPlanItem,
  TripPlanItemType,
  TripPlanVersionListResult,
  TripPlanVersionSummary,
  TripPlanVersionDiffResult,
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
  readonly errorMessage: string;
  readonly diff?: TripPlanVersionDiffResult;
  readonly diffFromVersion?: number;
  readonly diffToVersion?: number;
  readonly isDiffLoading: boolean;
  readonly restoringVersion?: number;
}

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
  errorMessage: '',
  isDiffLoading: false,
  restoringVersion: undefined,
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

export const beginTripPlanLoad = (state: TripPlanViewState): TripPlanViewState => ({
  ...state,
  status: 'loading',
  isSwitching: false,
  regeneratingDay: undefined,
  errorMessage: '',
  isDiffLoading: false,
  restoringVersion: undefined,
});

export const beginTripPlanVersionSwitch = (state: TripPlanViewState): TripPlanViewState => ({
  ...state,
  isSwitching: true,
  regeneratingDay: undefined,
  errorMessage: '',
});

export const beginTripPlanDiff = (
  state: TripPlanViewState,
  fromVersion: number,
  toVersion: number,
): TripPlanViewState => {
  if (
    state.isDiffLoading ||
    state.isSwitching ||
    state.restoringVersion !== undefined ||
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
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
    restoringVersion: undefined,
    errorMessage: '',
  };
};

export const beginTripPlanDayRegeneration = (
  state: TripPlanViewState,
  dayNumber: number,
): TripPlanViewState =>
  state.regeneratingDay === undefined &&
  Number.isSafeInteger(dayNumber) &&
  dayNumber >= 1 &&
  dayNumber <= 14
    ? {
        ...state,
        regeneratingDay: dayNumber,
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
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    errorMessage: hasPlan ? '' : '暂时没有可用攻略。',
    isDiffLoading: false,
    restoringVersion: undefined,
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
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
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
    diff: undefined,
    diffFromVersion: undefined,
    diffToVersion: undefined,
    isDiffLoading: false,
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
  isDiffLoading: false,
  restoringVersion: undefined,
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
