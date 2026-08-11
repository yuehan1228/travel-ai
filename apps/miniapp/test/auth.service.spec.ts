import { describe, expect, it } from 'vitest';

import type { AuthUser } from '@travel-guide/shared-types';

import { AuthService, AUTH_STORAGE_KEY, createWxLoginAdapter } from '../services/auth.service';
import { createHttpClient, type HttpClient, type RequestAdapter } from '../services/http-client';
import { RequestError } from '../services/request-error';
import type { StorageAdapter } from '../services/trip-draft-storage';

const user: AuthUser = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  nickname: '',
  avatarUrl: '',
};

class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>();

  public get(key: string): string | undefined {
    return this.values.get(key);
  }

  public set(key: string, value: string): void {
    this.values.set(key, value);
  }

  public remove(key: string): void {
    this.values.delete(key);
  }

  public put(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const createClient = (adapter: RequestAdapter): HttpClient =>
  createHttpClient(
    { name: 'test', baseUrl: 'https://api.example.invalid', requestTimeout: 100 },
    adapter,
  );

describe('miniapp AuthService', () => {
  it('calls wx.login, exchanges the code, and stores only minimal auth state', async () => {
    let sentCode = '';
    const loginAdapter = createWxLoginAdapter((options) => options.success?.({ code: 'wx-code' }));
    const requestAdapter: RequestAdapter = async (options) => {
      sentCode = JSON.stringify(options.data);
      return {
        statusCode: 200,
        data: {
          success: true,
          data: { user, accessToken: 'access-token', expiresIn: 7_200 },
          requestId: 'request-1',
        },
      };
    };
    const storage = new MemoryStorageAdapter();
    const service = new AuthService(createClient(requestAdapter), loginAdapter, storage);

    await expect(service.login()).resolves.toMatchObject({ accessToken: 'access-token' });
    expect(sentCode).toBe(JSON.stringify({ code: 'wx-code' }));
    const serialized = storage.get(AUTH_STORAGE_KEY);
    expect(serialized).toContain('access-token');
    expect(serialized).not.toContain('wx-code');
    expect(serialized).not.toContain('openid');
    expect(serialized).not.toContain('session_key');
    expect(service.getCurrentUser()).toEqual(user);
    expect(service.getAccessToken()).toBe('access-token');
  });

  it('maps wx.login failures and API failures without exposing details', async () => {
    const loginFailure = createWxLoginAdapter((options) =>
      options.fail?.({ errMsg: 'sensitive wx failure details' }),
    );
    const storage = new MemoryStorageAdapter();
    const service = new AuthService(
      createClient(async () => {
        throw new Error('should not call API');
      }),
      loginFailure,
      storage,
    );

    await expect(service.login()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(storage.get(AUTH_STORAGE_KEY)).toBeUndefined();

    const apiFailure = new AuthService(
      createClient(async () => ({
        statusCode: 200,
        data: {
          success: false,
          error: { code: 'AUTH_CODE_INVALID', message: 'safe failure' },
          requestId: 'request-2',
        },
      })),
      createWxLoginAdapter((options) => options.success?.({ code: 'wx-code' })),
      storage,
    );
    await expect(apiFailure.login()).rejects.toMatchObject({ code: 'API_ERROR' });
  });

  it('clears damaged cache and supports logout', () => {
    const storage = new MemoryStorageAdapter();
    storage.put(
      AUTH_STORAGE_KEY,
      JSON.stringify({ version: 1, accessToken: 'token', user, extra: 'reject' }),
    );
    const service = new AuthService(
      createClient(async () => {
        throw new RequestError({ code: 'NETWORK_ERROR', message: 'not used' });
      }),
      createWxLoginAdapter((options) => options.success?.({ code: 'wx-code' })),
      storage,
    );

    expect(service.getCurrentUser()).toBeUndefined();
    expect(storage.get(AUTH_STORAGE_KEY)).toBeUndefined();

    storage.put(AUTH_STORAGE_KEY, JSON.stringify({ version: 1, accessToken: 'token', user }));
    service.logout();
    expect(storage.get(AUTH_STORAGE_KEY)).toBeUndefined();
  });
});
