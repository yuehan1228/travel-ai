import { describe, expect, it } from 'vitest';

import {
  createTestRouteEnvironment,
  loadRouteEnvironment,
} from '../src/modules/routes/config/route-environment';

describe('loadRouteEnvironment', () => {
  it('loads the amap provider and defaults', () => {
    expect(loadRouteEnvironment({ ROUTE_API_KEY: 'route-key' })).toEqual({
      provider: 'amap',
      apiKey: 'route-key',
      requestTimeoutMs: 5_000,
      cacheTtlSeconds: 3_600,
      staleIfErrorSeconds: 21_600,
    });
    expect(createTestRouteEnvironment().apiKey).toBe('test-route-key');
  });

  it('rejects unsupported providers, missing keys and unsafe ranges without echoing secrets', () => {
    const secret = 'route-secret-value';
    expect(() => loadRouteEnvironment({ ROUTE_PROVIDER: 'other', ROUTE_API_KEY: secret })).toThrow(
      'Invalid route environment configuration',
    );
    expect(() =>
      loadRouteEnvironment({ ROUTE_PROVIDER: 'other', ROUTE_API_KEY: secret }),
    ).toThrowError(expect.not.stringContaining(secret));
    expect(() => loadRouteEnvironment({ ROUTE_API_KEY: '' })).toThrow(
      'Invalid route environment configuration',
    );
    expect(() =>
      loadRouteEnvironment({ ROUTE_API_KEY: secret, ROUTE_REQUEST_TIMEOUT_MS: '499' }),
    ).toThrow('Invalid route environment configuration');
    expect(() =>
      loadRouteEnvironment({ ROUTE_API_KEY: secret, ROUTE_CACHE_TTL_SECONDS: '59' }),
    ).toThrow('Invalid route environment configuration');
    expect(() =>
      loadRouteEnvironment({ ROUTE_API_KEY: secret, ROUTE_STALE_IF_ERROR_SECONDS: '-1' }),
    ).toThrow('Invalid route environment configuration');
  });
});
