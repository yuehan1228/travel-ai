import { z } from 'zod';

import {
  TRIP_PLAN_DATA_SOURCES,
  TRIP_PLAN_ITEM_TYPES,
  TRIP_PLAN_WARNING_SEVERITIES,
  type FoodRecommendation,
  type HotelAreaRecommendation,
  type TripBudgetEstimate,
  type TripPlan,
  type TripPlanDataSource,
  type TripPlanDay,
  type TripPlanItem,
  type TripPlanItemType,
  type TripPlanWarning,
  type TripPlanWarningSeverity,
  type GenerateTripPlanInput,
  type RegenerateTripPlanDayInput,
  type RegenerateTripPlanDayResult,
  type EditTripPlanInput,
  type EditTripPlanDayInput,
  type EditTripPlanItemInput,
  type EditTripPlanResult,
  type ListTripPlanItemReplacementCandidatesInput,
  type TripPlanItemReplacementCandidate,
  type TripPlanItemReplacementCandidateList,
  type ReplaceTripPlanItemInput,
  type ReplaceTripPlanItemResult,
  type ReorderTripPlanItemsInput,
  type ReorderTripPlanItemsResult,
  type OptimizeTripPlanDayInput,
  type OptimizeTripPlanDayResult,
  type GetTripPlanOptimizationAuditInput,
  type TripPlanOptimizationCandidate,
  type TripPlanOptimizationDecision,
  type TripPlanOptimizationTimelineChange,
  type TripPlanOptimizationAuditResult,
  type TripPlanGenerationResult,
  type TripPlanVersionListResult,
  type TripPlanVersionStatus,
  type TripPlanVersionSummary,
  TRIP_PLAN_VERSION_STATUSES,
  TRIP_PLAN_BUDGET_CHANGE_FIELDS,
  TRIP_PLAN_DAY_CHANGE_FIELDS,
  TRIP_PLAN_ITEM_CHANGE_FIELDS,
  TRIP_PLAN_ITEM_CHANGE_TYPES,
  TRIP_PLAN_ROOT_CHANGE_FIELDS,
  MAX_TRIP_PLAN_DIFF_DAY_CHANGES,
  MAX_TRIP_PLAN_DIFF_ITEM_CHANGES,
  type RestoreTripPlanVersionInput,
  type RestoreTripPlanVersionResult,
  type TripPlanBudgetDiff,
  type TripPlanDayChange,
  type TripPlanDayChangeField,
  type TripPlanItemChange,
  type TripPlanItemChangeField,
  type TripPlanItemChangeType,
  type TripPlanVersionDiffInput,
  type TripPlanVersionDiffResult,
  type TripPlanRootChangeField,
} from '@travel-guide/shared-types';

import { PlaceSchema } from './place.schema';
import { RouteEstimateSchema } from './route.schema';
import {
  createOptionalTrimmedStringSchema,
  createTrimmedRequiredStringSchema,
} from './common.schema';
import { IsoDateSchema } from './trip-input.schema';
import { DailyWeatherSchema } from './weather.schema';
import { PaginationMetaSchema } from './api.schema';

export const MAX_TRIP_PLAN_DAYS = 14;
export const MAX_TRIP_PLAN_ITEMS_PER_DAY = 20;
export const MAX_TRIP_PLAN_HOTEL_RECOMMENDATIONS = 10;
export const MAX_TRIP_PLAN_FOOD_RECOMMENDATIONS = 20;
export const MAX_TRIP_PLAN_TIPS = 20;
export const MAX_TRIP_PLAN_WARNINGS_PER_DAY = 20;
export const MAX_TRIP_PLAN_MONEY_CNY = 100_000_000;
export const MAX_TRIP_PLAN_ITEM_REPLACEMENT_CANDIDATES = 20;

const MILLISECONDS_PER_DAY = 86_400_000;
const ISO_DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const isoDateMilliseconds = (value: string): number => {
  const match = ISO_DATE_PARTS.exec(value);
  if (match === null) return Number.NaN;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getTime();
};

const addIsoDays = (value: string, days: number): string => {
  const date = new Date(isoDateMilliseconds(value));
  date.setUTCDate(date.getUTCDate() + days);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const timeToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const cents = (value: number): number => Math.round(value * 100);

const hasAtMostTwoDecimalPlaces = (value: number): boolean => {
  const scaled = value * 100;
  const difference = Math.abs(scaled - Math.round(scaled));
  return difference <= Number.EPSILON * Math.max(1, Math.abs(scaled)) * 10;
};

const moneySchema = z
  .number({ invalid_type_error: 'amount must be a number' })
  .finite({ message: 'amount must be finite' })
  .nonnegative({ message: 'amount must not be negative' })
  .max(MAX_TRIP_PLAN_MONEY_CNY, {
    message: `amount must be at most ${MAX_TRIP_PLAN_MONEY_CNY}`,
  })
  .refine(hasAtMostTwoDecimalPlaces, {
    message: 'amount must have at most two decimal places',
  });

const timeSchema = z
  .string({ invalid_type_error: 'time must be a string' })
  .regex(TIME_PATTERN, { message: 'time must use HH:mm format' });

const tipSchema = createTrimmedRequiredStringSchema('tip', 500);
const tipsSchema: z.ZodType<string[], z.ZodTypeDef, unknown> = z
  .array(tipSchema)
  .max(MAX_TRIP_PLAN_TIPS);

const dataSourceSchema: z.ZodType<TripPlanDataSource, z.ZodTypeDef, unknown> =
  z.enum(TRIP_PLAN_DATA_SOURCES);

const dataSourcesSchema: z.ZodType<TripPlanDataSource[], z.ZodTypeDef, unknown> = z
  .array(dataSourceSchema)
  .min(1, { message: 'dataSources must contain at least one source' })
  .max(TRIP_PLAN_DATA_SOURCES.length)
  .refine((sources) => new Set(sources).size === sources.length, {
    message: 'dataSources must not contain duplicates',
  });

const itemTypeSchema: z.ZodType<TripPlanItemType, z.ZodTypeDef, unknown> =
  z.enum(TRIP_PLAN_ITEM_TYPES);

const warningSeveritySchema: z.ZodType<TripPlanWarningSeverity, z.ZodTypeDef, unknown> = z.enum(
  TRIP_PLAN_WARNING_SEVERITIES,
);

const planText = (fieldName: string, maxLength: number) =>
  createTrimmedRequiredStringSchema(fieldName, maxLength);

export const TripPlanDataSourceSchema = dataSourceSchema;
export const TripPlanItemTypeSchema = itemTypeSchema;
export const TripPlanWarningSeveritySchema = warningSeveritySchema;

export const TripPlanWarningSchema: z.ZodType<TripPlanWarning, z.ZodTypeDef, unknown> = z
  .object({
    code: z
      .string({ invalid_type_error: 'warning code must be a string' })
      .trim()
      .min(1, { message: 'warning code must not be empty' })
      .max(64, { message: 'warning code must be at most 64 characters' })
      .regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/, {
        message: 'warning code must use uppercase letters, digits and underscores',
      }),
    severity: warningSeveritySchema,
    message: planText('warning message', 500),
    dayNumber: z.number().finite().int().min(1).max(MAX_TRIP_PLAN_DAYS).optional(),
  })
  .strict();

export const TripPlanItemSchema: z.ZodType<TripPlanItem, z.ZodTypeDef, unknown> = z
  .object({
    id: z.string().uuid(),
    type: itemTypeSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    name: planText('name', 200),
    description: planText('description', 2_000),
    recommendationReason: planText('recommendationReason', 1_000),
    place: PlaceSchema.optional(),
    route: RouteEstimateSchema.optional(),
    estimatedCostCny: moneySchema,
    tips: tipsSchema,
    dataSources: dataSourcesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (timeToMinutes(value.endTime) <= timeToMinutes(value.startTime)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'endTime must be later than startTime',
      });
    }

    if (
      (value.type === 'attraction' || value.type === 'food' || value.type === 'hotel') &&
      value.place === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['place'],
        message: `${value.type} items referring to a concrete place require place data`,
      });
    }

    if (value.place !== undefined && !value.dataSources.includes('map_provider')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataSources'],
        message: 'items with place data must include map_provider in dataSources',
      });
    }

    if (value.route?.dataSource === 'unavailable') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['route'],
        message: 'unavailable routes must not be used as itinerary route estimates',
      });
    }
    if (value.route?.dataSource !== 'unavailable' && value.route !== undefined) {
      if (!value.dataSources.includes('route_provider')) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataSources'],
          message: 'items with an available route must include route_provider in dataSources',
        });
      }
    }
  });

const recommendationBase = {
  id: z.string().uuid(),
  description: planText('description', 2_000),
  recommendationReason: planText('recommendationReason', 1_000),
  tips: tipsSchema,
  dataSources: dataSourcesSchema,
};

export const HotelAreaRecommendationSchema: z.ZodType<
  HotelAreaRecommendation,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    ...recommendationBase,
    areaName: planText('areaName', 200),
    place: PlaceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.place !== undefined && !value.dataSources.includes('map_provider')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataSources'],
        message: 'recommendations with place data must include map_provider in dataSources',
      });
    }
  });

export const FoodRecommendationSchema: z.ZodType<FoodRecommendation, z.ZodTypeDef, unknown> = z
  .object({
    ...recommendationBase,
    name: planText('name', 200),
    cuisine: planText('cuisine', 100).optional(),
    place: PlaceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.place !== undefined && !value.dataSources.includes('map_provider')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dataSources'],
        message: 'recommendations with place data must include map_provider in dataSources',
      });
    }
  });

export const TripBudgetEstimateSchema: z.ZodType<TripBudgetEstimate, z.ZodTypeDef, unknown> = z
  .object({
    currency: z.literal('CNY'),
    totalCny: moneySchema,
    accommodationCny: moneySchema,
    transportationCny: moneySchema,
    foodCny: moneySchema,
    attractionsCny: moneySchema,
    otherCny: moneySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const categories =
      cents(value.accommodationCny) +
      cents(value.transportationCny) +
      cents(value.foodCny) +
      cents(value.attractionsCny) +
      cents(value.otherCny);
    if (categories !== cents(value.totalCny)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalCny'],
        message: 'totalCny must equal the sum of all category budgets',
      });
    }
  });

export const TripPlanDaySchema: z.ZodType<TripPlanDay, z.ZodTypeDef, unknown> = z
  .object({
    dayNumber: z.number().finite().int().min(1).max(MAX_TRIP_PLAN_DAYS),
    date: IsoDateSchema,
    summary: planText('summary', 2_000),
    weather: DailyWeatherSchema,
    items: z.array(TripPlanItemSchema).max(MAX_TRIP_PLAN_ITEMS_PER_DAY),
    estimatedCostCny: moneySchema,
    warnings: z.array(TripPlanWarningSchema).max(MAX_TRIP_PLAN_WARNINGS_PER_DAY),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.weather.date !== value.date) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weather', 'date'],
        message: 'weather date must match the plan day date',
      });
    }

    let previousEnd: number | undefined;
    value.items.forEach((item, index) => {
      const start = timeToMinutes(item.startTime);
      const end = timeToMinutes(item.endTime);
      if (previousEnd !== undefined && start < previousEnd) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'startTime'],
          message: 'items must be ordered by time and must not overlap',
        });
      }
      previousEnd = end;
    });

    const itemTotal = value.items.reduce((total, item) => total + cents(item.estimatedCostCny), 0);
    if (itemTotal !== cents(value.estimatedCostCny)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedCostCny'],
        message: 'estimatedCostCny must equal the sum of item costs',
      });
    }

    value.warnings.forEach((warning, index) => {
      if (warning.dayNumber !== undefined && warning.dayNumber !== value.dayNumber) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['warnings', index, 'dayNumber'],
          message: 'day warning dayNumber must match its containing day',
        });
      }
    });
  });

const budgetCategoryForItem: Record<
  TripPlanItemType,
  keyof Omit<TripBudgetEstimate, 'currency' | 'totalCny'>
> = {
  attraction: 'attractionsCny',
  food: 'foodCny',
  transport: 'transportationCny',
  hotel: 'accommodationCny',
  rest: 'otherCny',
};

export const TripPlanSchema: z.ZodType<TripPlan, z.ZodTypeDef, unknown> = z
  .object({
    schemaVersion: z.literal('1.0'),
    tripId: z.string().uuid(),
    cityName: planText('cityName', 100),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    travelerCount: z.number().finite().int().min(1).max(20),
    summary: planText('summary', 4_000),
    days: z.array(TripPlanDaySchema).min(1).max(MAX_TRIP_PLAN_DAYS),
    hotelRecommendations: z
      .array(HotelAreaRecommendationSchema)
      .max(MAX_TRIP_PLAN_HOTEL_RECOMMENDATIONS),
    foodRecommendations: z.array(FoodRecommendationSchema).max(MAX_TRIP_PLAN_FOOD_RECOMMENDATIONS),
    budget: TripBudgetEstimateSchema,
    transportationTips: tipsSchema,
    generalTips: tipsSchema,
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const startMilliseconds = isoDateMilliseconds(value.startDate);
    const endMilliseconds = isoDateMilliseconds(value.endDate);
    if (endMilliseconds < startMilliseconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must not be earlier than startDate',
      });
      return;
    }

    const durationDays =
      Math.floor((endMilliseconds - startMilliseconds) / MILLISECONDS_PER_DAY) + 1;
    if (durationDays > MAX_TRIP_PLAN_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: `trip plan must not exceed ${MAX_TRIP_PLAN_DAYS} days`,
      });
    }
    if (value.days.length !== durationDays) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['days'],
        message: 'days must contain exactly one entry for every trip date',
      });
    }

    const itemIds = new Set<string>();
    const hotelRecommendationIds = new Set<string>();
    const foodRecommendationIds = new Set<string>();
    const categoryTotals = {
      accommodationCny: 0,
      transportationCny: 0,
      foodCny: 0,
      attractionsCny: 0,
      otherCny: 0,
    };
    let daysTotalCents = 0;

    value.days.forEach((day, dayIndex) => {
      const expectedDate = addIsoDays(value.startDate, dayIndex);
      if (day.dayNumber !== dayIndex + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['days', dayIndex, 'dayNumber'],
          message: 'dayNumber must start at 1 and increase by one',
        });
      }
      if (day.date !== expectedDate) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['days', dayIndex, 'date'],
          message: 'days must cover every date in ascending order without gaps',
        });
      }

      daysTotalCents += cents(day.estimatedCostCny);
      day.items.forEach((item, itemIndex) => {
        if (itemIds.has(item.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['days', dayIndex, 'items', itemIndex, 'id'],
            message: 'item ids must be unique within a trip plan',
          });
        } else {
          itemIds.add(item.id);
        }
        categoryTotals[budgetCategoryForItem[item.type]] += cents(item.estimatedCostCny);
      });
    });

    value.hotelRecommendations.forEach((recommendation, index) => {
      if (hotelRecommendationIds.has(recommendation.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hotelRecommendations', index, 'id'],
          message: 'hotel recommendation ids must be unique',
        });
      } else {
        hotelRecommendationIds.add(recommendation.id);
      }
    });
    value.foodRecommendations.forEach((recommendation, index) => {
      if (foodRecommendationIds.has(recommendation.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['foodRecommendations', index, 'id'],
          message: 'food recommendation ids must be unique',
        });
      } else {
        foodRecommendationIds.add(recommendation.id);
      }
    });

    if (daysTotalCents !== cents(value.budget.totalCny)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['budget', 'totalCny'],
        message: 'budget total must equal the sum of daily estimates',
      });
    }

    (Object.keys(categoryTotals) as Array<keyof typeof categoryTotals>).forEach((category) => {
      if (categoryTotals[category] !== cents(value.budget[category])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['budget', category],
          message: `${category} must equal the item cost total for that category`,
        });
      }
    });
  });

/** Empty, strict request body: all context is assembled from the authenticated trip. */
export const GenerateTripPlanInputSchema: z.ZodType<GenerateTripPlanInput, z.ZodTypeDef, unknown> =
  z.object({}).strict();

export const TripPlanVersionStatusSchema: z.ZodType<TripPlanVersionStatus, z.ZodTypeDef, unknown> =
  z.enum(TRIP_PLAN_VERSION_STATUSES);

export const MAX_TRIP_PLAN_VERSIONS = 100;

const versionSchema = z
  .number({ invalid_type_error: 'version must be a number' })
  .finite({ message: 'version must be finite' })
  .int({ message: 'version must be an integer' })
  .min(1, { message: 'version must be at least 1' })
  .max(2_147_483_647, { message: 'version is too large' });

const optionalTimestampSchema = z.string().datetime({ offset: true }).optional();

export const TripPlanVersionSummarySchema: z.ZodType<
  TripPlanVersionSummary,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    id: z.string().uuid(),
    tripId: z.string().uuid(),
    version: versionSchema,
    schemaVersion: z.literal('1.0'),
    status: TripPlanVersionStatusSchema,
    generatedAt: optionalTimestampSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'ready' && value.generatedAt === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['generatedAt'],
        message: 'ready versions must contain generatedAt',
      });
    }
  });

export const TripPlanVersionListResultSchema: z.ZodType<
  TripPlanVersionListResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    items: z.array(TripPlanVersionSummarySchema).max(MAX_TRIP_PLAN_VERSIONS),
    latestVersion: versionSchema.optional(),
    plan: TripPlanSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const versions = new Set<number>();
    const tripIds = new Set(value.items.map((item) => item.tripId));
    for (const [index, item] of value.items.entries()) {
      if (versions.has(item.version)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'version'],
          message: 'version items must be unique',
        });
      }
      versions.add(item.version);
    }
    if (tripIds.size > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'all version items must belong to the same trip',
      });
    }

    if (value.latestVersion === undefined) {
      if (value.plan !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['plan'],
          message: 'plan requires latestVersion',
        });
      }
      return;
    }

    const latest = value.items.find((item) => item.version === value.latestVersion);
    if (latest === undefined || latest.status !== 'ready') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latestVersion'],
        message: 'latestVersion must reference a ready version item',
      });
      return;
    }
    if (value.items.some((item) => item.status === 'ready' && item.version > latest.version)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['latestVersion'],
        message: 'latestVersion must reference the highest ready version',
      });
    }
    if (value.plan === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan'],
        message: 'latestVersion requires its ready plan',
      });
    } else {
      if (value.plan.tripId !== latest.tripId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['plan', 'tripId'],
          message: 'plan.tripId must match the latest version item',
        });
      }
      if (latest.generatedAt !== undefined && value.plan.generatedAt !== latest.generatedAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['plan', 'generatedAt'],
          message: 'plan.generatedAt must match the latest version item',
        });
      }
    }
  });

export const TripPlanGenerationResultSchema: z.ZodType<
  TripPlanGenerationResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    version: versionSchema,
    status: TripPlanVersionStatusSchema,
    plan: TripPlanSchema.optional(),
    summary: TripPlanVersionSummarySchema,
    tripId: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.summary.version !== value.version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'version must match summary.version',
      });
    }
    if (value.summary.status !== value.status) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'status must match summary.status',
      });
    }
    if (value.summary.tripId !== value.tripId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tripId'],
        message: 'tripId must match summary.tripId',
      });
    }
    if (value.plan !== undefined && value.plan.tripId !== value.tripId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan', 'tripId'],
        message: 'plan.tripId must match tripId',
      });
    }
    if (
      value.plan !== undefined &&
      value.summary.generatedAt !== undefined &&
      value.plan.generatedAt !== value.summary.generatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan', 'generatedAt'],
        message: 'plan.generatedAt must match summary.generatedAt',
      });
    }
    if (value.status === 'ready' && value.plan === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan'],
        message: 'ready results must contain a plan',
      });
    }
    if (value.status !== 'ready' && value.plan !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan'],
        message: 'non-ready results must not contain a plan',
      });
    }
  });

const positiveSafeIntegerSchema = z
  .number({ invalid_type_error: 'value must be a number' })
  .finite({ message: 'value must be finite' })
  .int({ message: 'value must be an integer' })
  .min(1, { message: 'value must be at least 1' })
  .max(2_147_483_647, { message: 'value is too large' });

const editText = (fieldName: string, maxLength: number) =>
  createTrimmedRequiredStringSchema(fieldName, maxLength);

const editWarningsSchema: z.ZodType<TripPlanWarning[], z.ZodTypeDef, unknown> = z
  .array(TripPlanWarningSchema)
  .max(MAX_TRIP_PLAN_WARNINGS_PER_DAY)
  .refine(
    (warnings) =>
      new Set(warnings.map((warning) => JSON.stringify(warning))).size === warnings.length,
    {
      message: 'warnings must not contain duplicates',
    },
  );

const editTipsSchema: z.ZodType<string[], z.ZodTypeDef, unknown> = z
  .array(editText('tip', 500))
  .max(MAX_TRIP_PLAN_TIPS)
  .refine((tips) => new Set(tips).size === tips.length, {
    message: 'tips must not contain duplicates',
  });

/** Strict, controlled request for editing one ready immutable TripPlan version. */
export const EditTripPlanDayInputSchema: z.ZodType<EditTripPlanDayInput, z.ZodTypeDef, unknown> = z
  .object({
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    summary: editText('summary', 2_000).optional(),
    warnings: editWarningsSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.summary === undefined && value.warnings === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'each day edit must change at least one whitelisted field',
      });
    }
  });

/** Strict, controlled request for editing one existing timeline item. */
export const EditTripPlanItemInputSchema: z.ZodType<EditTripPlanItemInput, z.ZodTypeDef, unknown> =
  z
    .object({
      dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
      itemId: z.string().uuid(),
      description: editText('description', 2_000).optional(),
      recommendationReason: editText('recommendationReason', 1_000).optional(),
      tips: editTipsSchema.optional(),
      estimatedCostCny: moneySchema.optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        value.description === undefined &&
        value.recommendationReason === undefined &&
        value.tips === undefined &&
        value.estimatedCostCny === undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [],
          message: 'each item edit must change at least one whitelisted field',
        });
      }
    });

export const EditTripPlanInputSchema: z.ZodType<EditTripPlanInput, z.ZodTypeDef, unknown> = z
  .object({
    sourceVersion: positiveSafeIntegerSchema,
    summary: editText('summary', 4_000).optional(),
    dayEdits: z.array(EditTripPlanDayInputSchema).max(MAX_TRIP_PLAN_DAYS).optional(),
    itemEdits: z
      .array(EditTripPlanItemInputSchema)
      .max(MAX_TRIP_PLAN_ITEMS_PER_DAY * MAX_TRIP_PLAN_DAYS)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const dayEdits = value.dayEdits ?? [];
    const itemEdits = value.itemEdits ?? [];
    if (value.summary === undefined && dayEdits.length === 0 && itemEdits.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'at least one edit is required',
      });
    }
    const dayNumbers = new Set<number>();
    dayEdits.forEach((edit, index) => {
      if (dayNumbers.has(edit.dayNumber)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dayEdits', index, 'dayNumber'],
          message: 'dayEdits must not contain duplicate dayNumber values',
        });
      }
      dayNumbers.add(edit.dayNumber);
    });
    const itemIds = new Set<string>();
    itemEdits.forEach((edit, index) => {
      const itemKey = `${edit.dayNumber}:${edit.itemId}`;
      if (itemIds.has(itemKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['itemEdits', index, 'itemId'],
          message: 'itemEdits must not contain duplicate dayNumber/itemId pairs',
        });
      }
      itemIds.add(itemKey);
    });
  });

/** Complete immutable ready result returned by PATCH /trips/:id/plan/:version. */
export const EditTripPlanResultSchema: z.ZodType<EditTripPlanResult, z.ZodTypeDef, unknown> = z
  .object({
    tripId: z.string().uuid(),
    sourceVersion: positiveSafeIntegerSchema,
    version: positiveSafeIntegerSchema,
    status: z.literal('ready'),
    plan: TripPlanSchema,
    summary: TripPlanVersionSummarySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.version <= value.sourceVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'edit must create a strictly newer version',
      });
    }
    if (value.summary.version !== value.version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'version must match summary.version',
      });
    }
    if (value.summary.status !== 'ready') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'status'],
        message: 'edited summary must be ready',
      });
    }
    if (value.summary.tripId !== value.tripId || value.plan.tripId !== value.tripId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tripId'],
        message: 'edited result trip ids must match',
      });
    }
    if (
      value.summary.generatedAt === undefined ||
      value.plan.generatedAt !== value.summary.generatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan', 'generatedAt'],
        message: 'edited plan generatedAt must match summary.generatedAt',
      });
    }
  });

/** Strict request for listing replacement candidates for one source item. */
export const ListTripPlanItemReplacementCandidatesInputSchema: z.ZodType<
  ListTripPlanItemReplacementCandidatesInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    sourceVersion: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    itemId: z.string().uuid(),
    page: positiveSafeIntegerSchema.optional(),
    pageSize: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_ITEM_REPLACEMENT_CANDIDATES).optional(),
  })
  .strict();

export const TripPlanItemReplacementCandidateSchema: z.ZodType<
  TripPlanItemReplacementCandidate,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    place: PlaceSchema,
    recommendationReason: createTrimmedRequiredStringSchema('recommendationReason', 1_000),
    distanceMetersFromOriginal: z.number().finite().nonnegative().optional(),
  })
  .strict();

/** Strict candidate response; candidate count is bounded to avoid untrusted payload growth. */
export const TripPlanItemReplacementCandidateListSchema: z.ZodType<
  TripPlanItemReplacementCandidateList,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    items: z
      .array(TripPlanItemReplacementCandidateSchema)
      .max(MAX_TRIP_PLAN_ITEM_REPLACEMENT_CANDIDATES),
    pagination: PaginationMetaSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.items.forEach((candidate, index) => {
      if (ids.has(candidate.place.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'place', 'id'],
          message: 'replacement candidate places must be unique',
        });
      }
      ids.add(candidate.place.id);
    });
  });

/** Strict request for replacing one item with a server-verified candidate place. */
export const ReplaceTripPlanItemInputSchema: z.ZodType<
  ReplaceTripPlanItemInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    sourceVersion: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    itemId: z.string().uuid(),
    replacementPlaceId: z.string().uuid(),
  })
  .strict();

/** Complete immutable ready result returned by POST .../replace-item. */
export const ReplaceTripPlanItemResultSchema: z.ZodType<
  ReplaceTripPlanItemResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    tripId: z.string().uuid(),
    sourceVersion: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    itemId: z.string().uuid(),
    version: positiveSafeIntegerSchema,
    status: z.literal('ready'),
    plan: TripPlanSchema,
    summary: TripPlanVersionSummarySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.version <= value.sourceVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'replacement must create a strictly newer version',
      });
    }
    if (value.summary.version !== value.version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'version must match summary.version',
      });
    }
    if (
      value.summary.status !== 'ready' ||
      value.summary.tripId !== value.tripId ||
      value.plan.tripId !== value.tripId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tripId'],
        message: 'replacement result trip ids and status must match',
      });
    }
    if (
      value.summary.generatedAt === undefined ||
      value.plan.generatedAt !== value.summary.generatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan', 'generatedAt'],
        message: 'replacement plan generatedAt must match summary.generatedAt',
      });
    }
  });

const reorderItemIdsSchema: z.ZodType<string[], z.ZodTypeDef, unknown> = z
  .array(z.string().uuid())
  .min(1, { message: 'orderedItemIds must contain at least one item' })
  .max(MAX_TRIP_PLAN_ITEMS_PER_DAY)
  .refine((orderedItemIds) => new Set(orderedItemIds).size === orderedItemIds.length, {
    message: 'orderedItemIds must not contain duplicates',
  });

/** Strict request for reordering the complete timeline of one ready day. */
export const ReorderTripPlanItemsInputSchema: z.ZodType<
  ReorderTripPlanItemsInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    sourceVersion: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    orderedItemIds: reorderItemIdsSchema,
  })
  .strict();

/** Complete immutable ready result returned by POST .../reorder-items. */
export const ReorderTripPlanItemsResultSchema: z.ZodType<
  ReorderTripPlanItemsResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    tripId: z.string().uuid(),
    sourceVersion: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    version: positiveSafeIntegerSchema,
    status: z.literal('ready'),
    plan: TripPlanSchema,
    summary: TripPlanVersionSummarySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.version <= value.sourceVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'reorder must create a strictly newer version',
      });
    }
    if (value.summary.version !== value.version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'version must match summary.version',
      });
    }
    if (
      value.summary.status !== 'ready' ||
      value.summary.tripId !== value.tripId ||
      value.plan.tripId !== value.tripId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tripId'],
        message: 'reorder result trip ids and status must match',
      });
    }
    if (
      value.summary.generatedAt === undefined ||
      value.plan.generatedAt !== value.summary.generatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan', 'generatedAt'],
        message: 'reordered plan generatedAt must match summary.generatedAt',
      });
    }
  });

const auditItemIdSchema = z.string().uuid();
const auditTimeSchema = z.string().regex(TIME_PATTERN);
const auditReasonSchema = z.enum([
  'shortest_duration',
  'shortest_distance_tiebreaker',
  'destination_id_tiebreaker',
  'fixed_end',
]);
const auditWarningSchema = createTrimmedRequiredStringSchema('warning', 256);

/** Strict query input for GET .../optimize-audit. */
export const GetTripPlanOptimizationAuditInputSchema: z.ZodType<
  GetTripPlanOptimizationAuditInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    sourceVersion: positiveSafeIntegerSchema.optional(),
  })
  .strict();

const tripPlanOptimizationCandidateSchema: z.ZodType<
  TripPlanOptimizationCandidate,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    destinationItemId: auditItemIdSchema,
    status: z.enum(['available', 'unavailable']),
    durationSeconds: z.number().finite().int().nonnegative().optional(),
    distanceMeters: z.number().finite().int().nonnegative().optional(),
    rejectionReason: createOptionalTrimmedStringSchema('rejectionReason', 256),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'available') {
      if (value.durationSeconds === undefined || value.distanceMeters === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['durationSeconds'],
          message: 'available candidates require real duration and distance',
        });
      }
      if (value.rejectionReason !== undefined && value.rejectionReason !== 'fixed_end') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rejectionReason'],
          message: 'available candidates may only explain a held fixed end',
        });
      }
    } else if (value.durationSeconds !== undefined || value.distanceMeters !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'unavailable candidates must not carry measurements',
      });
    }
  });

const tripPlanOptimizationDecisionSchema: z.ZodType<
  TripPlanOptimizationDecision,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    step: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_ITEMS_PER_DAY),
    originItemId: auditItemIdSchema,
    selectedDestinationItemId: auditItemIdSchema,
    reason: auditReasonSchema,
    candidates: z
      .array(tripPlanOptimizationCandidateSchema)
      .min(1)
      .max(MAX_TRIP_PLAN_ITEMS_PER_DAY),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.originItemId === value.selectedDestinationItemId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedDestinationItemId'],
        message: 'decision must not select its origin',
      });
    }
    if (
      !value.candidates.some(
        (candidate) => candidate.destinationItemId === value.selectedDestinationItemId,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedDestinationItemId'],
        message: 'selected destination must be listed as a candidate',
      });
    }
    const ids = new Set<string>();
    value.candidates.forEach((candidate, index) => {
      if (ids.has(candidate.destinationItemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['candidates', index, 'destinationItemId'],
          message: 'candidates must be unique',
        });
      }
      ids.add(candidate.destinationItemId);
    });
  });

const tripPlanOptimizationTimelineChangeSchema: z.ZodType<
  TripPlanOptimizationTimelineChange,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    itemId: auditItemIdSchema,
    previousStartTime: auditTimeSchema,
    previousEndTime: auditTimeSchema,
    nextStartTime: auditTimeSchema,
    nextEndTime: auditTimeSchema,
    routeStatus: z.enum(['available', 'unavailable', 'not_applicable']),
    routeDurationSeconds: z.number().finite().int().nonnegative().optional(),
    routeDistanceMeters: z.number().finite().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.routeStatus === 'available') {
      if (value.routeDurationSeconds === undefined || value.routeDistanceMeters === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['routeDurationSeconds'],
          message: 'available timeline routes require real measurements',
        });
      }
    } else if (
      value.routeDurationSeconds !== undefined ||
      value.routeDistanceMeters !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['routeStatus'],
        message: 'non-available timeline routes must not carry measurements',
      });
    }
  });

export const TripPlanOptimizationCandidateSchema = tripPlanOptimizationCandidateSchema;
export const TripPlanOptimizationDecisionSchema = tripPlanOptimizationDecisionSchema;
export const TripPlanOptimizationTimelineChangeSchema = tripPlanOptimizationTimelineChangeSchema;

export const TripPlanOptimizationAuditResultSchema: z.ZodType<
  TripPlanOptimizationAuditResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    tripId: z.string().uuid(),
    version: positiveSafeIntegerSchema,
    sourceVersion: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    mode: z.enum(['walking', 'driving']),
    algorithm: z.literal('nearest_neighbor'),
    isOptimal: z.literal(false),
    orderedItemIds: z.array(auditItemIdSchema).min(1).max(MAX_TRIP_PLAN_ITEMS_PER_DAY),
    fixedStartItemId: auditItemIdSchema.optional(),
    fixedEndItemId: auditItemIdSchema.optional(),
    decisions: z.array(tripPlanOptimizationDecisionSchema).max(MAX_TRIP_PLAN_ITEMS_PER_DAY),
    timelineChanges: z
      .array(tripPlanOptimizationTimelineChangeSchema)
      .min(1)
      .max(MAX_TRIP_PLAN_ITEMS_PER_DAY),
    warnings: z
      .array(auditWarningSchema)
      .min(1)
      .max(32)
      .refine(
        (warnings) =>
          warnings.some((warning) => /nearest[- ]neighbor/i.test(warning)) &&
          warnings.some((warning) =>
            /not globally optimal|does not guarantee (?:a )?globally optimal/i.test(warning),
          ),
        { message: 'warnings must explain nearest-neighbor is not globally optimal' },
      ),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.fixedStartItemId !== undefined &&
      value.fixedEndItemId !== undefined &&
      value.fixedStartItemId === value.fixedEndItemId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixedEndItemId'],
        message: 'fixed start and end must differ',
      });
    }
    if (new Set(value.orderedItemIds).size !== value.orderedItemIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['orderedItemIds'],
        message: 'orderedItemIds must be unique',
      });
    }
    const directSequence = value.decisions.length === value.orderedItemIds.length - 1;
    value.decisions.forEach((decision, index) => {
      const expectedOrigin = directSequence
        ? value.orderedItemIds[index]
        : index === 0
          ? decision.originItemId
          : value.decisions[index - 1]?.selectedDestinationItemId;
      const expectedDestination = directSequence
        ? value.orderedItemIds[index + 1]
        : decision.selectedDestinationItemId;
      if (
        decision.step !== index + 1 ||
        decision.originItemId !== expectedOrigin ||
        (directSequence
          ? decision.selectedDestinationItemId !== expectedDestination
          : decision.selectedDestinationItemId === decision.originItemId ||
            !value.orderedItemIds.includes(decision.originItemId) ||
            !value.orderedItemIds.includes(decision.selectedDestinationItemId))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['decisions', index],
          message: 'decisions must reference orderedItemIds in final order',
        });
      }
    });
    if (
      value.fixedStartItemId !== undefined &&
      value.decisions[0]?.originItemId !== value.fixedStartItemId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixedStartItemId'],
        message: 'fixed start must match the first real route decision',
      });
    }
    if (
      value.fixedEndItemId !== undefined &&
      value.decisions[value.decisions.length - 1]?.selectedDestinationItemId !==
        value.fixedEndItemId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixedEndItemId'],
        message: 'fixed end must match the last real route decision',
      });
    }
    const timelineIds = new Set<string>();
    value.timelineChanges.forEach((change, index) => {
      if (!value.orderedItemIds.includes(change.itemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timelineChanges', index, 'itemId'],
          message: 'timeline change must reference orderedItemIds',
        });
      }
      if (timelineIds.has(change.itemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timelineChanges', index, 'itemId'],
          message: 'timeline changes must be unique',
        });
      }
      timelineIds.add(change.itemId);
    });
  });

export const TripPlanItemReplacementCandidateListResultSchema =
  TripPlanItemReplacementCandidateListSchema;
export const TripPlanItemReplacementInputSchema = ReplaceTripPlanItemInputSchema;
export const TripPlanItemReplacementResultSchema = ReplaceTripPlanItemResultSchema;

/** Strict, normalized request body for POST /trips/:id/regenerate-day. */
export const RegenerateTripPlanDayInputSchema: z.ZodType<
  RegenerateTripPlanDayInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    sourceVersion: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    instruction: createOptionalTrimmedStringSchema('instruction', 500),
  })
  .strict();

/** Complete immutable replacement version returned by the day endpoint. */
export const RegenerateTripPlanDayResultSchema: z.ZodType<
  RegenerateTripPlanDayResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    version: positiveSafeIntegerSchema,
    status: TripPlanVersionStatusSchema,
    plan: TripPlanSchema.optional(),
    summary: TripPlanVersionSummarySchema,
    tripId: z.string().uuid(),
    sourceVersion: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.summary.version !== value.version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'version must match summary.version',
      });
    }
    if (value.summary.status !== value.status) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'status must match summary.status',
      });
    }
    if (value.summary.tripId !== value.tripId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tripId'],
        message: 'tripId must match summary.tripId',
      });
    }
    if (value.plan !== undefined && value.plan.tripId !== value.tripId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan', 'tripId'],
        message: 'plan.tripId must match tripId',
      });
    }
    if (
      value.plan !== undefined &&
      value.summary.generatedAt !== undefined &&
      value.plan.generatedAt !== value.summary.generatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan', 'generatedAt'],
        message: 'plan.generatedAt must match summary.generatedAt',
      });
    }
    if (value.status === 'ready' && value.plan === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan'],
        message: 'ready results must contain a plan',
      });
    }
    if (value.status !== 'ready' && value.plan !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan'],
        message: 'non-ready results must not contain a plan',
      });
    }
  });

const tripPlanItemChangeTypeSchema: z.ZodType<TripPlanItemChangeType, z.ZodTypeDef, unknown> =
  z.enum(TRIP_PLAN_ITEM_CHANGE_TYPES);

const tripPlanItemChangeFieldSchema: z.ZodType<TripPlanItemChangeField, z.ZodTypeDef, unknown> =
  z.enum(TRIP_PLAN_ITEM_CHANGE_FIELDS);

const tripPlanDayChangeFieldSchema: z.ZodType<
  TripPlanDayChangeField | TripPlanRootChangeField,
  z.ZodTypeDef,
  unknown
> = z.enum([...TRIP_PLAN_DAY_CHANGE_FIELDS, ...TRIP_PLAN_ROOT_CHANGE_FIELDS] as [
  TripPlanDayChangeField | TripPlanRootChangeField,
  ...(TripPlanDayChangeField | TripPlanRootChangeField)[],
]);

const tripPlanBudgetChangeFieldSchema = z.enum(TRIP_PLAN_BUDGET_CHANGE_FIELDS);

export const TripPlanItemChangeTypeSchema = tripPlanItemChangeTypeSchema;
export const TripPlanItemChangeFieldSchema = tripPlanItemChangeFieldSchema;
export const TripPlanDayChangeFieldSchema = tripPlanDayChangeFieldSchema;
export const TripPlanBudgetChangeFieldSchema = tripPlanBudgetChangeFieldSchema;

export const TripPlanVersionDiffInputSchema: z.ZodType<
  TripPlanVersionDiffInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    fromVersion: versionSchema,
    toVersion: versionSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fromVersion === value.toVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toVersion'],
        message: 'fromVersion and toVersion must be different',
      });
    }
  });

export const TripPlanItemChangeSchema: z.ZodType<TripPlanItemChange, z.ZodTypeDef, unknown> = z
  .object({
    dayNumber: z.number().finite().int().min(1).max(MAX_TRIP_PLAN_DAYS),
    itemId: z.string().uuid(),
    changeType: tripPlanItemChangeTypeSchema,
    changedFields: z.array(tripPlanItemChangeFieldSchema).max(TRIP_PLAN_ITEM_CHANGE_FIELDS.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.changeType === 'modified' && value.changedFields.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['changedFields'],
        message: 'modified items must list changed fields',
      });
    }
    if (value.changeType !== 'modified' && value.changedFields.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['changedFields'],
        message: 'added or removed items must not list modified fields',
      });
    }
    if (new Set(value.changedFields).size !== value.changedFields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['changedFields'],
        message: 'changedFields must not contain duplicates',
      });
    }
  });

export const TripPlanDayChangeSchema: z.ZodType<TripPlanDayChange, z.ZodTypeDef, unknown> = z
  .object({
    // dayNumber 0 is a deterministic plan-level bucket for global tips and recommendations.
    dayNumber: z.number().finite().int().min(0).max(MAX_TRIP_PLAN_DAYS),
    changedFields: z
      .array(tripPlanDayChangeFieldSchema)
      .max(TRIP_PLAN_DAY_CHANGE_FIELDS.length + TRIP_PLAN_ROOT_CHANGE_FIELDS.length),
    itemChanges: z.array(TripPlanItemChangeSchema).max(MAX_TRIP_PLAN_DIFF_ITEM_CHANGES),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.changedFields).size !== value.changedFields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['changedFields'],
        message: 'changedFields must not contain duplicates',
      });
    }
    if (value.dayNumber === 0 && value.itemChanges.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itemChanges'],
        message: 'plan-level changes cannot contain item changes',
      });
    }
  });

export const TripPlanBudgetDiffSchema: z.ZodType<TripPlanBudgetDiff, z.ZodTypeDef, unknown> = z
  .object({
    beforeTotalCny: moneySchema,
    afterTotalCny: moneySchema,
    changedFields: z
      .array(tripPlanBudgetChangeFieldSchema)
      .min(1)
      .max(TRIP_PLAN_BUDGET_CHANGE_FIELDS.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.changedFields).size !== value.changedFields.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['changedFields'],
        message: 'changedFields must not contain duplicates',
      });
    }
  });

export const TripPlanVersionDiffResultSchema: z.ZodType<
  TripPlanVersionDiffResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    tripId: z.string().uuid(),
    fromVersion: versionSchema,
    toVersion: versionSchema,
    dayChanges: z.array(TripPlanDayChangeSchema).max(MAX_TRIP_PLAN_DIFF_DAY_CHANGES),
    budgetDiff: TripPlanBudgetDiffSchema.optional(),
    hasChanges: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fromVersion === value.toVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toVersion'],
        message: 'fromVersion and toVersion must be different',
      });
    }
    const computed = value.dayChanges.length > 0 || value.budgetDiff !== undefined;
    if (computed !== value.hasChanges) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hasChanges'],
        message: 'hasChanges must match the diff contents',
      });
    }
    const itemChangeCount = value.dayChanges.reduce(
      (total, day) => total + day.itemChanges.length,
      0,
    );
    if (itemChangeCount > MAX_TRIP_PLAN_DIFF_ITEM_CHANGES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dayChanges'],
        message: 'item diff exceeds the supported limit',
      });
    }
  });

/** Alias kept for callers that use the shorter result name. */
export const TripPlanDiffResultSchema = TripPlanVersionDiffResultSchema;
export const TripPlanDiffInputSchema = TripPlanVersionDiffInputSchema;

export const RestoreTripPlanVersionInputSchema: z.ZodType<
  RestoreTripPlanVersionInput,
  z.ZodTypeDef,
  unknown
> = z.object({}).strict();

export const RestoreTripPlanVersionResultSchema: z.ZodType<
  RestoreTripPlanVersionResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    tripId: z.string().uuid(),
    sourceVersion: versionSchema,
    version: versionSchema,
    status: z.literal('ready'),
    plan: TripPlanSchema,
    summary: TripPlanVersionSummarySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.summary.version !== value.version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'version must match summary.version',
      });
    }
    if (value.summary.status !== 'ready') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'status'],
        message: 'restored summary must be ready',
      });
    }
    if (value.summary.tripId !== value.tripId || value.plan.tripId !== value.tripId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tripId'],
        message: 'restored result trip ids must match',
      });
    }
    if (
      value.summary.generatedAt === undefined ||
      value.plan.generatedAt !== value.summary.generatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan', 'generatedAt'],
        message: 'restored plan generatedAt must match summary.generatedAt',
      });
    }
    if (value.version <= value.sourceVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'restore must create a strictly newer version',
      });
    }
  });

/** Alias kept for callers that use the TripPlan-prefixed result name. */
export const TripPlanRestoreVersionResultSchema = RestoreTripPlanVersionResultSchema;
export const TripPlanRestoreVersionInputSchema = RestoreTripPlanVersionInputSchema;

/** Strict request for deterministic same-day route optimization. */
export const OptimizeTripPlanDayInputSchema: z.ZodType<
  OptimizeTripPlanDayInput,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    sourceVersion: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    startItemId: z.string().uuid().optional(),
    endItemId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startItemId !== undefined && value.startItemId === value.endItemId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endItemId'],
        message: 'startItemId and endItemId must be different',
      });
    }
  });

/** Complete immutable ready result returned by the optimization endpoint. */
export const OptimizeTripPlanDayResultSchema: z.ZodType<
  OptimizeTripPlanDayResult,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    tripId: z.string().uuid(),
    sourceVersion: positiveSafeIntegerSchema,
    version: positiveSafeIntegerSchema,
    dayNumber: positiveSafeIntegerSchema.max(MAX_TRIP_PLAN_DAYS),
    status: z.literal('ready'),
    plan: TripPlanSchema,
    summary: TripPlanVersionSummarySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.version <= value.sourceVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: 'optimization must create a strictly newer version',
      });
    }
    if (value.summary.version !== value.version) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'version'],
        message: 'summary.version must match version',
      });
    }
    if (value.summary.status !== 'ready') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary', 'status'],
        message: 'summary.status must be ready',
      });
    }
    if (value.summary.tripId !== value.tripId || value.plan.tripId !== value.tripId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tripId'],
        message: 'result trip ids must match',
      });
    }
    if (
      value.summary.generatedAt === undefined ||
      value.plan.generatedAt !== value.summary.generatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plan', 'generatedAt'],
        message: 'plan.generatedAt must match summary.generatedAt',
      });
    }
    const targetDay = value.plan.days.find((day) => day.dayNumber === value.dayNumber);
    if (targetDay === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dayNumber'],
        message: 'dayNumber must reference a plan day',
      });
    }
  });

export {
  compareTripPlanVersions,
  withTripPlanVersionDiffVersions,
  TripPlanDiffValidationError,
} from '@travel-guide/shared-types';

export {
  MAX_TRIP_PLAN_DIFF_DAY_CHANGES,
  MAX_TRIP_PLAN_DIFF_FIELDS,
  MAX_TRIP_PLAN_DIFF_ITEM_CHANGES,
} from '@travel-guide/shared-types';

export {
  MAX_TRIP_PLAN_DAYS as TRIP_PLAN_MAX_DAYS,
  MAX_TRIP_PLAN_ITEMS_PER_DAY as TRIP_PLAN_MAX_ITEMS_PER_DAY,
};
