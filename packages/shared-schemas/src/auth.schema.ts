import { z } from 'zod';

import type { AuthUser, LoginResult, WechatLoginInput } from '@travel-guide/shared-types';

import { createApiSuccessSchema } from './api.schema';

export const WechatLoginInputSchema: z.ZodType<WechatLoginInput> = z
  .object({
    code: z
      .string({ invalid_type_error: 'code must be a string' })
      .trim()
      .min(1, { message: 'code must not be empty' })
      .max(256, { message: 'code must be at most 256 characters' }),
  })
  .strict();

export const AuthUserSchema: z.ZodType<AuthUser> = z
  .object({
    id: z.string().uuid(),
    nickname: z.string().max(255),
    avatarUrl: z.string().max(2_048),
  })
  .strict();

export const LoginResultSchema: z.ZodType<LoginResult> = z
  .object({
    user: AuthUserSchema,
    accessToken: z.string().min(1).max(4_096),
    expiresIn: z.number().int().min(1).max(86_400),
  })
  .strict();

export const LoginResultEnvelopeSchema = createApiSuccessSchema(LoginResultSchema);
export const LoginResponseSchema = LoginResultEnvelopeSchema;
