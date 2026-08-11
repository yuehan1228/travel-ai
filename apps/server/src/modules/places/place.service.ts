import { Inject, Injectable } from '@nestjs/common';

import {
  PlaceListResultSchema,
  PlaceSchema,
  SearchPlacesInputSchema,
} from '@travel-guide/shared-schemas';
import type {
  Place,
  PlaceCategory,
  PlaceListResult,
  SearchPlacesInput,
} from '@travel-guide/shared-types';

import { PLACE_CLOCK, PLACE_PROVIDER, PLACE_REPOSITORY } from './place.tokens';
import { PLACE_ENVIRONMENT } from './config/tokens';
import type { PlaceEnvironment } from './config/place-environment';
import { PlaceException } from './place.errors';
import { createPlaceCacheKey } from './place-cache-key';
import { systemPlaceClock, type PlaceClock } from './place.clock';
import { ProviderPlaceSchema } from './providers/place.provider';
import type {
  NormalizedPlaceSearch,
  PlaceProvider,
  PlaceProviderResult,
  ProviderPlace,
} from './providers/place.provider';
import type { PlaceRepository } from './repositories/place.repository';

const PLACE_STALE_IF_ERROR_MS = 6 * 60 * 60 * 1000;
const DEFAULT_PLACE_ENVIRONMENT: Pick<PlaceEnvironment, 'cacheTtlSeconds'> = {
  cacheTtlSeconds: 3_600,
};

const validationError = (): PlaceException =>
  new PlaceException('PLACE_VALIDATION_ERROR', 400, 'The place input is invalid');

const providerError = (): PlaceException =>
  new PlaceException('PLACE_PROVIDER_ERROR', 502, 'Place data is temporarily unavailable');

const persistenceError = (): PlaceException =>
  new PlaceException('PLACE_PERSISTENCE_ERROR', 500, 'Place data could not be persisted');

const normalizeSearch = (input: SearchPlacesInput, provider: string): NormalizedPlaceSearch => {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  const categories = [...input.categories].sort() as PlaceCategory[];
  const cityName = input.cityName.trim();
  const cityCode = input.cityCode?.trim();
  const keyword = input.keyword?.trim();
  return {
    provider,
    cityName,
    ...(cityCode === undefined ? {} : { cityCode }),
    ...(keyword === undefined ? {} : { keyword }),
    categories,
    page,
    pageSize,
  };
};

const validFetchedAt = (value: string | undefined, fallback: Date): string => {
  if (value !== undefined && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return fallback.toISOString();
};

const providerPlaceToValidationShape = (
  item: ProviderPlace,
  provider: string,
): ProviderPlace | undefined => {
  const parsed = ProviderPlaceSchema.safeParse(item);
  if (!parsed.success || parsed.data.provider !== provider) return undefined;
  return parsed.data;
};

const stableSort = (items: Place[]): Place[] =>
  [...items].sort((left, right) => {
    const nameOrder = left.name.localeCompare(right.name, 'zh-CN');
    return nameOrder !== 0 ? nameOrder : left.providerPlaceId.localeCompare(right.providerPlaceId);
  });

const totalPages = (total: number, pageSize: number): number =>
  total === 0 ? 0 : Math.ceil(total / pageSize);

@Injectable()
export class PlaceService {
  public constructor(
    @Inject(PLACE_PROVIDER) private readonly provider: PlaceProvider,
    @Inject(PLACE_REPOSITORY) private readonly repository: PlaceRepository,
    @Inject(PLACE_CLOCK) private readonly clock: PlaceClock = systemPlaceClock,
    @Inject(PLACE_ENVIRONMENT)
    private readonly environment: Pick<
      PlaceEnvironment,
      'cacheTtlSeconds'
    > = DEFAULT_PLACE_ENVIRONMENT,
  ) {}

  public async searchPlaces(input: SearchPlacesInput): Promise<PlaceListResult> {
    const parsedInput = SearchPlacesInputSchema.safeParse(input);
    if (!parsedInput.success) throw validationError();
    const now = this.clock.now();
    if (Number.isNaN(now.getTime())) throw validationError();
    const normalized = normalizeSearch(parsedInput.data, this.provider.name);

    try {
      const cached = await this.repository.findFreshSearch(normalized, now);
      if (cached !== undefined) {
        const parsedCached = PlaceListResultSchema.safeParse(cached);
        if (parsedCached.success) {
          return parsedCached.data;
        }
      }
    } catch {
      throw persistenceError();
    }

    let fetched: PlaceProviderResult;
    try {
      fetched = await this.provider.searchPlaces(normalized);
    } catch {
      const stale = await this.tryStale(normalized, now);
      if (stale !== undefined) return stale;
      throw providerError();
    }

    if (
      typeof fetched !== 'object' ||
      fetched === null ||
      !Array.isArray(fetched.items) ||
      typeof fetched.fetchedAt !== 'string' ||
      Number.isNaN(Date.parse(fetched.fetchedAt))
    ) {
      throw providerError();
    }

    const fetchedAt = validFetchedAt(fetched.fetchedAt, now);
    const candidates = fetched.items;
    const unique = new Map<string, ProviderPlace>();
    for (const candidate of candidates) {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        continue;
      }
      if (candidate.provider !== this.provider.name || unique.has(candidate.providerPlaceId)) {
        continue;
      }
      const validated = providerPlaceToValidationShape(candidate, this.provider.name);
      if (validated !== undefined) unique.set(validated.providerPlaceId, validated);
    }

    const providerPlaces = [...unique.values()].map((item) => ({
      ...item,
      cityName: normalized.cityName,
      ...(normalized.cityCode === undefined ? {} : { cityCode: normalized.cityCode }),
    }));
    const expiresAt = new Date(now.getTime() + this.environment.cacheTtlSeconds * 1_000);
    let persisted: Place[];
    try {
      persisted = await this.repository.upsertProviderPlaces(providerPlaces, expiresAt);
      const parsedPersisted = persisted.filter((item) => PlaceSchema.safeParse(item).success);
      persisted = stableSort(parsedPersisted);
      const reportedTotal =
        typeof fetched.total === 'number' &&
        Number.isInteger(fetched.total) &&
        Number.isSafeInteger(fetched.total) &&
        fetched.total >= 0 &&
        fetched.total <= 2_147_483_647 &&
        fetched.total >= persisted.length
          ? fetched.total
          : persisted.length;
      await this.repository.saveSearchResult(normalized, persisted, reportedTotal, expiresAt);
      const result: PlaceListResult = {
        items: persisted,
        pagination: {
          page: normalized.page,
          pageSize: normalized.pageSize,
          total: reportedTotal,
          totalPages: totalPages(reportedTotal, normalized.pageSize),
        },
        fetchedAt,
      };
      return PlaceListResultSchema.parse(result);
    } catch (error: unknown) {
      if (error instanceof PlaceException) throw error;
      throw persistenceError();
    }
  }

  public createCacheKey(input: NormalizedPlaceSearch): string {
    return createPlaceCacheKey(input);
  }

  private async tryStale(
    input: NormalizedPlaceSearch,
    now: Date,
  ): Promise<PlaceListResult | undefined> {
    if (this.repository.findStaleSearch === undefined) return undefined;
    try {
      const stale = await this.repository.findStaleSearch(input, now, PLACE_STALE_IF_ERROR_MS);
      if (stale === undefined) return undefined;
      const parsed = PlaceListResultSchema.safeParse(stale);
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }
}
