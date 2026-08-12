import { z } from 'zod';

import {
  CreateTripInputSchema,
  DailyWeatherSchema,
  PlaceSchema,
  RouteEstimateSchema,
  RouteOrderResultSchema,
  TripPlanDaySchema,
  TripPlanSchema,
} from '@travel-guide/shared-schemas';

import { createOptionalTrimmedStringSchema } from '@travel-guide/shared-schemas';
import type { TripPlanDayRegenerationContext } from './trip-plan-day-regeneration.types';

const safeInteger = z
  .number({ invalid_type_error: 'value must be a number' })
  .finite({ message: 'value must be finite' })
  .int({ message: 'value must be an integer' })
  .min(1)
  .max(2_147_483_647);

const dayNumber = safeInteger.max(14);

/** Strict server-only context; no HTTP caller can provide this object. */
export const TripPlanDayRegenerationContextSchema: z.ZodType<
  TripPlanDayRegenerationContext,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    tripId: z.string().uuid(),
    input: CreateTripInputSchema,
    sourceVersion: safeInteger,
    sourcePlan: TripPlanSchema,
    dayNumber,
    targetDay: TripPlanDaySchema,
    adjacentDays: z.array(TripPlanDaySchema).max(14),
    instruction: createOptionalTrimmedStringSchema('instruction', 500),
    weather: z.array(DailyWeatherSchema).max(14),
    candidatePlaces: z.array(PlaceSchema).max(100),
    routeEstimates: z.array(RouteEstimateSchema).max(200),
    routeOrders: z.array(RouteOrderResultSchema).max(10).optional(),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourcePlan.tripId !== value.tripId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourcePlan', 'tripId'],
        message: 'sourcePlan.tripId must match tripId',
      });
    }
    if (
      value.sourcePlan.cityName !== value.input.destination.cityName ||
      value.sourcePlan.startDate !== value.input.startDate ||
      value.sourcePlan.endDate !== value.input.endDate ||
      value.sourcePlan.travelerCount !== value.input.travelerCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourcePlan'],
        message: 'sourcePlan metadata must match the trip input',
      });
    }
    const target = value.sourcePlan.days.find((day) => day.dayNumber === value.dayNumber);
    if (target === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dayNumber'],
        message: 'dayNumber must exist in sourcePlan',
      });
    } else if (target.date !== value.targetDay.date) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetDay', 'date'],
        message: 'targetDay must match sourcePlan',
      });
    }
    if (value.targetDay.dayNumber !== value.dayNumber) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetDay', 'dayNumber'],
        message: 'targetDay.dayNumber must match dayNumber',
      });
    }
    const weatherDates = new Set(value.weather.map((day) => day.date));
    if (!weatherDates.has(value.targetDay.date)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weather'],
        message: 'weather must include the target day date',
      });
    }
    if (value.candidatePlaces.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidatePlaces'],
        message: 'candidatePlaces must contain verified entities',
      });
    }
    const expectedAdjacentDays = new Set([value.dayNumber - 1, value.dayNumber + 1]);
    const actualAdjacentDays = value.adjacentDays.map((day) => day.dayNumber);
    if (
      actualAdjacentDays.some((dayNumber) => !expectedAdjacentDays.has(dayNumber)) ||
      new Set(actualAdjacentDays).size !== actualAdjacentDays.length ||
      actualAdjacentDays.some(
        (dayNumber, index) => index > 0 && actualAdjacentDays[index - 1]! >= dayNumber,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['adjacentDays'],
        message: 'adjacentDays must contain only sorted immediate neighbors',
      });
    }
  });

export const RegenerateTripPlanDayContextSchema = TripPlanDayRegenerationContextSchema;
