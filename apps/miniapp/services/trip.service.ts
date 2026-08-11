import {
  CreateTripInputSchema,
  ListTripsInputSchema,
  TripDeleteResultSchema,
  TripDetailSchema,
  TripIdSchema,
  TripListResultSchema,
  UpdateTripInputSchema,
} from '@travel-guide/shared-schemas';
import type {
  CreateTripInput,
  ListTripsInput,
  TripDeleteResult,
  TripDetail,
  TripListResult,
  UpdateTripInput,
} from '@travel-guide/shared-types';

import { AuthService, authService } from './auth.service';
import { createHttpClient, requestApi, type HttpClient, type RequestOptions } from './http-client';
import { RequestError } from './request-error';

export type TripAuthService = Pick<AuthService, 'getAccessToken' | 'logout'>;

const encodeQueryValue = (value: string | number): string => encodeURIComponent(String(value));

export class TripService {
  public constructor(
    private readonly client: HttpClient = createHttpClient(),
    private readonly auth: TripAuthService = authService,
  ) {}

  public async createTrip(input: CreateTripInput): Promise<TripDetail> {
    const parsedInput = CreateTripInputSchema.parse(input);
    return this.request<TripDetail>({
      method: 'POST',
      path: '/trips',
      data: parsedInput,
      schema: TripDetailSchema,
    });
  }

  public async listTrips(input: ListTripsInput = {}): Promise<TripListResult> {
    const parsedInput = ListTripsInputSchema.parse(input);
    const query = [
      `page=${encodeQueryValue(parsedInput.page ?? 1)}`,
      `pageSize=${encodeQueryValue(parsedInput.pageSize ?? 20)}`,
      ...(parsedInput.status === undefined
        ? []
        : [`status=${encodeQueryValue(parsedInput.status)}`]),
    ].join('&');

    return this.request<TripListResult>({
      method: 'GET',
      path: `/trips?${query}`,
      schema: TripListResultSchema,
    });
  }

  public async getTrip(id: string): Promise<TripDetail> {
    const tripId = TripIdSchema.parse(id);
    return this.request<TripDetail>({
      method: 'GET',
      path: `/trips/${encodeURIComponent(tripId)}`,
      schema: TripDetailSchema,
    });
  }

  public async updateTrip(id: string, input: UpdateTripInput): Promise<TripDetail> {
    const tripId = TripIdSchema.parse(id);
    const parsedInput = UpdateTripInputSchema.parse(input);
    return this.request<TripDetail>({
      method: 'PATCH',
      path: `/trips/${encodeURIComponent(tripId)}`,
      data: parsedInput,
      schema: TripDetailSchema,
    });
  }

  public async deleteTrip(id: string): Promise<TripDeleteResult> {
    const tripId = TripIdSchema.parse(id);
    return this.request<TripDeleteResult>({
      method: 'DELETE',
      path: `/trips/${encodeURIComponent(tripId)}`,
      schema: TripDeleteResultSchema,
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

export const createTripService = (
  client: HttpClient = createHttpClient(),
  auth: TripAuthService = authService,
): TripService => new TripService(client, auth);

export const tripService = new TripService();
