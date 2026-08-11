import { describe, expect, it } from 'vitest';

import type { CreateTripInput } from '@travel-guide/shared-types';

import { TripService, type TripAuthService } from '../services/trip.service';
import { createHttpClient, type RequestAdapter } from '../services/http-client';
import { RequestError } from '../services/request-error';

const tripInput: CreateTripInput = {
  destination: { cityName: '杭州' },
  startDate: '2026-09-01',
  endDate: '2026-09-03',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'relaxed',
  transportPreference: 'public_transport',
};

const detail = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  status: 'draft' as const,
  ...tripInput,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

const createAuth = (token: string | undefined): TripAuthService & { loggedOut: boolean } => {
  const auth = {
    loggedOut: false,
    getAccessToken: () => token,
    logout: () => {
      auth.loggedOut = true;
    },
  };
  return auth;
};

const createClient = (adapter: RequestAdapter) =>
  createHttpClient(
    { name: 'test', baseUrl: 'https://api.example.invalid', requestTimeout: 100 },
    adapter,
  );

describe('miniapp TripService', () => {
  it('attaches a Bearer token and parses API success data', async () => {
    let capturedAuthorization = '';
    const auth = createAuth('access-token');
    const service = new TripService(
      createClient(async (options) => {
        capturedAuthorization = options.header?.Authorization ?? '';
        return {
          statusCode: 201,
          data: { success: true, data: detail, requestId: 'request-1' },
        };
      }),
      auth,
    );

    await expect(service.createTrip(tripInput)).resolves.toEqual(detail);
    expect(capturedAuthorization).toBe('Bearer access-token');
  });

  it('does not access the network when a token is missing', async () => {
    let requests = 0;
    const service = new TripService(
      createClient(async () => {
        requests += 1;
        throw new Error('network should not be called');
      }),
      createAuth(undefined),
    );

    await expect(service.getTrip(detail.id)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(requests).toBe(0);
  });

  it('maps API failures and clears auth state for AUTH_TOKEN_INVALID', async () => {
    const auth = createAuth('expired-token');
    const service = new TripService(
      createClient(async () => ({
        statusCode: 401,
        data: {
          success: false,
          error: { code: 'AUTH_TOKEN_INVALID', message: 'The access token is invalid' },
          requestId: 'request-2',
        },
      })),
      auth,
    );

    await expect(service.getTrip(detail.id)).rejects.toMatchObject({
      code: 'API_ERROR',
      apiCode: 'AUTH_TOKEN_INVALID',
      requestId: 'request-2',
    });
    expect(auth.loggedOut).toBe(true);
  });

  it('rejects malformed update input before making a request', async () => {
    let requests = 0;
    const service = new TripService(
      createClient(async () => {
        requests += 1;
        throw new RequestError({ code: 'NETWORK_ERROR', message: 'not used' });
      }),
      createAuth('access-token'),
    );

    await expect(service.updateTrip(detail.id, {})).rejects.toThrow();
    expect(requests).toBe(0);
  });
});
