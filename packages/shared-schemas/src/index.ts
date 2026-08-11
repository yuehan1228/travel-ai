export * from './api.schema';
export * from './auth.schema';
export * from './common.schema';
export * from './trip-input.schema';
export * from './trip.schema';
export * from './weather.schema';
export * from './place.schema';
export * from './route.schema';

import { z } from 'zod';

import type { HealthResponse } from '@travel-guide/shared-types';

export const HealthResponseSchema: z.ZodType<HealthResponse> = z.object({
  status: z.literal('ok'),
  environment: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
});
