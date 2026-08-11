import { z } from 'zod';

import { EstimateRouteInputSchema } from '@travel-guide/shared-schemas';
import type { EstimateRouteInput } from '@travel-guide/shared-types';

export interface RouteProviderResult {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly tollsCny?: number;
  readonly fetchedAt: string;
}

export interface RouteProvider {
  readonly name: string;
  estimateRoute(input: EstimateRouteInput): Promise<RouteProviderResult | undefined>;
}

export const RouteProviderResultSchema: z.ZodType<RouteProviderResult, z.ZodTypeDef, unknown> = z
  .object({
    distanceMeters: z.number().finite().int().nonnegative(),
    durationSeconds: z.number().finite().int().nonnegative(),
    tollsCny: z
      .number()
      .finite()
      .nonnegative()
      .refine((value) => Math.round(value * 100) / 100 === value)
      .optional(),
    fetchedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const parseRouteProviderInput = (input: EstimateRouteInput): EstimateRouteInput =>
  EstimateRouteInputSchema.parse(input);
