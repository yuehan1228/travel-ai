import { describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS,
  ACCESS_TOKEN_MIN_EXPIRES_IN_SECONDS,
  loadAuthEnvironment,
} from '../src/modules/auth/config/auth-environment';

const validEnvironment: NodeJS.ProcessEnv = {
  WECHAT_APP_ID: 'wx-test-app',
  WECHAT_APP_SECRET: 'wechat-secret',
  JWT_ACCESS_SECRET: 'jwt-secret-that-is-at-least-32-characters-long',
  JWT_ACCESS_EXPIRES_IN_SECONDS: '7200',
};

describe('loadAuthEnvironment', () => {
  it('loads required auth settings', () => {
    expect(loadAuthEnvironment(validEnvironment)).toEqual({
      wechatAppId: 'wx-test-app',
      wechatAppSecret: 'wechat-secret',
      jwtAccessSecret: 'jwt-secret-that-is-at-least-32-characters-long',
      jwtAccessExpiresInSeconds: 7_200,
    });
  });

  it('requires secrets and bounds access token lifetime', () => {
    expect(() => loadAuthEnvironment({})).toThrow('Invalid auth environment configuration');
    expect(() => loadAuthEnvironment({ ...validEnvironment, JWT_ACCESS_SECRET: 'short' })).toThrow(
      'Invalid auth environment configuration',
    );
    expect(() =>
      loadAuthEnvironment({
        ...validEnvironment,
        JWT_ACCESS_EXPIRES_IN_SECONDS: String(ACCESS_TOKEN_MIN_EXPIRES_IN_SECONDS - 1),
      }),
    ).toThrow('Invalid auth environment configuration');
    expect(() =>
      loadAuthEnvironment({
        ...validEnvironment,
        JWT_ACCESS_EXPIRES_IN_SECONDS: String(ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS + 1),
      }),
    ).toThrow('Invalid auth environment configuration');
  });

  it('does not echo secret values in configuration errors', () => {
    const secret = 'secret-value-that-must-never-appear-in-errors';
    expect(() =>
      loadAuthEnvironment({ ...validEnvironment, JWT_ACCESS_SECRET: secret, WECHAT_APP_ID: '' }),
    ).toThrowError(expect.not.stringContaining(secret));
  });
});
