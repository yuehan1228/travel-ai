import { createHash } from 'node:crypto';

import type { EstimateRouteInput } from '@travel-guide/shared-types';

export interface RouteCacheKeyInput extends EstimateRouteInput {
  readonly provider?: string;
}

const normalizedCoordinate = (value: number): number => Number(value.toFixed(6));

/** Returns a fixed-size key which contains no user identifier, coordinate text, or API key. */
export function createRouteCacheKey(provider: string, input: EstimateRouteInput): string;
export function createRouteCacheKey(input: RouteCacheKeyInput): string;
export function createRouteCacheKey(
  providerOrInput: string | RouteCacheKeyInput,
  maybeInput?: EstimateRouteInput,
): string {
  const provider = typeof providerOrInput === 'string' ? providerOrInput : providerOrInput.provider;
  const input = typeof providerOrInput === 'string' ? maybeInput : providerOrInput;
  if (input === undefined) throw new Error('Route cache key input is required');
  const canonical = JSON.stringify({
    provider: (provider ?? 'amap').trim().toLowerCase(),
    mode: input.mode,
    origin: {
      longitude: normalizedCoordinate(input.origin.location.longitude),
      latitude: normalizedCoordinate(input.origin.location.latitude),
    },
    destination: {
      longitude: normalizedCoordinate(input.destination.location.longitude),
      latitude: normalizedCoordinate(input.destination.location.latitude),
    },
  });
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `route:v1:${digest}`;
}

export { normalizedCoordinate };
