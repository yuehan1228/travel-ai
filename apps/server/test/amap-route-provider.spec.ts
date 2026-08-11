import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AMAP_DRIVING_URL,
  AMAP_WALKING_URL,
  AmapRouteProvider,
} from '../src/modules/routes/providers/amap-route.provider';
import type { RouteEnvironment } from '../src/modules/routes/config/route-environment';

const environment: RouteEnvironment = {
  provider: 'amap',
  apiKey: 'test-route-key',
  requestTimeoutMs: 500,
  cacheTtlSeconds: 3_600,
  staleIfErrorSeconds: 600,
};

const input = {
  origin: { location: { longitude: 120.1500008, latitude: 30.25 }, placeId: 'B001' },
  destination: { location: { longitude: 120.18, latitude: 30.27 }, placeId: 'B002' },
  mode: 'walking' as const,
};

describe('AmapRouteProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses fixed v5 walking endpoint, formats coordinates and returns only estimate fields', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            status: '1',
            info: 'ok',
            infocode: '10000',
            count: '1',
            route: {
              paths: [{ distance: '1250', cost: { duration: '900' }, polyline: 'secret-path' }],
            },
          }),
        };
      }),
    );

    const result = await new AmapRouteProvider(environment).estimateRoute(input);
    const url = new URL(requestedUrl);
    expect(requestedUrl.startsWith(`${AMAP_WALKING_URL}?`)).toBe(true);
    expect(url.hostname).toBe('restapi.amap.com');
    expect(url.searchParams.get('origin')).toBe('120.150001,30.25');
    expect(url.searchParams.get('destination')).toBe('120.18,30.27');
    expect(url.searchParams.get('origin_id')).toBe('B001');
    expect(url.searchParams.get('destination_id')).toBe('B002');
    expect(url.searchParams.get('show_fields')).toBe('cost');
    expect(result).toMatchObject({ distanceMeters: 1250, durationSeconds: 900 });
    expect(JSON.stringify(result)).not.toContain('test-route-key');
    expect(JSON.stringify(result)).not.toContain('secret-path');
  });

  it('maps driving tolls and uses the driving endpoint', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return {
          ok: true,
          json: async () => ({
            status: '1',
            info: 'OK',
            route: { paths: [{ distance: '9000', cost: { duration: '1800', tolls: '12.50' } }] },
          }),
        };
      }),
    );

    const result = await new AmapRouteProvider(environment).estimateRoute({
      ...input,
      mode: 'driving',
    });
    expect(requestedUrl.startsWith(`${AMAP_DRIVING_URL}?`)).toBe(true);
    expect(result).toMatchObject({ distanceMeters: 9000, durationSeconds: 1800, tollsCny: 12.5 });
  });

  it('returns undefined for empty routes and maps HTTP/business/timeout failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: '1', info: 'OK', count: '0', route: { paths: [] } }),
      })),
    );
    await expect(new AmapRouteProvider(environment).estimateRoute(input)).resolves.toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    await expect(new AmapRouteProvider(environment).estimateRoute(input)).rejects.toMatchObject({
      name: 'RouteProviderError',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: '0', info: 'INVALID_USER_KEY' }),
      })),
    );
    await expect(new AmapRouteProvider(environment).estimateRoute(input)).rejects.toMatchObject({
      name: 'RouteProviderError',
    });

    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string, options: { signal: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          }),
      ),
    );
    await expect(
      new AmapRouteProvider({ ...environment, requestTimeoutMs: 5 }).estimateRoute(input),
    ).rejects.toMatchObject({ name: 'RouteProviderError' });
    expect(aborted).toBe(true);
  });
});
