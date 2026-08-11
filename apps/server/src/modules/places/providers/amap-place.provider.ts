import { Inject, Injectable } from '@nestjs/common';

import { PLACE_CATEGORIES, type PlaceCategory } from '@travel-guide/shared-types';

import type { PlaceEnvironment } from '../config/place-environment';
import { PLACE_ENVIRONMENT } from '../config/tokens';
import { PlaceProviderError } from '../place.errors';
import type {
  NormalizedPlaceSearch,
  PlaceProvider,
  PlaceProviderResult,
  ProviderPlace,
} from './place.provider';

export const AMAP_PLACE_URL = 'https://restapi.amap.com/v5/place/text';
const UPSTREAM_PAGE_SIZE = 25;

const categoryLabels: Record<PlaceCategory, string> = {
  attraction: '景点',
  museum: '博物馆',
  park: '公园',
  restaurant: '餐厅',
  local_food: '地方美食',
  cafe: '咖啡店',
  shopping: '购物',
  nightlife: '休闲娱乐',
  hotel_area: '酒店',
  other: '地点',
};

const categoryTypeCodes: Record<PlaceCategory, readonly string[]> = {
  attraction: ['110000'],
  museum: ['140000'],
  park: ['110200'],
  restaurant: ['050000'],
  local_food: ['050100'],
  cafe: ['050500'],
  shopping: ['060000'],
  nightlife: ['080000'],
  hotel_area: ['100000'],
  other: [],
};

interface AmapPoi {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly type?: unknown;
  readonly typecode?: unknown;
  readonly address?: unknown;
  readonly location?: unknown;
  readonly tel?: unknown;
  readonly business?: unknown;
}

interface AmapResponse {
  readonly status?: unknown;
  readonly info?: unknown;
  readonly count?: unknown;
  readonly pois?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const rating = (value: unknown): number | undefined => {
  const numeric =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 5 ? numeric : undefined;
};

const point = (value: unknown): { longitude: number; latitude: number } | undefined => {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  const longitude = parts[0];
  const latitude = parts[1];
  if (
    longitude === undefined ||
    latitude === undefined ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return undefined;
  }
  return { longitude, latitude };
};

const matchesType = (type: string, category: PlaceCategory): boolean => {
  const value = type.toLowerCase();
  if (category === 'museum') return value.includes('博物馆') || value.includes('展览馆');
  if (category === 'park') return value.includes('公园') || value.includes('广场');
  if (category === 'cafe') return value.includes('咖啡');
  if (category === 'local_food') return value.includes('中餐') || value.includes('地方');
  if (category === 'restaurant') return value.includes('餐饮') || value.includes('餐厅');
  if (category === 'shopping') return value.includes('购物') || value.includes('商场');
  if (category === 'nightlife') return value.includes('休闲') || value.includes('娱乐');
  if (category === 'hotel_area') return value.includes('住宿') || value.includes('酒店');
  if (category === 'attraction') return value.includes('风景') || value.includes('景点');
  return true;
};

const mapCategory = (
  rawType: string,
  rawTypeCode: string,
  requested: readonly PlaceCategory[],
): PlaceCategory | undefined => {
  const candidates: PlaceCategory[] = [
    'museum',
    'park',
    'cafe',
    'local_food',
    'restaurant',
    'shopping',
    'nightlife',
    'hotel_area',
    'attraction',
  ];
  for (const category of candidates) {
    if (
      requested.includes(category) &&
      (matchesType(rawType, category) ||
        categoryTypeCodes[category].some((code) => rawTypeCode.startsWith(code)))
    ) {
      return category;
    }
  }
  return requested.includes('other') ? 'other' : undefined;
};

const mapPoi = (
  raw: unknown,
  requested: readonly PlaceCategory[],
  provider: string,
): ProviderPlace | undefined => {
  const poi = asRecord(raw) as AmapPoi | undefined;
  const providerPlaceId = text(poi?.id);
  const name = text(poi?.name);
  const rawType = text(poi?.type);
  const rawTypeCode = text(poi?.typecode);
  const address = text(poi?.address);
  const location = point(poi?.location);
  if (
    providerPlaceId === undefined ||
    name === undefined ||
    rawType === undefined ||
    rawTypeCode === undefined ||
    address === undefined ||
    location === undefined
  ) {
    return undefined;
  }

  const category = mapCategory(rawType, rawTypeCode, requested);
  if (category === undefined) return undefined;
  const business = asRecord(poi?.business);
  const telephone = text(business?.tel) ?? text(poi?.tel);
  const openingHours = text(business?.opentime_week) ?? text(business?.opentime_today);
  const score = rating(business?.rating);
  return {
    provider,
    providerPlaceId,
    name,
    category,
    categoryText: categoryLabels[category],
    address,
    location,
    ...(score === undefined ? {} : { rating: score }),
    ...(openingHours === undefined ? {} : { openingHours }),
    ...(telephone === undefined ? {} : { telephone }),
    rawTypeCode,
  };
};

@Injectable()
export class AmapPlaceProvider implements PlaceProvider {
  public readonly name = 'amap';

  public constructor(@Inject(PLACE_ENVIRONMENT) private readonly environment: PlaceEnvironment) {}

  public async searchPlaces(input: NormalizedPlaceSearch): Promise<PlaceProviderResult> {
    if (
      this.environment.apiKey.trim().length === 0 ||
      this.environment.apiKey.startsWith('replace-')
    ) {
      throw new PlaceProviderError();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.environment.requestTimeoutMs);
    try {
      const typeCodes = input.categories
        .flatMap((category) => categoryTypeCodes[category])
        .filter((code, index, values) => values.indexOf(code) === index)
        .join('|');
      const requestedOffset = (input.page - 1) * input.pageSize;
      const firstPage = Math.floor(requestedOffset / UPSTREAM_PAGE_SIZE) + 1;
      const lastPage = Math.ceil((requestedOffset + input.pageSize) / UPSTREAM_PAGE_SIZE);
      const finalPage = Math.min(firstPage + 2, Math.max(firstPage, lastPage));
      const fetchedPois: unknown[] = [];
      let total: number | undefined;

      for (let pageNumber = firstPage; pageNumber <= finalPage; pageNumber += 1) {
        const params = new URLSearchParams({
          key: this.environment.apiKey,
          region: input.cityCode ?? input.cityName,
          city_limit: 'true',
          keywords:
            input.keyword ?? input.categories.map((category) => categoryLabels[category]).join(' '),
          page_size: String(UPSTREAM_PAGE_SIZE),
          page_num: String(pageNumber),
          show_fields: 'business',
          output: 'JSON',
        });
        if (typeCodes.length > 0) params.set('types', typeCodes);

        const response = await fetch(`${AMAP_PLACE_URL}?${params.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!response.ok) throw new PlaceProviderError();
        const body = asRecord(await response.json()) as AmapResponse | undefined;
        if (
          body?.status !== '1' ||
          typeof body.info !== 'string' ||
          body.info.toUpperCase() !== 'OK' ||
          !Array.isArray(body.pois)
        ) {
          throw new PlaceProviderError();
        }

        fetchedPois.push(...body.pois);
        const count = typeof body.count === 'string' ? Number(body.count) : body.count;
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
          total = Math.max(total ?? 0, count);
        }
        if (body.pois.length < UPSTREAM_PAGE_SIZE) break;
      }

      const localOffset = requestedOffset - (firstPage - 1) * UPSTREAM_PAGE_SIZE;
      const items = fetchedPois
        .slice(localOffset, localOffset + input.pageSize)
        .map((poi) => mapPoi(poi, input.categories, this.name))
        .filter((poi): poi is ProviderPlace => poi !== undefined);
      return {
        items,
        ...(total === undefined ? {} : { total }),
        fetchedAt: new Date().toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof PlaceProviderError) throw error;
      throw new PlaceProviderError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { PLACE_CATEGORIES };
