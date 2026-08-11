import { z } from 'zod';

import {
  CreateTripInputSchema,
  DailyWeatherSchema,
  PlaceSchema,
  RouteEstimateSchema,
  RouteOrderResultSchema,
} from '@travel-guide/shared-schemas';
import type { TripPlanGenerationContext } from './trip-plan-generation.types';

export const MAX_CONTEXT_PLACES = 100;
export const MAX_CONTEXT_ROUTE_ESTIMATES = 200;
export const MAX_CONTEXT_ROUTE_ORDERS = 10;

const weatherContextSchema = z.array(DailyWeatherSchema).max(14);
const placeContextSchema = z.array(PlaceSchema).max(MAX_CONTEXT_PLACES);
const routeContextSchema = z.array(RouteEstimateSchema).max(MAX_CONTEXT_ROUTE_ESTIMATES);
const routeOrderContextSchema = z.array(RouteOrderResultSchema).max(MAX_CONTEXT_ROUTE_ORDERS);

const dateToUtc = (value: string): number => {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

const dateFromUtc = (milliseconds: number): string =>
  new Date(milliseconds).toISOString().slice(0, 10);

export const TripPlanGenerationContextSchema: z.ZodType<
  TripPlanGenerationContext,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    tripId: z.string().uuid(),
    input: CreateTripInputSchema,
    weather: weatherContextSchema,
    candidatePlaces: placeContextSchema,
    routeEstimates: routeContextSchema,
    routeOrders: routeOrderContextSchema.optional(),
    generatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const weatherDates = new Set<string>();
    for (const [index, weather] of value.weather.entries()) {
      if (weatherDates.has(weather.date)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['weather', index, 'date'],
          message: 'weather dates must be unique',
        });
      }
      weatherDates.add(weather.date);
      if (weather.date < value.input.startDate || weather.date > value.input.endDate) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['weather', index, 'date'],
          message: 'weather date must be within the requested trip range',
        });
      }
    }

    const placeIds = new Set<string>();
    const providerPlaceIds = new Set<string>();
    for (const [index, place] of value.candidatePlaces.entries()) {
      if (placeIds.has(place.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['candidatePlaces', index, 'id'],
          message: 'candidate place ids must be unique',
        });
      }
      placeIds.add(place.id);
      const providerPlaceId = `${place.provider}\u0000${place.providerPlaceId}`;
      if (providerPlaceIds.has(providerPlaceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['candidatePlaces', index, 'providerPlaceId'],
          message: 'candidate provider place ids must be unique per provider',
        });
      }
      providerPlaceIds.add(providerPlaceId);
    }

    const start = dateToUtc(value.input.startDate);
    const end = dateToUtc(value.input.endDate);
    const requestedDays = Math.floor((end - start) / 86_400_000) + 1;
    if (value.weather.length !== requestedDays) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weather'],
        message: 'weather must contain exactly one entry for every requested trip date',
      });
    }
    for (let dayOffset = 0; dayOffset < requestedDays; dayOffset += 1) {
      const expectedDate = dateFromUtc(start + dayOffset * 86_400_000);
      if (!weatherDates.has(expectedDate)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['weather'],
          message: `weather is missing requested date ${expectedDate}`,
        });
      }
    }
  });
