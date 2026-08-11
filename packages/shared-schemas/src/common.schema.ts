import { z } from 'zod';

import {
  BUDGET_LEVELS,
  TRAVEL_PACES,
  TRAVEL_PREFERENCES,
  TRANSPORT_PREFERENCES,
} from '@travel-guide/shared-types';

export const TravelPreferenceSchema = z.enum(TRAVEL_PREFERENCES);
export const TravelPaceSchema = z.enum(TRAVEL_PACES);
export const TransportPreferenceSchema = z.enum(TRANSPORT_PREFERENCES);
export const BudgetLevelSchema = z.enum(BUDGET_LEVELS);

export const emptyStringToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

export const createTrimmedRequiredStringSchema = (
  fieldName: string,
  maxLength: number,
): z.ZodString =>
  z
    .string({ invalid_type_error: `${fieldName} must be a string` })
    .trim()
    .min(1, { message: `${fieldName} must not be empty` })
    .max(maxLength, { message: `${fieldName} must be at most ${maxLength} characters` });

export const createOptionalTrimmedStringSchema = (
  fieldName: string,
  maxLength: number,
): z.ZodType<string | undefined, z.ZodTypeDef, unknown> =>
  z.preprocess(
    emptyStringToUndefined,
    z
      .string({ invalid_type_error: `${fieldName} must be a string` })
      .trim()
      .max(maxLength, { message: `${fieldName} must be at most ${maxLength} characters` })
      .optional(),
  );
