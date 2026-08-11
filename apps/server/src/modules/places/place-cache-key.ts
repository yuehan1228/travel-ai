import { createHash } from 'node:crypto';

import type { NormalizedPlaceSearch } from './providers/place.provider';

const normalizedPart = (value: string | undefined, locale: string): string =>
  value?.trim().toLocaleLowerCase(locale) ?? '';

/**
 * Creates a bounded, deterministic public POI cache key. The canonical search
 * input is hashed so the key never exposes a user's keyword or API secret.
 */
export const createPlaceCacheKey = (
  input: Pick<
    NormalizedPlaceSearch,
    'provider' | 'cityName' | 'cityCode' | 'keyword' | 'categories' | 'page' | 'pageSize'
  >,
): string => {
  const canonical = JSON.stringify({
    provider: normalizedPart(input.provider ?? 'amap', 'en-US'),
    cityName: normalizedPart(input.cityName, 'zh-CN'),
    cityCode: normalizedPart(input.cityCode, 'en-US'),
    keyword: normalizedPart(input.keyword, 'zh-CN'),
    categories: [...input.categories].sort(),
    page: input.page,
    pageSize: input.pageSize,
  });
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `place:v1:${digest}`;
};
