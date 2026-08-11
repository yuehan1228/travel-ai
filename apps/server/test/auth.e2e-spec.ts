import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import {
  ApiFailureSchema,
  LoginResultSchema,
  createApiSuccessSchema,
} from '@travel-guide/shared-schemas';

import { createApp } from '../src/create-app';
import { createTestAuthEnvironment } from '../src/modules/auth/config/auth-environment';
import { CurrentUserId } from '../src/modules/auth/auth-user.decorator';
import { AuthGuard } from '../src/modules/auth/auth.guard';
import type { UserRepository, UserRecord } from '../src/modules/auth/repositories/user.repository';
import type { WechatProvider } from '../src/modules/auth/providers/wechat.provider';

const user: UserRecord = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  nickname: '',
  avatarUrl: '',
  status: 'active',
};

class FakeProvider implements WechatProvider {
  public async exchangeCode(code: string): Promise<{ openid: string }> {
    if (code === 'invalid') {
      throw new Error('provider details');
    }

    return { openid: `openid-${code}` };
  }
}

class FakeRepository implements UserRepository {
  private readonly users = new Map<string, UserRecord>();

  public async findOrCreateByWechatIdentity(input: {
    openid: string;
    unionid?: string;
  }): Promise<UserRecord> {
    const existing = this.users.get(input.openid);
    if (existing !== undefined) {
      return existing;
    }

    this.users.set(input.openid, user);
    return user;
  }
}

@Controller('__auth-test')
class AuthTestController {
  @Get('me')
  @UseGuards(AuthGuard)
  public getCurrentUser(@CurrentUserId() userId: string): { userId: string } {
    return { userId };
  }
}

describe('auth HTTP flow', () => {
  let app: NestFastifyApplication;
  const repository = new FakeRepository();

  beforeAll(async () => {
    app = await createApp(
      { nodeEnv: 'test', port: 0 },
      {
        extraControllers: [AuthTestController],
        authEnvironment: createTestAuthEnvironment(),
        wechatProvider: new FakeProvider(),
        userRepository: repository,
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns success envelope and matching request ID', async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-request-id': 'auth-request-1' },
        payload: { code: 'one-time-code' },
      });
    const body: unknown = JSON.parse(response.payload);
    const parsed = createApiSuccessSchema(LoginResultSchema).safeParse(body);

    expect(response.statusCode).toBe(200);
    expect(parsed.success).toBe(true);
    expect(response.headers['x-request-id']).toBe('auth-request-1');
    expect(body).not.toHaveProperty('openid');
    expect(body).not.toHaveProperty('session_key');
  });

  it('reuses the user and accepts the issued Bearer token', async () => {
    const first = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/auth/login',
        payload: { code: 'repeat-code' },
      });
    const second = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/auth/login',
        payload: { code: 'repeat-code' },
      });
    const firstResult = createApiSuccessSchema(LoginResultSchema).parse(JSON.parse(first.payload));
    const secondResult = createApiSuccessSchema(LoginResultSchema).parse(
      JSON.parse(second.payload),
    );
    const guarded = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/__auth-test/me',
        headers: { authorization: `Bearer ${firstResult.data.accessToken}` },
      });

    expect(secondResult.data.user.id).toBe(firstResult.data.user.id);
    expect(guarded.statusCode).toBe(200);
    expect(JSON.parse(guarded.payload)).toEqual({ userId: firstResult.data.user.id });
  });

  it('returns controlled errors for invalid payload and provider failures', async () => {
    const invalid = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/auth/login',
        payload: { code: ' ' },
      });
    const providerFailure = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/auth/login',
        payload: { code: 'invalid' },
      });

    expect(invalid.statusCode).toBe(400);
    expect(ApiFailureSchema.parse(JSON.parse(invalid.payload)).error.code).toBe(
      'AUTH_CODE_INVALID',
    );
    expect(providerFailure.statusCode).toBe(502);
    expect(ApiFailureSchema.parse(JSON.parse(providerFailure.payload)).error.code).toBe(
      'AUTH_PROVIDER_ERROR',
    );
    expect(providerFailure.payload).not.toContain('provider details');
  });

  it('rejects missing and malformed Bearer tokens', async () => {
    const missing = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/__auth-test/me',
    });
    const malformed = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/__auth-test/me',
        headers: { authorization: 'Basic token' },
      });

    expect(missing.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(401);
    expect(ApiFailureSchema.parse(JSON.parse(missing.payload)).error.code).toBe(
      'AUTH_TOKEN_INVALID',
    );
  });
});
