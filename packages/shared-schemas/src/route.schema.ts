import { z } from 'zod';

import {
  ROUTE_DATA_SOURCES,
  ROUTE_MODES,
  type AvailableRouteEstimate,
  type EstimateRouteInput,
  type RouteDataSource,
  type RouteEndpoint,
  type RouteEstimate,
  type RouteMode,
  type UnavailableRouteEstimate,
} from '@travel-guide/shared-types';

import {
  createOptionalTrimmedStringSchema,
  createTrimmedRequiredStringSchema,
} from './common.schema';
import { GeoPointSchema } from './place.schema';

export const RouteModeSchema: z.ZodType<RouteMode, z.ZodTypeDef, unknown> = z.enum(ROUTE_MODES);

export const RouteDataSourceSchema: z.ZodType<RouteDataSource, z.ZodTypeDef, unknown> =
  z.enum(ROUTE_DATA_SOURCES);

export const RouteEndpointSchema: z.ZodType<RouteEndpoint, z.ZodTypeDef, unknown> = z
  .object({
    location: GeoPointSchema,
    placeId: createOptionalTrimmedStringSchema('placeId', 128),
  })
  .strict();

export const EstimateRouteInputSchema: z.ZodType<EstimateRouteInput, z.ZodTypeDef, unknown> = z
  .object({
    origin: RouteEndpointSchema,
    destination: RouteEndpointSchema,
    mode: RouteModeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.origin.location.longitude === value.destination.location.longitude &&
      value.origin.location.latitude === value.destination.location.latitude
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'location'],
        message: 'origin and destination must be different',
      });
    }
  });

const nonNegativeIntegerSchema = z.number().finite().int().nonnegative();

const tollsSchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => Math.round(value * 100) / 100 === value, {
    message: 'tollsCny must have at most two decimal places',
  });

const routeEstimateBaseSchema = z.object({
  origin: RouteEndpointSchema,
  destination: RouteEndpointSchema,
  mode: RouteModeSchema,
  provider: createTrimmedRequiredStringSchema('provider', 64),
  fetchedAt: z.string().datetime({ offset: true }),
});

const availableRouteEstimateSchema: z.ZodType<AvailableRouteEstimate, z.ZodTypeDef, unknown> =
  routeEstimateBaseSchema
    .extend({
      dataSource: z.enum(['map_provider', 'cache']),
      distanceMeters: nonNegativeIntegerSchema,
      durationSeconds: nonNegativeIntegerSchema,
      tollsCny: tollsSchema.optional(),
    })
    .strict();

const unavailableRouteEstimateSchema: z.ZodType<UnavailableRouteEstimate, z.ZodTypeDef, unknown> =
  routeEstimateBaseSchema
    .extend({
      dataSource: z.literal('unavailable'),
    })
    .strict();

export const RouteEstimateSchema: z.ZodType<RouteEstimate, z.ZodTypeDef, unknown> = z
  .union([availableRouteEstimateSchema, unavailableRouteEstimateSchema])
  .superRefine((value, context) => {
    if (
      value.origin.location.longitude === value.destination.location.longitude &&
      value.origin.location.latitude === value.destination.location.latitude
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'location'],
        message: 'origin and destination must be different',
      });
    }
  });

export { GeoPointSchema };
