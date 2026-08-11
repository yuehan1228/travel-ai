import { Inject, Injectable } from '@nestjs/common';

import {
  EstimateRouteOrderInputSchema,
  RouteMatrixResultSchema,
} from '@travel-guide/shared-schemas';
import type {
  EstimateRouteMatrixInput,
  EstimateRouteOrderInput,
  RouteMatrixResult,
  RouteOrderExplanationResult,
  RouteOrderResult,
} from '@travel-guide/shared-types';

import { RouteException, RouteMatrixException, RouteOrderException } from './route.errors';
import {
  calculateNearestNeighborOrder,
  calculateNearestNeighborOrderWithExplanation,
  RouteOrderAlgorithmError,
} from './route-order.algorithm';
import { RouteMatrixService } from './route-matrix.service';

const validationError = (): RouteOrderException =>
  new RouteOrderException('ROUTE_ORDER_VALIDATION_ERROR', 400, 'The route order input is invalid');

const providerError = (): RouteOrderException =>
  new RouteOrderException(
    'ROUTE_ORDER_PROVIDER_ERROR',
    502,
    'Route order data is temporarily unavailable',
  );

const unavailableError = (): RouteOrderException =>
  new RouteOrderException(
    'ROUTE_ORDER_UNAVAILABLE',
    404,
    'No complete route order is available for the requested points',
  );

const mapMatrixError = (error: unknown): RouteOrderException => {
  if (error instanceof RouteOrderException) return error;
  if (error instanceof RouteMatrixException) {
    if (error.code === 'ROUTE_MATRIX_VALIDATION_ERROR') return validationError();
    if (error.code === 'ROUTE_MATRIX_UNAVAILABLE') return unavailableError();
    return providerError();
  }
  if (error instanceof RouteException && error.code === 'ROUTE_VALIDATION_ERROR') {
    return validationError();
  }
  return providerError();
};

@Injectable()
export class RouteOrderService {
  public constructor(
    @Inject(RouteMatrixService) private readonly routeMatrixService: RouteMatrixService,
  ) {}

  public async estimateRouteOrder(input: EstimateRouteOrderInput): Promise<RouteOrderResult> {
    const parsed = this.parseInput(input);
    const matrix = await this.getMatrix(parsed);
    try {
      return calculateNearestNeighborOrder(matrix, parsed.data.startId, parsed.data.endId);
    } catch (error: unknown) {
      if (error instanceof RouteOrderAlgorithmError) {
        if (error.code === 'ROUTE_ORDER_VALIDATION_ERROR') throw validationError();
        throw unavailableError();
      }
      throw providerError();
    }
  }

  /** Generate an order and its per-step explanation from the same fetched matrix. */
  public async estimateRouteOrderExplanation(
    input: EstimateRouteOrderInput,
  ): Promise<RouteOrderExplanationResult> {
    const parsed = this.parseInput(input);
    const matrix = await this.getMatrix(parsed);
    try {
      return calculateNearestNeighborOrderWithExplanation(
        matrix,
        parsed.data.startId,
        parsed.data.endId,
      );
    } catch (error: unknown) {
      if (error instanceof RouteOrderAlgorithmError) {
        if (error.code === 'ROUTE_ORDER_VALIDATION_ERROR') throw validationError();
        throw unavailableError();
      }
      throw providerError();
    }
  }

  private parseInput(input: EstimateRouteOrderInput): {
    data: EstimateRouteOrderInput;
  } {
    const parsed = EstimateRouteOrderInputSchema.safeParse(input);
    if (!parsed.success) throw validationError();
    return parsed;
  }

  private async getMatrix(parsed: { data: EstimateRouteOrderInput }): Promise<RouteMatrixResult> {
    try {
      const matrixInput: EstimateRouteMatrixInput = {
        points: parsed.data.points,
        mode: parsed.data.mode,
      };
      const matrixResult = await this.routeMatrixService.estimateRouteMatrix(matrixInput);
      const validatedMatrix = RouteMatrixResultSchema.safeParse(matrixResult);
      if (!validatedMatrix.success) throw providerError();
      return validatedMatrix.data;
    } catch (error: unknown) {
      throw mapMatrixError(error);
    }
  }
}
