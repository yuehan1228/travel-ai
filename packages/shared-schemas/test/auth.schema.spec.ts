import { describe, expect, it } from 'vitest';

import { AuthUserSchema, LoginResultSchema, WechatLoginInputSchema } from '../src/auth.schema';

const user = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  nickname: '',
  avatarUrl: '',
};

describe('auth schemas', () => {
  it('trims a valid WeChat code', () => {
    expect(WechatLoginInputSchema.parse({ code: '  wx-code  ' })).toEqual({ code: 'wx-code' });
  });

  it('rejects an empty, oversized, or unknown login input', () => {
    expect(WechatLoginInputSchema.safeParse({ code: '   ' }).success).toBe(false);
    expect(WechatLoginInputSchema.safeParse({ code: 'a'.repeat(257) }).success).toBe(false);
    expect(WechatLoginInputSchema.safeParse({ code: 'code', extra: true }).success).toBe(false);
  });

  it('validates the strict login result without provider secrets', () => {
    const result = {
      user,
      accessToken: 'access-token',
      expiresIn: 7_200,
    };

    expect(LoginResultSchema.safeParse(result).success).toBe(true);
    expect(LoginResultSchema.safeParse({ ...result, session_key: 'secret' }).success).toBe(false);
    expect(AuthUserSchema.safeParse({ ...user, openid: 'hidden' }).success).toBe(false);
  });
});
