import { z } from 'zod';

import type {
  CreateTripInput,
  DestinationInput,
  TripBudgetInput,
} from '@travel-guide/shared-types';

import {
  BudgetLevelSchema,
  createOptionalTrimmedStringSchema,
  createTrimmedRequiredStringSchema,
  TravelPaceSchema,
  TransportPreferenceSchema,
  TravelPreferenceSchema,
} from './common.schema';

export const MAX_CUSTOM_BUDGET_CNY = 10_000_000;
export const MAX_TRIP_DURATION_DAYS = 14;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

const parseIsoDateParts = (value: string): [number, number, number] | undefined => {
  if (!ISO_DATE_PATTERN.test(value)) {
    return undefined;
  }

  const [yearText, monthText, dayText] = value.split('-');
  return [Number(yearText), Number(monthText), Number(dayText)];
};

const utcMillisecondsForDate = (year: number, month: number, day: number): number => {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
};

const isValidIsoDate = (value: string): boolean => {
  const parts = parseIsoDateParts(value);
  if (parts === undefined) {
    return false;
  }

  const [year, month, day] = parts;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const milliseconds = utcMillisecondsForDate(year, month, day);
  const date = new Date(milliseconds);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

const utcMillisecondsForIsoDate = (value: string): number => {
  const parts = parseIsoDateParts(value);
  if (parts === undefined) {
    return Number.NaN;
  }

  return utcMillisecondsForDate(parts[0], parts[1], parts[2]);
};

export const IsoDateSchema = z
  .string({ invalid_type_error: 'date must be a string' })
  .refine(isValidIsoDate, {
    message: 'date must be a valid calendar date in YYYY-MM-DD format',
  });

export const ISODateSchema = IsoDateSchema;

const customBudgetAmountSchema = z
  .number({ invalid_type_error: 'totalCny must be a number' })
  .finite({ message: 'totalCny must be finite' })
  .gt(0, { message: 'totalCny must be greater than 0' })
  .lte(MAX_CUSTOM_BUDGET_CNY, {
    message: `totalCny must be at most ${MAX_CUSTOM_BUDGET_CNY}`,
  })
  .refine(
    (value) => {
      const scaled = value * 100;
      const roundingError = Math.abs(scaled - Math.round(scaled));
      return roundingError <= Number.EPSILON * Math.max(1, Math.abs(scaled)) * 10;
    },
    { message: 'totalCny must have at most two decimal places' },
  );

export const TripBudgetInputSchema: z.ZodType<TripBudgetInput, z.ZodTypeDef, unknown> =
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('level'),
        level: BudgetLevelSchema,
        currency: z.literal('CNY'),
      })
      .strict(),
    z
      .object({
        type: z.literal('custom'),
        totalCny: customBudgetAmountSchema,
        currency: z.literal('CNY'),
      })
      .strict(),
  ]);

export const DestinationInputSchema: z.ZodType<DestinationInput, z.ZodTypeDef, unknown> = z
  .object({
    cityName: createTrimmedRequiredStringSchema('cityName', 100),
    cityCode: createOptionalTrimmedStringSchema('cityCode', 20),
  })
  .strict();

const createTripInputObjectSchema = z
  .object({
    destination: DestinationInputSchema,
    origin: createOptionalTrimmedStringSchema('origin', 100),
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    travelerCount: z
      .number({ invalid_type_error: 'travelerCount must be a number' })
      .finite({ message: 'travelerCount must be finite' })
      .int({ message: 'travelerCount must be an integer' })
      .min(1, { message: 'travelerCount must be at least 1' })
      .max(20, { message: 'travelerCount must be at most 20' }),
    preferences: z
      .array(TravelPreferenceSchema, { invalid_type_error: 'preferences must be an array' })
      .min(1, { message: 'preferences must contain at least one item' })
      .max(14, { message: 'preferences must contain at most 14 items' })
      .refine((preferences) => new Set(preferences).size === preferences.length, {
        message: 'preferences must not contain duplicates',
      }),
    pace: TravelPaceSchema,
    budget: TripBudgetInputSchema.optional(),
    transportPreference: TransportPreferenceSchema,
    extraRequirements: createOptionalTrimmedStringSchema('extraRequirements', 1000),
  })
  .strict()
  .superRefine((value, context) => {
    if (!isValidIsoDate(value.startDate) || !isValidIsoDate(value.endDate)) {
      return;
    }

    const startMilliseconds = utcMillisecondsForIsoDate(value.startDate);
    const endMilliseconds = utcMillisecondsForIsoDate(value.endDate);
    const durationDays =
      Math.round((endMilliseconds - startMilliseconds) / MILLISECONDS_PER_DAY) + 1;

    if (endMilliseconds < startMilliseconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must not be earlier than startDate',
      });
    } else if (durationDays > MAX_TRIP_DURATION_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: `trip duration must not exceed ${MAX_TRIP_DURATION_DAYS} days`,
      });
    }
  });

export const CreateTripInputSchema: z.ZodType<CreateTripInput, z.ZodTypeDef, unknown> =
  createTripInputObjectSchema;

// Export the object form for composing the strict PATCH schema while keeping
// CreateTripInputSchema as the public typed contract.
export const CreateTripInputObjectSchema = createTripInputObjectSchema;
