import { HealthResponseSchema, createApiResponseSchema } from '@travel-guide/shared-schemas';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { joinBaseUrl, createHttpClient, type AdapterResponse } from '../services/http-client';
import { RequestError } from '../services/request-error';

const config = (baseUrl = 'https://api.example.invalid') => ({
  name: 'test' as const,
  baseUrl,
  requestTimeout: 100,
});

const healthResponse: AdapterResponse = {
  statusCode: 200,
  data: {
    status: 'ok',
    environment: 'test',
    timestamp: '2026-08-11T00:00:00.000Z',
  },
};

describe('joinBaseUrl', () => {
  it('joins base URL and path without duplicate slashes', () => {
    expect(joinBaseUrl('https://api.example.invalid///', '///health')).toBe(
      'https://api.example.invalid/health',
    );
  });

  it.each(['', '   ', 'api.example.invalid', 'ftp://api.example.invalid'])(
    'rejects invalid base URL %j',
    (baseUrl) => {
      expect(() => joinBaseUrl(baseUrl, '/health')).toThrow(RequestError);
    },
  );
});

describe('HttpClient', () => {
  it('validates a raw HealthResponse', async () => {
    const client = createHttpClient(config(), async () => healthResponse);

    await expect(
      client.requestRaw({
        method: 'GET',
        path: '/health',
        schema: HealthResponseSchema,
      }),
    ).resolves.toEqual(healthResponse.data);
  });

  it('validates an API success envelope and returns data', async () => {
    const client = createHttpClient(config(), async () => ({
      statusCode: 200,
      data: { success: true, data: 'ok', requestId: 'request-1' },
    }));

    await expect(
      client.requestApi({
        method: 'GET',
        path: '/example',
        schema: z.string(),
      }),
    ).resolves.toBe('ok');
  });

  it('maps an API failure envelope to API_ERROR', async () => {
    const client = createHttpClient(config(), async () => ({
      statusCode: 200,
      data: {
        success: false,
        error: { code: 'TRIP_FAILED', message: 'trip failed' },
        requestId: 'request-2',
      },
    }));

    await expect(
      client.requestApi({
        method: 'GET',
        path: '/example',
        schema: z.string(),
      }),
    ).rejects.toMatchObject({
      code: 'API_ERROR',
      requestId: 'request-2',
    });
  });

  it.each([400, 500])('maps HTTP %i to HTTP_ERROR', async (statusCode) => {
    const client = createHttpClient(config(), async () => ({
      statusCode,
      data: { message: 'failed' },
      header: { 'X-Request-Id': `request-${statusCode}` },
    }));

    await expect(
      client.requestRaw({
        method: 'GET',
        path: '/example',
        schema: z.object({ message: z.string() }),
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      httpStatus: statusCode,
      requestId: `request-${statusCode}`,
    });
  });

  it('maps network failures to NETWORK_ERROR', async () => {
    const client = createHttpClient(config(), async () => {
      throw new Error('socket closed');
    });

    await expect(
      client.requestRaw({ method: 'GET', path: '/health', schema: HealthResponseSchema }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('maps adapter timeout failures to REQUEST_TIMEOUT', async () => {
    const client = createHttpClient(config(), async () => {
      throw { errMsg: 'request:fail timeout' };
    });

    await expect(
      client.requestRaw({ method: 'GET', path: '/health', schema: HealthResponseSchema }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('maps a local timeout to REQUEST_TIMEOUT', async () => {
    const client = createHttpClient(
      { ...config(), requestTimeout: 1 },
      () => new Promise(() => {}),
    );

    await expect(
      client.requestRaw({ method: 'GET', path: '/health', schema: HealthResponseSchema }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('maps an invalid response to INVALID_RESPONSE', async () => {
    const client = createHttpClient(config(), async () => ({
      statusCode: 200,
      data: { status: 'not-ok' },
    }));

    await expect(
      client.requestRaw({ method: 'GET', path: '/health', schema: HealthResponseSchema }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects an invalid client base URL', () => {
    expect(() => createHttpClient(config(''))).toThrow(RequestError);
    expect(() => createHttpClient(config('not-a-url'))).toThrow(RequestError);
  });

  it('uses the configured URL, method and timeout', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedTimeout = 0;
    const client = createHttpClient(config(), async (options) => {
      capturedUrl = options.url;
      capturedMethod = options.method;
      capturedTimeout = options.timeout;
      return healthResponse;
    });

    await client.requestRaw({
      method: 'GET',
      path: '/health',
      timeout: 250,
      schema: HealthResponseSchema,
    });

    expect(capturedUrl).toBe('https://api.example.invalid/health');
    expect(capturedMethod).toBe('GET');
    expect(capturedTimeout).toBe(250);
  });

  it('keeps API envelope schema construction available to callers', () => {
    const schema = createApiResponseSchema(z.object({ status: z.literal('ok') }));

    expect(
      schema.safeParse({
        success: true,
        data: { status: 'ok' },
        requestId: 'request-3',
      }).success,
    ).toBe(true);
  });
});
