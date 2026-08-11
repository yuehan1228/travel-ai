import { z } from 'zod';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_PROVIDER = 'openai_compatible' as const;
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

export const LLM_MIN_TIMEOUT_MS = 500;
export const LLM_MAX_TIMEOUT_MS = 120_000;
export const LLM_MIN_OUTPUT_TOKENS = 128;
export const LLM_MAX_OUTPUT_TOKENS = 16_384;

const booleanEnvironment = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .default('false');

const llmEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LLM_PROVIDER: z.literal(DEFAULT_PROVIDER).default(DEFAULT_PROVIDER),
  LLM_BASE_URL: z.string().trim().url().max(512).default(DEFAULT_BASE_URL),
  LLM_API_KEY: z.string().trim().min(1).max(512),
  LLM_MODEL: z.string().trim().min(1).max(128).default(DEFAULT_MODEL),
  LLM_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(LLM_MIN_TIMEOUT_MS)
    .max(LLM_MAX_TIMEOUT_MS)
    .default(DEFAULT_TIMEOUT_MS),
  LLM_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(LLM_MIN_OUTPUT_TOKENS)
    .max(LLM_MAX_OUTPUT_TOKENS)
    .default(DEFAULT_MAX_OUTPUT_TOKENS),
  LLM_ALLOW_INSECURE_LOCALHOST: booleanEnvironment,
});

export interface LlmEnvironment {
  readonly provider: typeof DEFAULT_PROVIDER;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly requestTimeoutMs: number;
  readonly maxOutputTokens: number;
  readonly allowInsecureLocalhost: boolean;
}

export type LLMEnvironment = LlmEnvironment;

const formatEnvironmentError = (error: z.ZodError): Error => {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');
  return new Error(`Invalid LLM environment configuration: ${issues}`);
};

const assertSafeBaseUrl = (baseUrl: string, nodeEnv: string, allowLocalhost: boolean): void => {
  const parsed = new URL(baseUrl);
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      'Invalid LLM environment configuration: LLM_BASE_URL must not contain credentials or query parameters',
    );
  }
  if (parsed.protocol === 'https:') return;

  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (
    parsed.protocol === 'http:' &&
    allowLocalhost &&
    (nodeEnv === 'development' || nodeEnv === 'test') &&
    localHosts.has(parsed.hostname)
  ) {
    return;
  }
  throw new Error('Invalid LLM environment configuration: LLM_BASE_URL must use HTTPS');
};

export function loadLlmEnvironment(env: NodeJS.ProcessEnv = process.env): LlmEnvironment {
  const result = llmEnvironmentSchema.safeParse(env);
  if (!result.success) throw formatEnvironmentError(result.error);
  assertSafeBaseUrl(
    result.data.LLM_BASE_URL,
    result.data.NODE_ENV,
    result.data.LLM_ALLOW_INSECURE_LOCALHOST,
  );
  return {
    provider: result.data.LLM_PROVIDER,
    baseUrl: result.data.LLM_BASE_URL.replace(/\/$/, ''),
    apiKey: result.data.LLM_API_KEY,
    model: result.data.LLM_MODEL,
    requestTimeoutMs: result.data.LLM_REQUEST_TIMEOUT_MS,
    maxOutputTokens: result.data.LLM_MAX_OUTPUT_TOKENS,
    allowInsecureLocalhost: result.data.LLM_ALLOW_INSECURE_LOCALHOST,
  };
}

/** Test-only configuration; FakeLLMProvider does not use the key or URL. */
export const createTestLlmEnvironment = (): LlmEnvironment => ({
  provider: DEFAULT_PROVIDER,
  baseUrl: 'http://127.0.0.1:4016/v1',
  apiKey: 'test-llm-key',
  model: 'test-model',
  requestTimeoutMs: DEFAULT_TIMEOUT_MS,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  allowInsecureLocalhost: true,
});

export const loadLLMEnvironment = loadLlmEnvironment;
export const createTestLLMEnvironment = createTestLlmEnvironment;
