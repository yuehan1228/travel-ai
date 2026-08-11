import {
  EstimateRouteInputSchema,
  EstimateRouteMatrixInputSchema,
  RouteEstimateSchema,
  RouteMatrixResultSchema,
} from '@travel-guide/shared-schemas';
import type {
  EstimateRouteInput,
  EstimateRouteMatrixInput,
  RouteEstimate,
  RouteMatrixResult,
} from '@travel-guide/shared-types';

import { AuthService, authService } from './auth.service';
import { createHttpClient, requestApi, type HttpClient, type RequestOptions } from './http-client';
import { RequestError } from './request-error';

export type RouteAuthService = Pick<AuthService, 'getAccessToken' | 'logout'>;

export class RouteService {
  public constructor(
    private readonly client: HttpClient = createHttpClient(),
    private readonly auth: RouteAuthService = authService,
  ) {}

  public async estimateRoute(input: EstimateRouteInput): Promise<RouteEstimate> {
    const parsedInput = EstimateRouteInputSchema.parse(input);
    return this.request<RouteEstimate>({
      method: 'POST',
      path: '/routes/estimate',
      data: parsedInput,
      schema: RouteEstimateSchema,
    });
  }

  public async estimateRouteMatrix(input: EstimateRouteMatrixInput): Promise<RouteMatrixResult> {
    const parsedInput = EstimateRouteMatrixInputSchema.parse(input);
    return this.request<RouteMatrixResult>({
      method: 'POST',
      path: '/routes/matrix',
      data: parsedInput,
      schema: RouteMatrixResultSchema,
    });
  }

  private async request<TResponse>(options: RequestOptions<TResponse>): Promise<TResponse> {
    const token = this.auth.getAccessToken();
    if (token === undefined || token.trim().length === 0) {
      throw new RequestError({ code: 'AUTH_TOKEN_INVALID', message: 'Authentication is required' });
    }

    try {
      return await requestApi(
        {
          ...options,
          header: {
            ...(options.header ?? {}),
            Authorization: `Bearer ${token}`,
          },
        },
        this.client,
      );
    } catch (error: unknown) {
      if (
        error instanceof RequestError &&
        (error.apiCode === 'AUTH_TOKEN_INVALID' || error.code === 'AUTH_TOKEN_INVALID')
      ) {
        this.auth.logout();
      }
      throw error;
    }
  }
}

export const createRouteService = (
  client: HttpClient = createHttpClient(),
  auth: RouteAuthService = authService,
): RouteService => new RouteService(client, auth);

export const routeService = new RouteService();
