import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { PlaceListResultSchema, PlaceSchema } from '@travel-guide/shared-schemas';
import type { Place, PlaceListResult } from '@travel-guide/shared-types';

import { DATABASE } from '../../../database/database.tokens';
import type { Database } from '../../../database/database.types';
import {
  poiSearchCache,
  pois,
  type Poi,
  type PoiSearchCache,
} from '../../../database/schema/places.schema';
import { PLACE_REPOSITORY } from '../place.tokens';
import { createPlaceCacheKey } from '../place-cache-key';
import type { NormalizedPlaceSearch, ProviderPlace } from '../providers/place.provider';

export interface PlaceRepository {
  findFreshSearch(input: NormalizedPlaceSearch, now: Date): Promise<PlaceListResult | undefined>;

  upsertProviderPlaces(input: ProviderPlace[], expiresAt: Date): Promise<Place[]>;

  saveSearchResult(
    input: NormalizedPlaceSearch,
    places: Place[],
    total: number,
    expiresAt: Date,
  ): Promise<void>;

  /** Optional stale-if-error lookup. Implementations may omit it. */
  findStaleSearch?(
    input: NormalizedPlaceSearch,
    now: Date,
    maxStaleMs: number,
  ): Promise<PlaceListResult | undefined>;
}

const totalPages = (total: number, pageSize: number): number =>
  total === 0 ? 0 : Math.ceil(total / pageSize);

const cacheKeyFor = (input: NormalizedPlaceSearch): string => {
  return createPlaceCacheKey(input);
};

const placeFromRow = (row: Poi, source: 'map_provider' | 'cache'): Place | undefined => {
  const parsed = PlaceSchema.safeParse(row.payload);
  if (!parsed.success) return undefined;
  return {
    ...parsed.data,
    id: row.id,
    provider: row.provider,
    providerPlaceId: row.providerPlaceId,
    name: row.name,
    category: row.category as Place['category'],
    categoryText: row.categoryText,
    address: row.address,
    location: { longitude: row.longitude, latitude: row.latitude },
    ...(row.rating === null ? {} : { rating: row.rating }),
    ...(row.openingHours === null ? {} : { openingHours: row.openingHours }),
    ...(row.telephone === null ? {} : { telephone: row.telephone }),
    verifiedAt: row.verifiedAt.toISOString(),
    dataSource: source,
  };
};

const searchResultFromRows = (
  cache: PoiSearchCache,
  rows: Poi[],
  source: 'map_provider' | 'cache',
): PlaceListResult | undefined => {
  if (!Array.isArray(cache.placeIds) || !cache.placeIds.every((id) => typeof id === 'string')) {
    return undefined;
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items: Place[] = [];
  for (const id of cache.placeIds) {
    const row = byId.get(id);
    if (row === undefined) return undefined;
    const place = placeFromRow(row, source);
    if (place === undefined) return undefined;
    items.push(place);
  }
  const result: PlaceListResult = {
    items,
    pagination: {
      page: cache.page,
      pageSize: cache.pageSize,
      total: cache.total,
      totalPages: totalPages(cache.total, cache.pageSize),
    },
    fetchedAt: cache.fetchedAt.toISOString(),
  };
  const parsed = PlaceListResultSchema.safeParse(result);
  return parsed.success ? parsed.data : undefined;
};

@Injectable()
export class DrizzlePlaceRepository implements PlaceRepository {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public async findFreshSearch(
    input: NormalizedPlaceSearch,
    now: Date,
  ): Promise<PlaceListResult | undefined> {
    return this.findSearch(input, now, 0, 'cache');
  }

  public async findStaleSearch(
    input: NormalizedPlaceSearch,
    now: Date,
    maxStaleMs: number,
  ): Promise<PlaceListResult | undefined> {
    return this.findSearch(input, now, maxStaleMs, 'cache');
  }

  private async findSearch(
    input: NormalizedPlaceSearch,
    now: Date,
    maxStaleMs: number,
    source: 'cache',
  ): Promise<PlaceListResult | undefined> {
    const lowerBound = new Date(now.getTime() - maxStaleMs);
    const rows = await this.database
      .select()
      .from(poiSearchCache)
      .where(
        and(
          eq(poiSearchCache.cacheKey, cacheKeyFor(input)),
          gt(poiSearchCache.expiresAt, lowerBound),
        ),
      )
      .limit(1);
    const cache = rows[0];
    if (cache === undefined || cache.expiresAt <= now) {
      if (maxStaleMs === 0 || cache === undefined) return undefined;
    }

    if (cache === undefined || !Array.isArray(cache.placeIds)) return undefined;
    const ids = cache.placeIds.filter((id): id is string => typeof id === 'string');
    if (ids.length !== cache.placeIds.length || ids.length === 0) {
      return cache.placeIds.length === 0 ? searchResultFromRows(cache, [], source) : undefined;
    }
    const poiRows = await this.database
      .select()
      .from(pois)
      .where(and(inArray(pois.id, ids), gt(pois.expiresAt, lowerBound)));
    return searchResultFromRows(cache, poiRows, source);
  }

  public async upsertProviderPlaces(input: ProviderPlace[], expiresAt: Date): Promise<Place[]> {
    const now = new Date();
    const rows: Place[] = [];
    for (const providerPlace of input) {
      const place: Place = PlaceSchema.parse({
        id: randomUUID(),
        provider: providerPlace.provider,
        providerPlaceId: providerPlace.providerPlaceId,
        name: providerPlace.name,
        category: providerPlace.category,
        categoryText: providerPlace.categoryText,
        address: providerPlace.address,
        location: providerPlace.location,
        ...(providerPlace.rating === undefined ? {} : { rating: providerPlace.rating }),
        ...(providerPlace.openingHours === undefined
          ? {}
          : { openingHours: providerPlace.openingHours }),
        ...(providerPlace.telephone === undefined ? {} : { telephone: providerPlace.telephone }),
        verifiedAt: now.toISOString(),
        dataSource: 'map_provider',
      });
      const inserted = await this.database
        .insert(pois)
        .values({
          id: place.id,
          provider: place.provider,
          providerPlaceId: place.providerPlaceId,
          cityName: providerPlace.cityName ?? '',
          cityCode: providerPlace.cityCode,
          name: place.name,
          category: place.category,
          categoryText: place.categoryText,
          address: place.address,
          longitude: place.location.longitude,
          latitude: place.location.latitude,
          rating: place.rating,
          openingHours: place.openingHours,
          telephone: place.telephone,
          rawTypeCode: providerPlace.rawTypeCode,
          payload: place,
          verifiedAt: now,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [pois.provider, pois.providerPlaceId],
          set: {
            cityName: providerPlace.cityName ?? '',
            cityCode: providerPlace.cityCode,
            name: place.name,
            category: place.category,
            categoryText: place.categoryText,
            address: place.address,
            longitude: place.location.longitude,
            latitude: place.location.latitude,
            rating: place.rating,
            openingHours: place.openingHours,
            telephone: place.telephone,
            rawTypeCode: providerPlace.rawTypeCode,
            payload: place,
            verifiedAt: now,
            expiresAt,
            updatedAt: now,
          },
        })
        .returning();
      const row = inserted[0];
      if (row !== undefined) {
        const mapped = placeFromRow(row, 'map_provider');
        if (mapped !== undefined) rows.push(mapped);
      }
    }
    return rows;
  }

  public async saveSearchResult(
    input: NormalizedPlaceSearch,
    places: Place[],
    total: number,
    expiresAt: Date,
  ): Promise<void> {
    const now = new Date();
    const fetchedAt = places
      .map((place) => Date.parse(place.verifiedAt))
      .filter((value) => Number.isFinite(value))
      .sort()
      .at(-1);
    const fetchedAtDate = new Date(fetchedAt ?? now.getTime());
    await this.database
      .insert(poiSearchCache)
      .values({
        id: randomUUID(),
        cacheKey: cacheKeyFor(input),
        provider: input.provider ?? 'amap',
        cityName: input.cityName,
        cityCode: input.cityCode,
        keyword: input.keyword,
        categories: [...input.categories],
        page: input.page,
        pageSize: input.pageSize,
        placeIds: places.map((place) => place.id),
        total,
        fetchedAt: fetchedAtDate,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: poiSearchCache.cacheKey,
        set: {
          provider: input.provider ?? 'amap',
          cityName: input.cityName,
          cityCode: input.cityCode,
          keyword: input.keyword,
          categories: [...input.categories],
          page: input.page,
          pageSize: input.pageSize,
          placeIds: places.map((place) => place.id),
          total,
          fetchedAt: fetchedAtDate,
          expiresAt,
          updatedAt: now,
        },
      });
  }
}

export { PLACE_REPOSITORY };
export type { NormalizedPlaceSearch } from '../providers/place.provider';
