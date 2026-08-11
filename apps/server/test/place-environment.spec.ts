import { describe, expect, it } from 'vitest';

import {
  createTestPlaceEnvironment,
  loadPlaceEnvironment,
} from '../src/modules/places/config/place-environment';

describe('loadPlaceEnvironment', () => {
  it('requires a server-side API key and accepts documented bounds', () => {
    expect(() => loadPlaceEnvironment({})).toThrow('Invalid place environment configuration');
    expect(
      loadPlaceEnvironment({
        PLACE_PROVIDER: 'amap',
        PLACE_API_KEY: 'server-key',
        PLACE_REQUEST_TIMEOUT_MS: '500',
        PLACE_CACHE_TTL_SECONDS: '60',
      }),
    ).toEqual({
      provider: 'amap',
      apiKey: 'server-key',
      requestTimeoutMs: 500,
      cacheTtlSeconds: 60,
    });
    expect(createTestPlaceEnvironment().provider).toBe('amap');
  });

  it.each([
    ['unsupported provider', { PLACE_PROVIDER: 'other', PLACE_API_KEY: 'secret' }],
    ['empty key', { PLACE_PROVIDER: 'amap', PLACE_API_KEY: '' }],
    [
      'invalid timeout',
      { PLACE_PROVIDER: 'amap', PLACE_API_KEY: 'secret', PLACE_REQUEST_TIMEOUT_MS: '1' },
    ],
    [
      'invalid TTL',
      { PLACE_PROVIDER: 'amap', PLACE_API_KEY: 'secret', PLACE_CACHE_TTL_SECONDS: '1' },
    ],
  ])('rejects %s', (_description, input) => {
    expect(() => loadPlaceEnvironment(input)).toThrow('Invalid place environment configuration');
  });

  it('does not echo an API key in configuration errors', () => {
    const secret = 'hidden-place-key';
    expect(() =>
      loadPlaceEnvironment({
        PLACE_PROVIDER: 'amap',
        PLACE_API_KEY: secret,
        PLACE_REQUEST_TIMEOUT_MS: 'not-a-number',
      }),
    ).toThrowError(expect.not.stringContaining(secret));
  });
});
