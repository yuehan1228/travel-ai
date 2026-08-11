import { z } from 'zod';

const DEFAULT_PROVIDER = 'amap';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_SECONDS = 3_600;

const placeEnvironmentSchema = z.object({
  PLACE_PROVIDER: z.literal(DEFAULT_PROVIDER),
  PLACE_API_KEY: z.string().trim().min(1).max(512),
  PLACE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(30_000)
    .default(DEFAULT_TIMEOUT_MS),
  PLACE_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 60 * 60)
    .default(DEFAULT_CACHE_TTL_SECONDS),
});

export interface PlaceEnvironment {
  readonly provider: string;
  readonly apiKey: string;
  readonly requestTimeoutMs: number;
  readonly cacheTtlSeconds: number;
}

const formatEnvironmentError = (error: z.ZodError): Error => {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');
  return new Error(`Invalid place environment configuration: ${issues}`);
};

export function loadPlaceEnvironment(env: NodeJS.ProcessEnv = process.env): PlaceEnvironment {
  const result = placeEnvironmentSchema.safeParse(env);
  if (!result.success) {
    throw formatEnvironmentError(result.error);
  }

  return {
    provider: result.data.PLACE_PROVIDER,
    apiKey: result.data.PLACE_API_KEY,
    requestTimeoutMs: result.data.PLACE_REQUEST_TIMEOUT_MS,
    cacheTtlSeconds: result.data.PLACE_CACHE_TTL_SECONDS,
  };
}

export const createTestPlaceEnvironment = (): PlaceEnvironment => ({
  provider: DEFAULT_PROVIDER,
  apiKey: 'test-place-key',
  requestTimeoutMs: DEFAULT_TIMEOUT_MS,
  cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
});

export const PLACE_MIN_TIMEOUT_MS = 500;
export const PLACE_MAX_TIMEOUT_MS = 30_000;
export const PLACE_MIN_CACHE_TTL_SECONDS = 60;
export const PLACE_MAX_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
