import { z } from 'zod';

const DEFAULT_POSTGRES_HOST = 'localhost';
const DEFAULT_POSTGRES_PORT = 5432;
const DEFAULT_POSTGRES_USER = 'travel_guide';
const DEFAULT_POSTGRES_PASSWORD = 'replace-with-a-local-password';
const DEFAULT_POSTGRES_DB = 'travel_guide';
const DEFAULT_POSTGRES_SSL = false;
const DEFAULT_POSTGRES_POOL_MIN = 0;
const DEFAULT_POSTGRES_POOL_MAX = 10;
const DEFAULT_POSTGRES_IDLE_TIMEOUT_MS = 10_000;
const DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS = 5_000;

const nonEmptyText = z.string().trim().min(1);
const nonEmptySecret = z.string().refine((value) => value.trim().length > 0, {
  message: 'must not be empty',
});
const positiveInteger = z.coerce.number().int().positive();

const explicitBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return value;
}, z.boolean());

const databaseEnvironmentSchema = z
  .object({
    POSTGRES_HOST: nonEmptyText.default(DEFAULT_POSTGRES_HOST),
    POSTGRES_PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_POSTGRES_PORT),
    POSTGRES_USER: nonEmptyText.default(DEFAULT_POSTGRES_USER),
    POSTGRES_PASSWORD: nonEmptySecret.default(DEFAULT_POSTGRES_PASSWORD),
    POSTGRES_DB: nonEmptyText.default(DEFAULT_POSTGRES_DB),
    POSTGRES_SSL: explicitBoolean.default(DEFAULT_POSTGRES_SSL),
    POSTGRES_POOL_MIN: z.coerce.number().int().min(0).max(100).default(DEFAULT_POSTGRES_POOL_MIN),
    POSTGRES_POOL_MAX: z.coerce.number().int().min(1).max(100).default(DEFAULT_POSTGRES_POOL_MAX),
    POSTGRES_IDLE_TIMEOUT_MS: positiveInteger.default(DEFAULT_POSTGRES_IDLE_TIMEOUT_MS),
    POSTGRES_CONNECTION_TIMEOUT_MS: positiveInteger.default(DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS),
  })
  .superRefine((value, context) => {
    if (value.POSTGRES_POOL_MIN > value.POSTGRES_POOL_MAX) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['POSTGRES_POOL_MIN'],
        message: 'must be less than or equal to POSTGRES_POOL_MAX',
      });
    }
  });

export interface DatabaseEnvironment {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  poolMin: number;
  poolMax: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
}

function formatDatabaseEnvironmentError(error: z.ZodError): Error {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');

  return new Error(`Invalid database environment configuration: ${issues}`);
}

export function loadDatabaseEnvironment(env: NodeJS.ProcessEnv = process.env): DatabaseEnvironment {
  const result = databaseEnvironmentSchema.safeParse(env);

  if (!result.success) {
    throw formatDatabaseEnvironmentError(result.error);
  }

  return {
    host: result.data.POSTGRES_HOST,
    port: result.data.POSTGRES_PORT,
    user: result.data.POSTGRES_USER,
    password: result.data.POSTGRES_PASSWORD,
    database: result.data.POSTGRES_DB,
    ssl: result.data.POSTGRES_SSL,
    poolMin: result.data.POSTGRES_POOL_MIN,
    poolMax: result.data.POSTGRES_POOL_MAX,
    idleTimeoutMs: result.data.POSTGRES_IDLE_TIMEOUT_MS,
    connectionTimeoutMs: result.data.POSTGRES_CONNECTION_TIMEOUT_MS,
  };
}
