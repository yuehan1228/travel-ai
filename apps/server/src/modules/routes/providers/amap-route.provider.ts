import { Inject, Injectable } from '@nestjs/common';

import type { EstimateRouteInput, RouteMode } from '@travel-guide/shared-types';

import { ROUTE_ENVIRONMENT, ROUTE_FETCH } from '../config/tokens';
import type { RouteEnvironment } from '../config/route-environment';
import { RouteProviderError } from '../route.errors';
import type { RouteProvider, RouteProviderResult } from './route.provider';

export const AMAP_ROUTE_HOST = 'https://restapi.amap.com';
export const AMAP_ROUTE_URL = `${AMAP_ROUTE_HOST}/v5/direction`;
export const AMAP_WALKING_URL = `${AMAP_ROUTE_URL}/walking`;
export const AMAP_DRIVING_URL = `${AMAP_ROUTE_URL}/driving`;

export interface RouteFetchResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

export type RouteFetch = (input: string, init?: RequestInit) => Promise<RouteFetchResponse>;

interface AmapPath {
  readonly distance?: unknown;
  readonly cost?: unknown;
  readonly tolls?: unknown;
  readonly duration?: unknown;
}

interface AmapRoute {
  readonly paths?: unknown;
}

interface AmapResponse {
  readonly status?: unknown;
  readonly info?: unknown;
  readonly infocode?: unknown;
  readonly count?: unknown;
  readonly route?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const asPositiveInteger = (value: unknown): number | undefined => {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
};

const asTolls = (value: unknown): number | undefined => {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0 || Math.round(number * 100) / 100 !== number) {
    return undefined;
  }
  return number;
};

const optionalTolls = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = asTolls(value);
  if (parsed === undefined) throw new RouteProviderError();
  return parsed;
};

const formatCoordinate = (value: number): string => {
  const rounded = Number(value.toFixed(6));
  return String(rounded);
};

const formatPoint = (input: EstimateRouteInput['origin']): string =>
  `${formatCoordinate(input.location.longitude)},${formatCoordinate(input.location.latitude)}`;

const endpointUrl = (mode: RouteMode): string =>
  mode === 'walking' ? AMAP_WALKING_URL : AMAP_DRIVING_URL;

const getDuration = (path: AmapPath): number | undefined => {
  const cost = asRecord(path.cost);
  return asPositiveInteger(cost?.duration) ?? asPositiveInteger(path.duration);
};

@Injectable()
export class AmapRouteProvider implements RouteProvider {
  public readonly name = 'amap';

  public constructor(
    @Inject(ROUTE_ENVIRONMENT) private readonly environment: RouteEnvironment,
    @Inject(ROUTE_FETCH)
    private readonly fetchImpl: RouteFetch = (input, init) => fetch(input, init),
  ) {}

  public async estimateRoute(input: EstimateRouteInput): Promise<RouteProviderResult | undefined> {
    if (input.mode !== 'walking' && input.mode !== 'driving') {
      throw new RouteProviderError();
    }
    if (
      this.environment.apiKey.trim().length === 0 ||
      this.environment.apiKey.startsWith('replace-')
    ) {
      throw new RouteProviderError();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.environment.requestTimeoutMs);
    try {
      const params = new URLSearchParams({
        key: this.environment.apiKey,
        origin: formatPoint(input.origin),
        destination: formatPoint(input.destination),
        output: 'JSON',
        show_fields: 'cost',
      });
      if (input.origin.placeId !== undefined) params.set('origin_id', input.origin.placeId);
      if (input.destination.placeId !== undefined) {
        params.set('destination_id', input.destination.placeId);
      }

      const response = await this.fetchImpl(`${endpointUrl(input.mode)}?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) throw new RouteProviderError();

      const body = asRecord(await response.json()) as AmapResponse | undefined;
      if (
        (body?.status !== '1' && body?.status !== 1) ||
        typeof body.info !== 'string' ||
        body.info.toUpperCase() !== 'OK' ||
        (body.infocode !== undefined && String(body.infocode) !== '10000')
      ) {
        throw new RouteProviderError();
      }

      const count = asPositiveInteger(body.count);
      if (body.count !== undefined && count === undefined) throw new RouteProviderError();
      if (count === 0) return undefined;
      const route = asRecord(body.route) as AmapRoute | undefined;
      if (route === undefined || !Array.isArray(route.paths)) throw new RouteProviderError();
      if (route.paths.length === 0) return undefined;
      const path = asRecord(route.paths[0]) as AmapPath | undefined;
      if (path === undefined) throw new RouteProviderError();

      const distanceMeters = asPositiveInteger(path.distance);
      const durationSeconds = getDuration(path);
      if (distanceMeters === undefined || durationSeconds === undefined) {
        throw new RouteProviderError();
      }

      const tollValue =
        input.mode === 'driving'
          ? optionalTolls(path.tolls ?? asRecord(path.cost)?.tolls)
          : undefined;
      return {
        distanceMeters,
        durationSeconds,
        ...(tollValue === undefined ? {} : { tollsCny: tollValue }),
        fetchedAt: new Date().toISOString(),
      };
    } catch (error: unknown) {
      if (error instanceof RouteProviderError) throw error;
      throw new RouteProviderError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { formatCoordinate, formatPoint };
