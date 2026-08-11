import { z } from 'zod';

const DEFAULT_PROVIDER = 'amap';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_SECONDS = 3_600;
const DEFAULT_STALE_IF_ERROR_SECONDS = 21_600;

const routeEnvironmentSchema = z.object({
  ROUTE_PROVIDER: z.literal(DEFAULT_PROVIDER).default(DEFAULT_PROVIDER),
  ROUTE_API_KEY: z.string().trim().min(1).max(512),
  ROUTE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(30_000)
    .default(DEFAULT_TIMEOUT_MS),
  ROUTE_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 60 * 60)
    .default(DEFAULT_CACHE_TTL_SECONDS),
  ROUTE_STALE_IF_ERROR_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60 * 60)
    .default(DEFAULT_STALE_IF_ERROR_SECONDS),
});

export interface RouteEnvironment {
  readonly provider: string;
  readonly apiKey: string;
  readonly requestTimeoutMs: number;
  readonly cacheTtlSeconds: number;
  readonly staleIfErrorSeconds: number;
}

const formatRouteEnvironmentError = (error: z.ZodError): Error => {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');
  return new Error(`Invalid route environment configuration: ${issues}`);
};

export function loadRouteEnvironment(env: NodeJS.ProcessEnv = process.env): RouteEnvironment {
  const result = routeEnvironmentSchema.safeParse(env);
  if (!result.success) {
    throw formatRouteEnvironmentError(result.error);
  }

  return {
    provider: result.data.ROUTE_PROVIDER,
    apiKey: result.data.ROUTE_API_KEY,
    requestTimeoutMs: result.data.ROUTE_REQUEST_TIMEOUT_MS,
    cacheTtlSeconds: result.data.ROUTE_CACHE_TTL_SECONDS,
    staleIfErrorSeconds: result.data.ROUTE_STALE_IF_ERROR_SECONDS,
  };
}

export const createTestRouteEnvironment = (): RouteEnvironment => ({
  provider: DEFAULT_PROVIDER,
  apiKey: 'test-route-key',
  requestTimeoutMs: DEFAULT_TIMEOUT_MS,
  cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  staleIfErrorSeconds: DEFAULT_STALE_IF_ERROR_SECONDS,
});

export const ROUTE_MIN_TIMEOUT_MS = 500;
export const ROUTE_MAX_TIMEOUT_MS = 30_000;
export const ROUTE_MIN_CACHE_TTL_SECONDS = 60;
export const ROUTE_MAX_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const ROUTE_MIN_STALE_IF_ERROR_SECONDS = 0;
export const ROUTE_MAX_STALE_IF_ERROR_SECONDS = 7 * 24 * 60 * 60;
