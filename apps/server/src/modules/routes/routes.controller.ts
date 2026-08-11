import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import {
  EstimateRouteInputSchema,
  EstimateRouteMatrixInputSchema,
} from '@travel-guide/shared-schemas';
import type {
  ApiSuccess,
  EstimateRouteInput,
  EstimateRouteMatrixInput,
  RouteEstimate,
  RouteMatrixResult,
} from '@travel-guide/shared-types';

import { getRequestId } from '../../http/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUserId } from '../auth/auth-user.decorator';
import { RouteException, RouteMatrixException } from './route.errors';
import { RouteMatrixService } from './route-matrix.service';
import { RouteService } from './route.service';

const requestIdFor = (request: FastifyRequest): string => getRequestId(request) ?? request.id;

const validationError = (): RouteException =>
  new RouteException('ROUTE_VALIDATION_ERROR', 400, 'The route input is invalid');

const matrixValidationError = (): RouteMatrixException =>
  new RouteMatrixException(
    'ROUTE_MATRIX_VALIDATION_ERROR',
    400,
    'The route matrix input is invalid',
  );

const parseBody = (body: unknown): EstimateRouteInput => {
  const parsed = EstimateRouteInputSchema.safeParse(body);
  if (!parsed.success) throw validationError();
  return parsed.data;
};

const parseMatrixBody = (body: unknown): EstimateRouteMatrixInput => {
  const parsed = EstimateRouteMatrixInputSchema.safeParse(body);
  if (!parsed.success) throw matrixValidationError();
  return parsed.data;
};

@Controller('routes')
@UseGuards(AuthGuard)
export class RoutesController {
  public constructor(
    @Inject(RouteService) private readonly routeService: RouteService,
    @Inject(RouteMatrixService) private readonly routeMatrixService: RouteMatrixService,
  ) {}

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  public async estimate(
    @Body() body: unknown,
    @CurrentUserId() _userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<RouteEstimate>> {
    const result: RouteEstimate = await this.routeService.estimateRoute(parseBody(body));
    if (result.dataSource === 'unavailable') {
      throw new RouteException('ROUTE_UNAVAILABLE', 404, 'No route is available');
    }
    return {
      success: true,
      data: result,
      requestId: requestIdFor(request),
    };
  }

  @Post('matrix')
  @HttpCode(HttpStatus.OK)
  public async estimateMatrix(
    @Body() body: unknown,
    @CurrentUserId() _userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<RouteMatrixResult>> {
    const result = await this.routeMatrixService.estimateRouteMatrix(parseMatrixBody(body));
    if (result.cells.every((cell) => cell.status === 'unavailable')) {
      throw new RouteMatrixException(
        'ROUTE_MATRIX_UNAVAILABLE',
        404,
        'No routes are available for the requested matrix',
      );
    }
    return {
      success: true,
      data: result,
      requestId: requestIdFor(request),
    };
  }
}
