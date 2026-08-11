import { GetWeatherInputSchema, WeatherResultSchema } from '@travel-guide/shared-schemas';
import type { GetWeatherInput, WeatherResult } from '@travel-guide/shared-types';

import { AuthService, authService } from './auth.service';
import { createHttpClient, requestApi, type HttpClient, type RequestOptions } from './http-client';
import { RequestError } from './request-error';

export type WeatherAuthService = Pick<AuthService, 'getAccessToken' | 'logout'>;

const encodeQueryValue = (value: string): string => encodeURIComponent(value);

export class WeatherService {
  public constructor(
    private readonly client: HttpClient = createHttpClient(),
    private readonly auth: WeatherAuthService = authService,
  ) {}

  public async getWeather(input: GetWeatherInput): Promise<WeatherResult> {
    const parsedInput = GetWeatherInputSchema.parse(input);
    const query = [
      `cityName=${encodeQueryValue(parsedInput.destination.cityName)}`,
      ...(parsedInput.destination.cityCode === undefined
        ? []
        : [`cityCode=${encodeQueryValue(parsedInput.destination.cityCode)}`]),
      `startDate=${encodeQueryValue(parsedInput.startDate)}`,
      `endDate=${encodeQueryValue(parsedInput.endDate)}`,
    ].join('&');

    return this.request<WeatherResult>({
      method: 'GET',
      path: `/weather?${query}`,
      schema: WeatherResultSchema,
    });
  }

  private async request<TResponse>(options: RequestOptions<TResponse>): Promise<TResponse> {
    const token = this.auth.getAccessToken();
    if (token === undefined || token.trim().length === 0) {
      throw new RequestError({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Authentication is required',
      });
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

export const createWeatherService = (
  client: HttpClient = createHttpClient(),
  auth: WeatherAuthService = authService,
): WeatherService => new WeatherService(client, auth);

export const weatherService = new WeatherService();
