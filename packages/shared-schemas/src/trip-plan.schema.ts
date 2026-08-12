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
  type TripPlanGenerationResult,
  type TripPlanVersionListResult,
  type TripPlanVersionStatus,
  type TripPlanVersionSummary,
  TRIP_PLAN_VERSION_STATUSES,
} from '@travel-guide/shared-types';

import { PlaceSchema } from './place.schema';
import { RouteEstimateSchema } from './route.schema';
import {
  createOptionalTrimmedStringSchema,
  createTrimmedRequiredStringSchema,
} from './common.schema';
import { IsoDateSchema } from './trip-input.schema';
import { DailyWeatherSchema } from './weather.schema';

export const MAX_TRIP_PLAN_DAYS = 14;
export const MAX_TRIP_PLAN_ITEMS_PER_DAY = 20;
export const MAX_TRIP_PLAN_HOTEL_RECOMMENDATIONS = 10;
export const MAX_TRIP_PLAN_FOOD_RECOMMENDATIONS = 20;
export const MAX_TRIP_PLAN_TIPS = 20;
export const MAX_TRIP_PLAN_WARNINGS_PER_DAY = 20;
export const MAX_TRIP_PLAN_MONEY_CNY = 100_000_000;

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

export {
  MAX_TRIP_PLAN_DAYS as TRIP_PLAN_MAX_DAYS,
  MAX_TRIP_PLAN_ITEMS_PER_DAY as TRIP_PLAN_MAX_ITEMS_PER_DAY,
};
