import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AMAP_PLACE_URL,
  AmapPlaceProvider,
} from '../src/modules/places/providers/amap-place.provider';
import type { PlaceEnvironment } from '../src/modules/places/config/place-environment';

const environment: PlaceEnvironment = {
  provider: 'amap',
  apiKey: 'test-place-key',
  requestTimeoutMs: 500,
  cacheTtlSeconds: 3_600,
};

const input = {
  cityName: '杭州',
  cityCode: '330100',
  categories: ['attraction', 'restaurant'] as ('attraction' | 'restaurant')[],
  page: 1,
  pageSize: 20,
};

describe('AmapPlaceProvider', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the fixed host and maps real POI fields without raw payload', async () => {
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
            count: '1',
            pois: [
              {
                id: 'B0001',
                name: '西湖',
                type: '风景名胜;公园广场',
                typecode: '110000',
                address: '西湖区',
                location: '120.15,30.25',
                tel: '0571-12345678',
                business: { rating: '4.8', opentime_week: '08:00-17:00', tel: '0571-12345678' },
              },
            ],
          }),
        };
      }),
    );

    const result = await new AmapPlaceProvider(environment).searchPlaces(input);
    expect(requestedUrl.startsWith(`${AMAP_PLACE_URL}?`)).toBe(true);
    expect(result.items[0]).toMatchObject({
      providerPlaceId: 'B0001',
      category: 'attraction',
      location: { longitude: 120.15, latitude: 30.25 },
      rating: 4.8,
      openingHours: '08:00-17:00',
      telephone: '0571-12345678',
    });
    expect(JSON.stringify(result)).not.toContain('test-place-key');
  });

  it('ignores invalid POI coordinates and preserves an empty provider result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: '1',
          info: 'OK',
          count: '1',
          pois: [
            {
              id: 'bad',
              name: '坏地点',
              type: '风景名胜',
              typecode: '110000',
              address: '未知',
              location: '181,30',
            },
          ],
        }),
      })),
    );
    const result = await new AmapPlaceProvider(environment).searchPlaces(input);
    expect(result.items).toEqual([]);
  });

  it('uses v5 pagination with a maximum upstream page size of 25', async () => {
    const requested: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const parsed = new URL(url);
        requested.push(parsed);
        const page = Number(parsed.searchParams.get('page_num'));
        return {
          ok: true,
          json: async () => ({
            status: '1',
            info: 'ok',
            count: '50',
            pois: Array.from({ length: 25 }, (_, index) => ({
              id: `B${page}-${index}`,
              name: `景点${page}-${index}`,
              type: '风景名胜',
              typecode: '110000',
              address: '杭州',
              location: `120.${index},30.${index}`,
              business: { opentime_today: '08:00-17:00' },
            })),
          }),
        };
      }),
    );

    const result = await new AmapPlaceProvider(environment).searchPlaces({
      ...input,
      pageSize: 50,
    });
    expect(result.items).toHaveLength(50);
    expect(requested).toHaveLength(2);
    expect(requested.every((url) => url.hostname === 'restapi.amap.com')).toBe(true);
    expect(requested.every((url) => url.pathname === '/v5/place/text')).toBe(true);
    expect(requested.every((url) => url.searchParams.get('page_size') === '25')).toBe(true);
    expect(requested.every((url) => url.searchParams.get('show_fields') === 'business')).toBe(true);
    expect(requested.every((url) => url.searchParams.get('city_limit') === 'true')).toBe(true);
  });

  it('continues to the next upstream page when the first page contains invalid POIs', async () => {
    const requestedPages: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get('page_num'));
        requestedPages.push(page);
        const pois = Array.from({ length: 25 }, (_, index) => ({
          id: `B${page}-${index}`,
          name: `景点${page}-${index}`,
          type: '风景名胜',
          typecode: '110000',
          address: '杭州',
          location: page === 1 && index === 0 ? '181,30' : `120.${index},30.${index}`,
        }));
        return { ok: true, json: async () => ({ status: '1', info: 'OK', count: '50', pois }) };
      }),
    );

    const result = await new AmapPlaceProvider(environment).searchPlaces({
      ...input,
      pageSize: 50,
    });
    expect(requestedPages).toEqual([1, 2]);
    expect(result.items).toHaveLength(49);
  });

  it('slices the raw upstream window before filtering for page two', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get('page_num'));
        const pois = Array.from({ length: 25 }, (_, index) => ({
          id: `B${page}-${index}`,
          name: `景点${page}-${index}`,
          type: '风景名胜',
          typecode: '110000',
          address: '杭州',
          location: page === 1 && index < 5 ? '181,30' : `120.${index},30.${index}`,
        }));
        return { ok: true, json: async () => ({ status: '1', info: 'OK', count: '50', pois }) };
      }),
    );

    const result = await new AmapPlaceProvider(environment).searchPlaces({
      ...input,
      page: 2,
      pageSize: 20,
    });
    expect(result.items).toHaveLength(20);
    expect(result.items.slice(0, 5).map((item) => item.providerPlaceId)).toEqual([
      'B1-20',
      'B1-21',
      'B1-22',
      'B1-23',
      'B1-24',
    ]);
    expect(result.items[5]?.providerPlaceId).toBe('B2-0');
  });

  it('maps HTTP, business and timeout failures to a stable provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    await expect(new AmapPlaceProvider(environment).searchPlaces(input)).rejects.toMatchObject({
      name: 'PlaceProviderError',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ status: '0', info: 'INVALID_USER_KEY' }),
      })),
    );
    await expect(new AmapPlaceProvider(environment).searchPlaces(input)).rejects.toMatchObject({
      name: 'PlaceProviderError',
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
      new AmapPlaceProvider({ ...environment, requestTimeoutMs: 5 }).searchPlaces(input),
    ).rejects.toMatchObject({ name: 'PlaceProviderError' });
    expect(aborted).toBe(true);
  });
});
