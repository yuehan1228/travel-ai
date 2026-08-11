import { PlaceListResultSchema, SearchPlacesInputSchema } from '@travel-guide/shared-schemas';
import type { PlaceListResult, SearchPlacesInput } from '@travel-guide/shared-types';

import { AuthService, authService } from './auth.service';
import { createHttpClient, requestApi, type HttpClient, type RequestOptions } from './http-client';
import { RequestError } from './request-error';

export type PlaceAuthService = Pick<AuthService, 'getAccessToken' | 'logout'>;

const encodeQueryValue = (value: string): string => encodeURIComponent(value);

export class PlaceService {
  public constructor(
    private readonly client: HttpClient = createHttpClient(),
    private readonly auth: PlaceAuthService = authService,
  ) {}

  public async searchPlaces(input: SearchPlacesInput): Promise<PlaceListResult> {
    const parsedInput = SearchPlacesInputSchema.parse(input);
    const query = [
      `cityName=${encodeQueryValue(parsedInput.cityName)}`,
      ...(parsedInput.cityCode === undefined
        ? []
        : [`cityCode=${encodeQueryValue(parsedInput.cityCode)}`]),
      ...(parsedInput.keyword === undefined
        ? []
        : [`keyword=${encodeQueryValue(parsedInput.keyword)}`]),
      `categories=${encodeQueryValue(parsedInput.categories.join(','))}`,
      ...(parsedInput.page === undefined ? [] : [`page=${parsedInput.page}`]),
      ...(parsedInput.pageSize === undefined ? [] : [`pageSize=${parsedInput.pageSize}`]),
    ].join('&');

    return this.request<PlaceListResult>({
      method: 'GET',
      path: `/places?${query}`,
      schema: PlaceListResultSchema,
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

export const createPlaceService = (
  client: HttpClient = createHttpClient(),
  auth: PlaceAuthService = authService,
): PlaceService => new PlaceService(client, auth);

export const placeService = new PlaceService();
