import { describe, expect, it, vi } from 'vitest';

import { createTestAuthEnvironment } from '../src/modules/auth/config/auth-environment';
import {
  WECHAT_CODE2SESSION_URL,
  WechatCode2SessionProvider,
  WechatProviderError,
  type WechatFetch,
} from '../src/modules/auth/providers/wechat.provider';

describe('WechatCode2SessionProvider', () => {
  it('uses the fixed Code2Session URL and does not return session_key', async () => {
    const requests: string[] = [];
    const fakeFetch: WechatFetch = async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          openid: 'openid-value',
          unionid: 'unionid-value',
          session_key: 'session-key-value',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const provider = new WechatCode2SessionProvider(createTestAuthEnvironment(), fakeFetch);

    await expect(provider.exchangeCode(' code ')).resolves.toEqual({
      openid: 'openid-value',
      unionid: 'unionid-value',
    });
    expect(requests[0]).toContain(WECHAT_CODE2SESSION_URL);
    expect(requests[0]).toContain('grant_type=authorization_code');
    expect(requests[0]).toContain('appid=test-wechat-app-id');
  });

  it('maps invalid code and provider responses to stable errors', async () => {
    const invalidCodeFetch: WechatFetch = async () =>
      new Response(JSON.stringify({ errcode: 40029, errmsg: 'invalid code details' }), {
        status: 200,
      });
    const providerErrorFetch: WechatFetch = async () =>
      new Response(JSON.stringify({ errcode: -1, errmsg: 'secret provider details' }), {
        status: 200,
      });

    await expect(
      new WechatCode2SessionProvider(createTestAuthEnvironment(), invalidCodeFetch).exchangeCode(
        'code',
      ),
    ).rejects.toMatchObject({ kind: 'invalid_code' });
    await expect(
      new WechatCode2SessionProvider(createTestAuthEnvironment(), providerErrorFetch).exchangeCode(
        'code',
      ),
    ).rejects.toMatchObject({ kind: 'provider_error' });
  });

  it('maps network failures and rejects invalid input', async () => {
    const failingFetch: WechatFetch = vi.fn(async () => {
      throw new Error('network details');
    });
    const provider = new WechatCode2SessionProvider(createTestAuthEnvironment(), failingFetch);

    await expect(provider.exchangeCode('code')).rejects.toBeInstanceOf(WechatProviderError);
    await expect(provider.exchangeCode('   ')).rejects.toMatchObject({ kind: 'invalid_code' });
  });

  it('aborts provider requests after the configured timeout', async () => {
    const hangingFetch: WechatFetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const provider = new WechatCode2SessionProvider(createTestAuthEnvironment(), hangingFetch, 1);

    await expect(provider.exchangeCode('code')).rejects.toMatchObject({
      kind: 'provider_error',
    });
  });
});
