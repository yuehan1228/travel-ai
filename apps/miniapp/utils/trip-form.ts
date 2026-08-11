import { CreateTripInputSchema } from '@travel-guide/shared-schemas';
import {
  BUDGET_LEVELS,
  TRAVEL_PACES,
  TRAVEL_PREFERENCES,
  TRANSPORT_PREFERENCES,
  type BudgetLevel,
  type CreateTripInput,
  type TravelPace,
  type TravelPreference,
  type TransportPreference,
} from '@travel-guide/shared-types';
import { ZodError, type ZodIssue } from 'zod';

export type TripBudgetMode = 'none' | 'level' | 'custom';

export interface TripFormState {
  cityName: string;
  cityCode: string;
  origin: string;
  startDate: string;
  endDate: string;
  travelerCount: number;
  preferences: TravelPreference[];
  pace: TravelPace | '';
  budgetMode: TripBudgetMode;
  budgetLevel: BudgetLevel | '';
  customBudgetText: string;
  transportPreference: TransportPreference | '';
  extraRequirements: string;
}

export type TripFormField =
  | 'cityName'
  | 'cityCode'
  | 'origin'
  | 'startDate'
  | 'endDate'
  | 'travelerCount'
  | 'preferences'
  | 'pace'
  | 'budget'
  | 'customBudgetText'
  | 'transportPreference'
  | 'extraRequirements'
  | 'form';

export type TripFormErrors = Partial<Record<TripFormField, string>>;

export interface TripFormValidationResult {
  valid: boolean;
  success: boolean;
  errors: TripFormErrors;
  input?: CreateTripInput;
  data?: CreateTripInput;
}

export const createDefaultTripFormState = (): TripFormState => ({
  cityName: '',
  cityCode: '',
  origin: '',
  startDate: '',
  endDate: '',
  travelerCount: 1,
  preferences: [],
  pace: 'moderate',
  budgetMode: 'none',
  budgetLevel: '',
  customBudgetText: '',
  transportPreference: 'public_transport',
  extraRequirements: '',
});

const isBudgetLevel = (value: string): value is BudgetLevel =>
  BUDGET_LEVELS.some((candidate) => candidate === value);

const isBudgetMode = (value: string): value is TripBudgetMode =>
  value === 'none' || value === 'level' || value === 'custom';

export const parseCustomBudgetText = (value: string): number | undefined => {
  const normalizedValue = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedValue)) {
    return undefined;
  }

  const amount = Number(normalizedValue);
  if (!Number.isFinite(amount) || amount <= 0) {
    return undefined;
  }

  return amount;
};

interface TripInputBudgetCandidate {
  type: string;
  level?: string;
  totalCny?: number;
  currency: string;
}

interface TripInputCandidate {
  destination: {
    cityName: string;
    cityCode?: string;
  };
  origin?: string;
  startDate: string;
  endDate: string;
  travelerCount: number;
  preferences: string[];
  pace: string;
  budget?: TripInputBudgetCandidate;
  transportPreference: string;
  extraRequirements?: string;
}

const trimOptional = (value: string): string | undefined => {
  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : undefined;
};

const createBudgetCandidate = (formState: TripFormState): TripInputBudgetCandidate | undefined => {
  if (formState.budgetMode === 'none') {
    return undefined;
  }

  if (formState.budgetMode === 'level') {
    return {
      type: 'level',
      level: formState.budgetLevel,
      currency: 'CNY',
    };
  }

  if (formState.budgetMode === 'custom') {
    return {
      type: 'custom',
      totalCny: parseCustomBudgetText(formState.customBudgetText) ?? Number.NaN,
      currency: 'CNY',
    };
  }

  return {
    type: 'invalid',
    currency: 'CNY',
  };
};

const createTripInputCandidate = (formState: TripFormState): TripInputCandidate => {
  const cityCode = trimOptional(formState.cityCode);
  const origin = trimOptional(formState.origin);
  const extraRequirements = trimOptional(formState.extraRequirements);
  const budget = createBudgetCandidate(formState);

  return {
    destination: {
      cityName: formState.cityName.trim(),
      ...(cityCode === undefined ? {} : { cityCode }),
    },
    ...(origin === undefined ? {} : { origin }),
    startDate: formState.startDate.trim(),
    endDate: formState.endDate.trim(),
    travelerCount: formState.travelerCount,
    preferences: [...formState.preferences],
    pace: formState.pace,
    ...(budget === undefined ? {} : { budget }),
    transportPreference: formState.transportPreference,
    ...(extraRequirements === undefined ? {} : { extraRequirements }),
  };
};

const customBudgetError = '请输入有效的自定义预算（大于 0，最多两位小数）';

const getFieldFromIssue = (issue: ZodIssue): TripFormField => {
  const firstPathPart = issue.path[0];
  const secondPathPart = issue.path[1];

  if (firstPathPart === 'destination') {
    return secondPathPart === 'cityCode' ? 'cityCode' : 'cityName';
  }

  if (
    firstPathPart === 'startDate' ||
    firstPathPart === 'endDate' ||
    firstPathPart === 'travelerCount' ||
    firstPathPart === 'preferences' ||
    firstPathPart === 'pace' ||
    firstPathPart === 'transportPreference' ||
    firstPathPart === 'extraRequirements'
  ) {
    return firstPathPart;
  }

  if (firstPathPart === 'budget') {
    return secondPathPart === 'totalCny' ? 'customBudgetText' : 'budget';
  }

  if (firstPathPart === 'origin') {
    return 'origin';
  }

  return 'form';
};

const getIssueMessage = (issue: ZodIssue, field: TripFormField): string => {
  if (field === 'cityName') {
    return '请输入目的地城市';
  }

  if (field === 'cityCode') {
    return '城市编码不能超过 20 个字符';
  }

  if (field === 'origin') {
    return '出发地不能超过 100 个字符';
  }

  if (field === 'startDate' || field === 'endDate') {
    if (issue.message.includes('not be earlier')) {
      return '返程日期不能早于出发日期';
    }

    if (issue.message.includes('duration')) {
      return '行程不能超过 14 天';
    }

    return '请选择有效日期';
  }

  if (field === 'travelerCount') {
    return '出行人数需为 1～20 人';
  }

  if (field === 'preferences') {
    if (issue.message.includes('duplicates')) {
      return '旅行偏好不能重复';
    }

    if (issue.message.includes('at least one')) {
      return '请至少选择一项旅行偏好';
    }

    return '请选择有效的旅行偏好';
  }

  if (field === 'customBudgetText') {
    return customBudgetError;
  }

  if (field === 'extraRequirements') {
    return '补充要求不能超过 1000 字';
  }

  if (field === 'pace') {
    return '请选择旅行节奏';
  }

  if (field === 'transportPreference') {
    return '请选择交通偏好';
  }

  if (field === 'budget') {
    return issue.path[1] === 'level' ? '请选择预算等级' : '请选择预算方式';
  }

  if (field === 'form') {
    return '请检查表单内容';
  }

  return issue.message;
};

export const mapTripValidationErrors = (error: ZodError): TripFormErrors => {
  const errors: TripFormErrors = {};

  for (const issue of error.issues) {
    const field = getFieldFromIssue(issue);
    if (errors[field] !== undefined) {
      continue;
    }

    errors[field] = getIssueMessage(issue, field);
  }

  return errors;
};

export const validateTripForm = (formState: TripFormState): TripFormValidationResult => {
  const candidate = createTripInputCandidate(formState);
  const parsed = CreateTripInputSchema.safeParse(candidate);
  const localErrors: TripFormErrors = {};

  if (
    formState.budgetMode === 'custom' &&
    parseCustomBudgetText(formState.customBudgetText) === undefined
  ) {
    localErrors.customBudgetText = customBudgetError;
  }

  const schemaErrors = parsed.success ? {} : mapTripValidationErrors(parsed.error);
  const errors: TripFormErrors = { ...schemaErrors, ...localErrors };
  const valid = parsed.success && Object.keys(errors).length === 0;

  return {
    valid,
    success: valid,
    errors,
    ...(valid && parsed.success ? { input: parsed.data, data: parsed.data } : {}),
  };
};

export class TripFormValidationError extends Error {
  public constructor(public readonly errors: TripFormErrors) {
    super('旅行需求表单校验失败');
    this.name = 'TripFormValidationError';
  }
}

export const toCreateTripInput = (formState: TripFormState): CreateTripInput => {
  const validation = validateTripForm(formState);
  if (!validation.valid || validation.input === undefined) {
    throw new TripFormValidationError(validation.errors);
  }

  return validation.input;
};

export const canSubmitTripForm = (isSubmitting: boolean): boolean => !isSubmitting;

export const isTripBudgetMode = (value: string): value is TripBudgetMode => isBudgetMode(value);

export const isTripBudgetLevel = (value: string): value is BudgetLevel => isBudgetLevel(value);

export const TRAVEL_PREFERENCE_VALUES = TRAVEL_PREFERENCES;
export const TRAVEL_PACE_VALUES = TRAVEL_PACES;
export const TRANSPORT_PREFERENCE_VALUES = TRANSPORT_PREFERENCES;
export const BUDGET_LEVEL_VALUES = BUDGET_LEVELS;
