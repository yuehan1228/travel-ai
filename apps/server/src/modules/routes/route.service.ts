import { Inject, Injectable } from '@nestjs/common';

import { EstimateRouteInputSchema, RouteEstimateSchema } from '@travel-guide/shared-schemas';
import type { EstimateRouteInput, RouteEndpoint, RouteEstimate } from '@travel-guide/shared-types';

import { ROUTE_ENVIRONMENT } from './config/tokens';
import type { RouteEnvironment } from './config/route-environment';
import { createRouteCacheKey } from './route-cache-key';
import { systemRouteClock, type RouteClock } from './route.clock';
import { RouteException } from './route.errors';
import { ROUTE_CACHE_REPOSITORY, ROUTE_CLOCK, ROUTE_PROVIDER } from './route.tokens';
import type { RouteProvider, RouteProviderResult } from './providers/route.provider';
import { RouteProviderResultSchema } from './providers/route.provider';
import type {
  RouteCacheRecordInput,
  RouteCacheRepository,
} from './repositories/route-cache.repository';

const DEFAULT_ROUTE_ENVIRONMENT: Pick<RouteEnvironment, 'cacheTtlSeconds' | 'staleIfErrorSeconds'> =
  {
    cacheTtlSeconds: 3_600,
    staleIfErrorSeconds: 21_600,
  };

const validationError = (): RouteException =>
  new RouteException('ROUTE_VALIDATION_ERROR', 400, 'The route input is invalid');

const providerError = (): RouteException =>
  new RouteException('ROUTE_PROVIDER_ERROR', 502, 'Route data is temporarily unavailable');

const persistenceError = (): RouteException =>
  new RouteException('ROUTE_PERSISTENCE_ERROR', 500, 'Route data could not be persisted');

const normalizeEndpoint = (endpoint: RouteEndpoint): RouteEndpoint => ({
  location: {
    longitude: Number(endpoint.location.longitude.toFixed(6)),
    latitude: Number(endpoint.location.latitude.toFixed(6)),
  },
  ...(endpoint.placeId === undefined ? {} : { placeId: endpoint.placeId.trim() }),
});

const normalizeInput = (input: EstimateRouteInput): EstimateRouteInput => ({
  origin: normalizeEndpoint(input.origin),
  destination: normalizeEndpoint(input.destination),
  mode: input.mode,
});

const isSameRequest = (
  cached: RouteEstimate,
  input: EstimateRouteInput,
  provider: string,
): boolean =>
  cached.provider === provider &&
  cached.mode === input.mode &&
  cached.origin.location.longitude === input.origin.location.longitude &&
  cached.origin.location.latitude === input.origin.location.latitude &&
  cached.destination.location.longitude === input.destination.location.longitude &&
  cached.destination.location.latitude === input.destination.location.latitude;

const cacheResult = (
  cached: RouteEstimate,
  input: EstimateRouteInput,
  provider: string,
): RouteEstimate | undefined => {
  const parsed = RouteEstimateSchema.safeParse(cached);
  if (!parsed.success || !isSameRequest(parsed.data, input, provider)) return undefined;
  if (parsed.data.dataSource === 'unavailable') {
    return {
      ...parsed.data,
      origin: input.origin,
      destination: input.destination,
      mode: input.mode,
    };
  }
  return {
    ...parsed.data,
    origin: input.origin,
    destination: input.destination,
    mode: input.mode,
    dataSource: 'cache',
  };
};

const providerPayload = (
  input: EstimateRouteInput,
  provider: string,
  result: RouteProviderResult,
): RouteEstimate =>
  RouteEstimateSchema.parse({
    origin: input.origin,
    destination: input.destination,
    mode: input.mode,
    distanceMeters: result.distanceMeters,
    durationSeconds: result.durationSeconds,
    ...(result.tollsCny === undefined ? {} : { tollsCny: result.tollsCny }),
    dataSource: 'map_provider',
    provider,
    fetchedAt: result.fetchedAt,
  });

const unavailablePayload = (
  input: EstimateRouteInput,
  provider: string,
  fetchedAt: string,
): RouteEstimate =>
  RouteEstimateSchema.parse({
    origin: input.origin,
    destination: input.destination,
    mode: input.mode,
    dataSource: 'unavailable',
    provider,
    fetchedAt,
  });

@Injectable()
export class RouteService {
  public constructor(
    @Inject(ROUTE_PROVIDER) private readonly provider: RouteProvider,
    @Inject(ROUTE_CACHE_REPOSITORY) private readonly repository: RouteCacheRepository,
    @Inject(ROUTE_CLOCK) private readonly clock: RouteClock = systemRouteClock,
    @Inject(ROUTE_ENVIRONMENT)
    private readonly environment: Pick<
      RouteEnvironment,
      'cacheTtlSeconds' | 'staleIfErrorSeconds'
    > = DEFAULT_ROUTE_ENVIRONMENT,
  ) {}

  public async estimateRoute(input: EstimateRouteInput): Promise<RouteEstimate> {
    const parsedInput = EstimateRouteInputSchema.safeParse(input);
    if (!parsedInput.success) throw validationError();
    const normalizedInput = normalizeInput(parsedInput.data);
    const normalizedValidation = EstimateRouteInputSchema.safeParse(normalizedInput);
    if (!normalizedValidation.success) throw validationError();

    const now = this.clock.now();
    if (Number.isNaN(now.getTime())) throw validationError();
    const request = normalizedValidation.data;
    const cacheKey = this.createCacheKey(request);

    let cached: RouteEstimate | undefined;
    try {
      cached = await this.repository.findFresh(cacheKey, now);
    } catch {
      throw persistenceError();
    }
    const fresh =
      cached === undefined ? undefined : cacheResult(cached, request, this.provider.name);
    if (fresh !== undefined) return fresh;

    let providerResult: RouteProviderResult | undefined;
    try {
      providerResult = await this.provider.estimateRoute(request);
      if (providerResult !== undefined) {
        const validated = RouteProviderResultSchema.safeParse(providerResult);
        if (!validated.success) throw providerError();
        const payload = providerPayload(request, this.provider.name, validated.data);
        await this.saveCache(cacheKey, request, payload, now);
        return payload;
      }

      const unavailable = unavailablePayload(request, this.provider.name, now.toISOString());
      await this.saveCache(cacheKey, request, unavailable, now);
      return unavailable;
    } catch (error: unknown) {
      if (error instanceof RouteException && error.code === 'ROUTE_PERSISTENCE_ERROR') {
        throw error;
      }
      const stale = await this.findStale(cacheKey, request, now);
      if (stale !== undefined) return stale;
      if (error instanceof RouteException && error.code === 'ROUTE_VALIDATION_ERROR') {
        throw error;
      }
      throw providerError();
    }
  }

  public createCacheKey(input: EstimateRouteInput): string {
    const parsed = EstimateRouteInputSchema.parse(normalizeInput(input));
    return createRouteCacheKey(this.provider.name, parsed);
  }

  private async saveCache(
    cacheKey: string,
    input: EstimateRouteInput,
    payload: RouteEstimate,
    now: Date,
  ): Promise<void> {
    const fetchedAt = Date.parse(payload.fetchedAt);
    if (!Number.isFinite(fetchedAt)) throw providerError();
    const cacheInput: RouteCacheRecordInput = {
      provider: this.provider.name,
      cacheKey,
      input,
      payload,
      fetchedAt: new Date(fetchedAt),
      expiresAt: new Date(now.getTime() + this.environment.cacheTtlSeconds * 1_000),
    };
    try {
      await this.repository.save(cacheInput);
    } catch {
      throw persistenceError();
    }
  }

  private async findStale(
    cacheKey: string,
    input: EstimateRouteInput,
    now: Date,
  ): Promise<RouteEstimate | undefined> {
    const maxStaleMs = Math.max(0, this.environment.staleIfErrorSeconds) * 1_000;
    if (maxStaleMs === 0) return undefined;
    try {
      const stale = await this.repository.findStale(cacheKey, now, maxStaleMs);
      if (stale === undefined) return undefined;
      return cacheResult(stale, input, this.provider.name);
    } catch {
      return undefined;
    }
  }
}

export { normalizeInput, normalizeEndpoint };
