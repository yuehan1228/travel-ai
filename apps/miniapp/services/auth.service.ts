import { AuthUserSchema, LoginResultSchema } from '@travel-guide/shared-schemas';
import type { AuthUser, LoginResult } from '@travel-guide/shared-types';
import { z } from 'zod';

import { createHttpClient, requestApi, type HttpClient } from './http-client';
import { RequestError } from './request-error';
import { type StorageAdapter, wxStorageAdapter } from './trip-draft-storage';

export const AUTH_STORAGE_KEY = 'travel-guide:auth:v1';
export const AUTH_STORAGE_VERSION = 1;
export const AUTH_CACHE_STORAGE_KEY = AUTH_STORAGE_KEY;

interface AuthStorageEnvelope {
  readonly version: typeof AUTH_STORAGE_VERSION;
  readonly accessToken: string;
  readonly user: AuthUser;
}

export interface WxLoginAdapter {
  login(): Promise<string>;
}

export const createWxLoginAdapter = (login: WxLoginFunction): WxLoginAdapter => ({
  login: () =>
    new Promise<string>((resolve, reject) => {
      try {
        login({
          success: (response) => {
            if (typeof response.code !== 'string' || response.code.trim().length === 0) {
              reject(
                new RequestError({
                  code: 'API_ERROR',
                  message: 'WeChat login did not return a code',
                }),
              );
              return;
            }

            resolve(response.code);
          },
          fail: (failure) => {
            reject(
              new RequestError({
                code: 'NETWORK_ERROR',
                message: 'WeChat login failed',
                cause: failure,
              }),
            );
          },
        });
      } catch (error: unknown) {
        reject(
          new RequestError({
            code: 'NETWORK_ERROR',
            message: 'WeChat login failed',
            cause: error,
          }),
        );
      }
    }),
});

export const wxLoginAdapter: WxLoginAdapter = createWxLoginAdapter((options) => wx.login(options));

const storedAuthSchema: z.ZodType<AuthStorageEnvelope> = z
  .object({
    version: z.literal(AUTH_STORAGE_VERSION),
    accessToken: z.string().min(1).max(4_096),
    user: AuthUserSchema,
  })
  .strict();

const parseStoredAuth = (serialized: string): AuthStorageEnvelope | undefined => {
  try {
    const parsedJson: unknown = JSON.parse(serialized);
    const parsed = storedAuthSchema.safeParse(parsedJson);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

export class AuthService {
  public constructor(
    private readonly client: HttpClient = createHttpClient(),
    private readonly loginAdapter: WxLoginAdapter = wxLoginAdapter,
    private readonly storage: StorageAdapter = wxStorageAdapter,
  ) {}

  public async login(): Promise<LoginResult> {
    const loginCode = await this.loginAdapter.login();
    const code = typeof loginCode === 'string' ? loginCode.trim() : '';
    if (code.length === 0 || code.length > 256) {
      throw new RequestError({
        code: 'API_ERROR',
        message: 'WeChat login did not return a valid code',
      });
    }

    const result = await requestApi(
      {
        method: 'POST',
        path: '/auth/login',
        data: { code },
        schema: LoginResultSchema,
      },
      this.client,
    );

    const serialized = JSON.stringify({
      version: AUTH_STORAGE_VERSION,
      accessToken: result.accessToken,
      user: result.user,
    });
    this.storage.set(AUTH_STORAGE_KEY, serialized);
    return result;
  }

  public logout(): void {
    try {
      this.storage.remove(AUTH_STORAGE_KEY);
    } catch {
      // Logout is best effort and must not expose storage implementation errors.
    }
  }

  public getCurrentUser(): AuthUser | undefined {
    return this.readStoredAuth()?.user;
  }

  public getAccessToken(): string | undefined {
    return this.readStoredAuth()?.accessToken;
  }

  private readStoredAuth(): AuthStorageEnvelope | undefined {
    let serialized: string | undefined;
    try {
      serialized = this.storage.get(AUTH_STORAGE_KEY);
    } catch {
      return undefined;
    }

    if (serialized === undefined) {
      return undefined;
    }

    const parsed = parseStoredAuth(serialized);
    if (parsed !== undefined) {
      return parsed;
    }

    try {
      this.storage.remove(AUTH_STORAGE_KEY);
    } catch {
      // Corrupt data is already ignored; removal failure is intentionally silent.
    }
    return undefined;
  }
}

export const createAuthService = (
  client: HttpClient = createHttpClient(),
  loginAdapter: WxLoginAdapter = wxLoginAdapter,
  storage: StorageAdapter = wxStorageAdapter,
): AuthService => new AuthService(client, loginAdapter, storage);

export type { StorageAdapter } from './trip-draft-storage';

export const authService = new AuthService();
