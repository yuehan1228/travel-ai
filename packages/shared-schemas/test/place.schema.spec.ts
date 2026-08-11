import { describe, expect, it } from 'vitest';

import {
  GeoPointSchema,
  PlaceListResultSchema,
  PlaceSchema,
  SearchPlacesInputSchema,
} from '../src';

const place = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  provider: 'amap',
  providerPlaceId: 'B0001',
  name: '西湖',
  category: 'attraction' as const,
  categoryText: '景点',
  address: '浙江省杭州市西湖区',
  location: { longitude: 120.15, latitude: 30.25 },
  rating: 4.8,
  verifiedAt: '2026-08-11T00:00:00.000Z',
  dataSource: 'map_provider' as const,
};

describe('place schemas', () => {
  it('accepts strict place searches and public results', () => {
    expect(
      SearchPlacesInputSchema.parse({
        cityName: ' 杭州 ',
        categories: ['attraction', 'restaurant'],
      }),
    ).toEqual({
      cityName: '杭州',
      categories: ['attraction', 'restaurant'],
      page: 1,
      pageSize: 20,
    });
    expect(PlaceSchema.safeParse(place).success).toBe(true);
    expect(
      PlaceListResultSchema.safeParse({
        items: [place],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        fetchedAt: '2026-08-11T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects bad coordinates, ratings, categories, pagination and unknown fields', () => {
    expect(GeoPointSchema.safeParse({ longitude: 181, latitude: 30 }).success).toBe(false);
    expect(PlaceSchema.safeParse({ ...place, rating: 5.1 }).success).toBe(false);
    expect(SearchPlacesInputSchema.safeParse({ cityName: '杭州', categories: [] }).success).toBe(
      false,
    );
    expect(
      SearchPlacesInputSchema.safeParse({
        cityName: '杭州',
        categories: ['restaurant', 'restaurant'],
      }).success,
    ).toBe(false);
    expect(
      SearchPlacesInputSchema.safeParse({
        cityName: '杭州',
        categories: ['restaurant'],
        pageSize: 51,
      }).success,
    ).toBe(false);
    expect(
      SearchPlacesInputSchema.safeParse({
        cityName: '杭州',
        categories: ['restaurant'],
        keyword: 'x'.repeat(81),
      }).success,
    ).toBe(false);
    expect(PlaceSchema.safeParse({ ...place, extra: true }).success).toBe(false);
  });

  it('allows missing optional provider fields and cache source', () => {
    expect(
      PlaceSchema.safeParse({ ...place, rating: undefined, dataSource: 'cache' }).success,
    ).toBe(true);
  });
});
