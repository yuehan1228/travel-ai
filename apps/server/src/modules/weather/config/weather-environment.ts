import { z } from 'zod';

const DEFAULT_PROVIDER = 'amap';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_HORIZON_DAYS = 4;

const weatherEnvironmentSchema = z.object({
  WEATHER_PROVIDER: z.literal(DEFAULT_PROVIDER).default(DEFAULT_PROVIDER),
  WEATHER_API_KEY: z.string().trim().min(1).max(512).default('replace-with-weather-api-key'),
  WEATHER_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(30_000)
    .default(DEFAULT_TIMEOUT_MS),
  WEATHER_FORECAST_HORIZON_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(14)
    .default(DEFAULT_HORIZON_DAYS),
});

export interface WeatherEnvironment {
  readonly provider: string;
  readonly apiKey: string;
  readonly requestTimeoutMs: number;
  readonly forecastHorizonDays: number;
}

const formatWeatherEnvironmentError = (error: z.ZodError): Error => {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');
  return new Error(`Invalid weather environment configuration: ${issues}`);
};

export function loadWeatherEnvironment(env: NodeJS.ProcessEnv = process.env): WeatherEnvironment {
  const result = weatherEnvironmentSchema.safeParse(env);
  if (!result.success) {
    throw formatWeatherEnvironmentError(result.error);
  }

  return {
    provider: result.data.WEATHER_PROVIDER,
    apiKey: result.data.WEATHER_API_KEY,
    requestTimeoutMs: result.data.WEATHER_REQUEST_TIMEOUT_MS,
    forecastHorizonDays: result.data.WEATHER_FORECAST_HORIZON_DAYS,
  };
}

export const createTestWeatherEnvironment = (): WeatherEnvironment => ({
  provider: DEFAULT_PROVIDER,
  apiKey: 'test-weather-key',
  requestTimeoutMs: DEFAULT_TIMEOUT_MS,
  forecastHorizonDays: DEFAULT_HORIZON_DAYS,
});

export const WEATHER_MIN_TIMEOUT_MS = 500;
export const WEATHER_MAX_TIMEOUT_MS = 30_000;
export const WEATHER_MAX_HORIZON_DAYS = 14;
