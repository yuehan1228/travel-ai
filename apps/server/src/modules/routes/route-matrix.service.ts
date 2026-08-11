import { Inject, Injectable } from '@nestjs/common';

import {
  EstimateRouteMatrixInputSchema,
  RouteMatrixResultSchema,
} from '@travel-guide/shared-schemas';
import type {
  EstimateRouteInput,
  EstimateRouteMatrixInput,
  RouteMatrixCell,
  RouteMatrixPoint,
  RouteMatrixResult,
} from '@travel-guide/shared-types';

import { ROUTE_CLOCK } from './route.tokens';
import { RouteMatrixException } from './route.errors';
import { systemRouteClock, type RouteClock } from './route.clock';
import { RouteException } from './route.errors';
import { normalizeEndpoint, RouteService } from './route.service';

export const ROUTE_MATRIX_MAX_CONCURRENCY = 4;

const validationError = (): RouteMatrixException =>
  new RouteMatrixException(
    'ROUTE_MATRIX_VALIDATION_ERROR',
    400,
    'The route matrix input is invalid',
  );

const providerError = (): RouteMatrixException =>
  new RouteMatrixException(
    'ROUTE_MATRIX_PROVIDER_ERROR',
    502,
    'Route matrix data is temporarily unavailable',
  );

const toMatrixError = (error: unknown): RouteMatrixException => {
  if (error instanceof RouteMatrixException) return error;
  if (error instanceof RouteException && error.code === 'ROUTE_VALIDATION_ERROR') {
    return validationError();
  }
  return providerError();
};

const directedPairs = (
  points: RouteMatrixPoint[],
): Array<{
  origin: RouteMatrixPoint;
  destination: RouteMatrixPoint;
}> => {
  const pairs: Array<{
    origin: RouteMatrixPoint;
    destination: RouteMatrixPoint;
  }> = [];
  for (const origin of points) {
    for (const destination of points) {
      if (origin.id !== destination.id) pairs.push({ origin, destination });
    }
  }
  return pairs;
};

const mapWithConcurrency = async <TItem, TResult>(
  items: TItem[],
  concurrency: number,
  mapper: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> => {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  let firstError: unknown;
  let stopped = false;

  const worker = async (): Promise<void> => {
    while (true) {
      if (stopped) return;
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      try {
        results[index] = await mapper(item);
      } catch (error: unknown) {
        if (!stopped) {
          firstError = error;
          stopped = true;
        }
        return;
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (stopped) throw firstError;
  return results;
};

@Injectable()
export class RouteMatrixService {
  public constructor(
    @Inject(RouteService) private readonly routeService: RouteService,
    @Inject(ROUTE_CLOCK) private readonly clock: RouteClock = systemRouteClock,
  ) {}

  public async estimateRouteMatrix(input: EstimateRouteMatrixInput): Promise<RouteMatrixResult> {
    const parsed = EstimateRouteMatrixInputSchema.safeParse(input);
    if (!parsed.success) throw validationError();

    const normalizedInput: EstimateRouteMatrixInput = {
      points: parsed.data.points.map((point) => ({
        id: point.id,
        endpoint: normalizeEndpoint(point.endpoint),
      })),
      mode: parsed.data.mode,
    };
    const normalizedValidation = EstimateRouteMatrixInputSchema.safeParse(normalizedInput);
    if (!normalizedValidation.success) throw validationError();

    const generatedAt = this.clock.now();
    if (Number.isNaN(generatedAt.getTime())) throw validationError();

    const cells = await mapWithConcurrency(
      directedPairs(normalizedValidation.data.points),
      ROUTE_MATRIX_MAX_CONCURRENCY,
      async ({ origin, destination }): Promise<RouteMatrixCell> => {
        const estimateInput: EstimateRouteInput = {
          origin: origin.endpoint,
          destination: destination.endpoint,
          mode: normalizedValidation.data.mode,
        };
        const estimate = await this.routeService.estimateRoute(estimateInput);
        if (estimate.dataSource === 'unavailable') {
          return {
            originId: origin.id,
            destinationId: destination.id,
            status: 'unavailable',
          };
        }
        return {
          originId: origin.id,
          destinationId: destination.id,
          estimate,
          status: 'available',
        };
      },
    ).catch((error: unknown) => {
      throw toMatrixError(error);
    });

    const result: RouteMatrixResult = {
      points: normalizedValidation.data.points,
      mode: normalizedValidation.data.mode,
      cells,
      generatedAt: generatedAt.toISOString(),
    };
    const validated = RouteMatrixResultSchema.safeParse(result);
    if (!validated.success) throw providerError();
    return validated.data;
  }
}
