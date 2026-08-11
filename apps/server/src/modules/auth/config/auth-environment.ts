import { z } from 'zod';

const DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 7_200;
const MIN_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 300;
const MAX_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 86_400;

const requiredSecret = z.string().trim().min(1);

const authEnvironmentSchema = z.object({
  WECHAT_APP_ID: requiredSecret.max(128),
  WECHAT_APP_SECRET: requiredSecret.max(512),
  JWT_ACCESS_SECRET: z.string().trim().min(32, 'must be at least 32 characters').max(4_096),
  JWT_ACCESS_EXPIRES_IN_SECONDS: z.coerce
    .number()
    .int()
    .min(MIN_ACCESS_TOKEN_EXPIRES_IN_SECONDS)
    .max(MAX_ACCESS_TOKEN_EXPIRES_IN_SECONDS)
    .default(DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS),
});

export interface AuthEnvironment {
  readonly wechatAppId: string;
  readonly wechatAppSecret: string;
  readonly jwtAccessSecret: string;
  readonly jwtAccessExpiresInSeconds: number;
}

const formatAuthEnvironmentError = (error: z.ZodError): Error => {
  const issues = error.issues
    .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');

  return new Error(`Invalid auth environment configuration: ${issues}`);
};

export function loadAuthEnvironment(env: NodeJS.ProcessEnv = process.env): AuthEnvironment {
  const result = authEnvironmentSchema.safeParse(env);

  if (!result.success) {
    throw formatAuthEnvironmentError(result.error);
  }

  return {
    wechatAppId: result.data.WECHAT_APP_ID,
    wechatAppSecret: result.data.WECHAT_APP_SECRET,
    jwtAccessSecret: result.data.JWT_ACCESS_SECRET,
    jwtAccessExpiresInSeconds: result.data.JWT_ACCESS_EXPIRES_IN_SECONDS,
  };
}

export const createTestAuthEnvironment = (): AuthEnvironment => ({
  wechatAppId: 'test-wechat-app-id',
  wechatAppSecret: 'test-wechat-app-secret',
  jwtAccessSecret: 'test-jwt-access-secret-that-is-at-least-32-chars',
  jwtAccessExpiresInSeconds: DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
});

export const ACCESS_TOKEN_MIN_EXPIRES_IN_SECONDS = MIN_ACCESS_TOKEN_EXPIRES_IN_SECONDS;
export const ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS = MAX_ACCESS_TOKEN_EXPIRES_IN_SECONDS;
