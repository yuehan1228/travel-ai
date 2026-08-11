import {
  EstimateRouteOrderInputSchema,
  RouteOrderResultSchema,
} from '@travel-guide/shared-schemas';
import type { EstimateRouteOrderInput, RouteOrderResult } from '@travel-guide/shared-types';

import { AuthService, authService } from './auth.service';
import { createHttpClient, requestApi, type HttpClient, type RequestOptions } from './http-client';
import { RequestError } from './request-error';

export type RouteOrderAuthService = Pick<AuthService, 'getAccessToken' | 'logout'>;

/** Type-safe client for authenticated deterministic route-order requests. */
export class RouteOrderService {
  public constructor(
    private readonly client: HttpClient = createHttpClient(),
    private readonly auth: RouteOrderAuthService = authService,
  ) {}

  public async estimateRouteOrder(input: EstimateRouteOrderInput): Promise<RouteOrderResult> {
    const parsedInput = EstimateRouteOrderInputSchema.parse(input);
    return this.request<RouteOrderResult>({
      method: 'POST',
      path: '/routes/order',
      data: parsedInput,
      schema: RouteOrderResultSchema,
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

export const createRouteOrderService = (
  client: HttpClient = createHttpClient(),
  auth: RouteOrderAuthService = authService,
): RouteOrderService => new RouteOrderService(client, auth);

export const routeOrderService = new RouteOrderService();
