import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { RouteEstimateSchema } from '@travel-guide/shared-schemas';
import type { EstimateRouteInput, RouteEstimate } from '@travel-guide/shared-types';

import { DATABASE } from '../../../database/database.tokens';
import type { Database } from '../../../database/database.types';
import { routeCache } from '../../../database/schema/route-cache.schema';
import { ROUTE_CACHE_REPOSITORY } from '../route.tokens';

export interface RouteCacheRecordInput {
  readonly provider: string;
  readonly cacheKey: string;
  readonly input: EstimateRouteInput;
  readonly payload: RouteEstimate;
  readonly fetchedAt: Date;
  readonly expiresAt: Date;
}

export interface RouteCacheRepository {
  findFresh(cacheKey: string, now: Date): Promise<RouteEstimate | undefined>;
  findStale(cacheKey: string, now: Date, maxStaleMs: number): Promise<RouteEstimate | undefined>;
  save(input: RouteCacheRecordInput): Promise<void>;
}

const parsedPayload = (payload: unknown): RouteEstimate | undefined => {
  const parsed = RouteEstimateSchema.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
};

@Injectable()
export class DrizzleRouteCacheRepository implements RouteCacheRepository {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public async findFresh(cacheKey: string, now: Date): Promise<RouteEstimate | undefined> {
    return this.find(cacheKey, now, 0);
  }

  public async findStale(
    cacheKey: string,
    now: Date,
    maxStaleMs: number,
  ): Promise<RouteEstimate | undefined> {
    return this.find(cacheKey, now, maxStaleMs);
  }

  private async find(
    cacheKey: string,
    now: Date,
    maxStaleMs: number,
  ): Promise<RouteEstimate | undefined> {
    const lowerBound = new Date(now.getTime() - Math.max(0, maxStaleMs));
    const rows = await this.database
      .select()
      .from(routeCache)
      .where(and(eq(routeCache.cacheKey, cacheKey), gt(routeCache.expiresAt, lowerBound)))
      .limit(1);
    const row = rows[0];
    if (row === undefined || (maxStaleMs === 0 && row.expiresAt <= now)) return undefined;
    return parsedPayload(row.payload);
  }

  public async save(input: RouteCacheRecordInput): Promise<void> {
    const payload = RouteEstimateSchema.parse(input.payload);
    const now = new Date();
    await this.database
      .insert(routeCache)
      .values({
        id: randomUUID(),
        provider: input.provider,
        cacheKey: input.cacheKey,
        mode: input.input.mode,
        originLongitude: input.input.origin.location.longitude,
        originLatitude: input.input.origin.location.latitude,
        destinationLongitude: input.input.destination.location.longitude,
        destinationLatitude: input.input.destination.location.latitude,
        payload,
        fetchedAt: input.fetchedAt,
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: routeCache.cacheKey,
        set: {
          provider: input.provider,
          mode: input.input.mode,
          originLongitude: input.input.origin.location.longitude,
          originLatitude: input.input.origin.location.latitude,
          destinationLongitude: input.input.destination.location.longitude,
          destinationLatitude: input.input.destination.location.latitude,
          payload,
          fetchedAt: input.fetchedAt,
          expiresAt: input.expiresAt,
          updatedAt: now,
        },
      });
  }
}

export { ROUTE_CACHE_REPOSITORY };
