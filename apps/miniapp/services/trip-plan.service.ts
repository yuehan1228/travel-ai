import {
  GenerateTripPlanInputSchema,
  RegenerateTripPlanDayInputSchema,
  RegenerateTripPlanDayResultSchema,
  TripIdSchema,
  TripPlanGenerationResultSchema,
  TripPlanVersionListResultSchema,
} from '@travel-guide/shared-schemas';
import type {
  GenerateTripPlanInput,
  RegenerateTripPlanDayInput,
  RegenerateTripPlanDayResult,
  TripPlanGenerationResult,
  TripPlanVersionListResult,
} from '@travel-guide/shared-types';

import { AuthService, authService } from './auth.service';
import { createHttpClient, requestApi, type HttpClient, type RequestOptions } from './http-client';
import { RequestError } from './request-error';

export type TripPlanAuthService = Pick<AuthService, 'getAccessToken' | 'logout'>;

const parseVersion = (version: number): number => {
  if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
    throw new RequestError({ code: 'INVALID_RESPONSE', message: 'Invalid TripPlan version' });
  }
  return version;
};

export class TripPlanService {
  public constructor(
    private readonly client: HttpClient = createHttpClient(),
    private readonly auth: TripPlanAuthService = authService,
  ) {}

  public async generateTripPlan(
    id: string,
    input: GenerateTripPlanInput = {},
  ): Promise<TripPlanGenerationResult> {
    const tripId = TripIdSchema.parse(id);
    const parsedInput = GenerateTripPlanInputSchema.parse(input);
    return this.request<TripPlanGenerationResult>({
      method: 'POST',
      path: `/trips/${encodeURIComponent(tripId)}/generate`,
      data: parsedInput,
      schema: TripPlanGenerationResultSchema,
    });
  }

  public async getLatestTripPlan(id: string): Promise<TripPlanVersionListResult> {
    const tripId = TripIdSchema.parse(id);
    return this.request<TripPlanVersionListResult>({
      method: 'GET',
      path: `/trips/${encodeURIComponent(tripId)}/plan`,
      schema: TripPlanVersionListResultSchema,
    });
  }

  public async getTripPlanVersion(id: string, version: number): Promise<TripPlanGenerationResult> {
    const tripId = TripIdSchema.parse(id);
    const parsedVersion = parseVersion(version);
    return this.request<TripPlanGenerationResult>({
      method: 'GET',
      path: `/trips/${encodeURIComponent(tripId)}/plan/${parsedVersion}`,
      schema: TripPlanGenerationResultSchema,
    });
  }

  public async regenerateTripPlanDay(
    id: string,
    input: RegenerateTripPlanDayInput,
  ): Promise<RegenerateTripPlanDayResult>;
  public async regenerateTripPlanDay(
    id: string,
    sourceVersion: number,
    dayNumber: number,
    instruction?: string,
  ): Promise<RegenerateTripPlanDayResult>;
  public async regenerateTripPlanDay(
    id: string,
    inputOrSourceVersion: RegenerateTripPlanDayInput | number,
    dayNumber?: number,
    instruction?: string,
  ): Promise<RegenerateTripPlanDayResult> {
    const tripId = TripIdSchema.parse(id);
    const input: RegenerateTripPlanDayInput =
      typeof inputOrSourceVersion === 'number'
        ? {
            sourceVersion: inputOrSourceVersion,
            dayNumber: dayNumber ?? 0,
            ...(instruction === undefined ? {} : { instruction }),
          }
        : inputOrSourceVersion;
    const parsedInput = RegenerateTripPlanDayInputSchema.parse(input);
    return this.request<RegenerateTripPlanDayResult>({
      method: 'POST',
      path: `/trips/${encodeURIComponent(tripId)}/regenerate-day`,
      data: parsedInput,
      schema: RegenerateTripPlanDayResultSchema,
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

export const createTripPlanService = (
  client: HttpClient = createHttpClient(),
  auth: TripPlanAuthService = authService,
): TripPlanService => new TripPlanService(client, auth);

export const tripPlanService = new TripPlanService();
