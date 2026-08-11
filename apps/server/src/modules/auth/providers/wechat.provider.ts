import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { AuthEnvironment } from '../config/auth-environment';

export interface WechatSession {
  readonly openid: string;
  readonly unionid?: string;
}

export interface WechatProvider {
  exchangeCode(code: string): Promise<WechatSession>;
}

export type WechatProviderErrorKind = 'invalid_code' | 'provider_error';

export class WechatProviderError extends Error {
  public constructor(
    public readonly kind: WechatProviderErrorKind,
    cause?: Error,
  ) {
    super(
      kind === 'invalid_code' ? 'The WeChat login code is invalid' : 'The WeChat provider failed',
    );
    this.name = 'WechatProviderError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

const WECHAT_CODE2SESSION_URL = 'https://api.weixin.qq.com/sns/jscode2session';
const WECHAT_PROVIDER_TIMEOUT_MS = 5_000;

const wechatCode2SessionResponseSchema = z
  .object({
    errcode: z.number().int().optional(),
    errmsg: z.string().optional(),
    openid: z.string().optional(),
    unionid: z.string().optional(),
    session_key: z.string().optional(),
  })
  .passthrough();

export type WechatFetch = typeof fetch;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

@Injectable()
export class WechatCode2SessionProvider implements WechatProvider {
  public constructor(
    private readonly environment: AuthEnvironment,
    private readonly fetchImplementation: WechatFetch = fetch,
    private readonly timeoutMs = WECHAT_PROVIDER_TIMEOUT_MS,
  ) {}

  public async exchangeCode(code: string): Promise<WechatSession> {
    const normalizedCode = code.trim();
    if (normalizedCode.length === 0 || normalizedCode.length > 256) {
      throw new WechatProviderError('invalid_code');
    }

    const query = new URLSearchParams({
      appid: this.environment.wechatAppId,
      secret: this.environment.wechatAppSecret,
      js_code: normalizedCode,
      grant_type: 'authorization_code',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(`${WECHAT_CODE2SESSION_URL}?${query}`, {
        method: 'GET',
        signal: controller.signal,
      });

      if (response.status < 200 || response.status >= 300) {
        throw new WechatProviderError('provider_error');
      }

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch (error: unknown) {
        throw new WechatProviderError(
          'provider_error',
          error instanceof Error ? error : new Error('Invalid provider response'),
        );
      }

      const parsed = wechatCode2SessionResponseSchema.safeParse(responseBody);
      if (!parsed.success || !isRecord(responseBody)) {
        throw new WechatProviderError('provider_error');
      }

      if (parsed.data.errcode !== undefined && parsed.data.errcode !== 0) {
        if (parsed.data.errcode === 40029 || parsed.data.errcode === 40163) {
          throw new WechatProviderError('invalid_code');
        }

        throw new WechatProviderError('provider_error');
      }

      const openid = parsed.data.openid?.trim();
      if (openid === undefined || openid.length === 0 || openid.length > 255) {
        throw new WechatProviderError('provider_error');
      }

      const unionid = parsed.data.unionid?.trim();
      return {
        openid,
        ...(unionid === undefined || unionid.length === 0 ? {} : { unionid }),
      };
    } catch (error: unknown) {
      if (error instanceof WechatProviderError) {
        throw error;
      }

      throw new WechatProviderError(
        'provider_error',
        error instanceof Error ? error : new Error('Provider request failed'),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { WECHAT_CODE2SESSION_URL, WECHAT_PROVIDER_TIMEOUT_MS };
