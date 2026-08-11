import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { ApiFailureSchema, HealthResponseSchema } from '@travel-guide/shared-schemas';

import { Controller, Get } from '@nestjs/common';

import { createApp } from '../src/create-app';

@Controller('__test')
class UnexpectedExceptionController {
  @Get('unexpected-error')
  public triggerUnexpectedError(): never {
    throw new Error('sensitive internal exception message');
  }
}

describe('GET /health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(
      { nodeEnv: 'test', port: 0 },
      { extraControllers: [UnexpectedExceptionController] },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a response that matches the shared schema', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/health',
    });
    const body: unknown = JSON.parse(response.payload);

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ status: 'ok', environment: 'test' });
    expect(typeof response.headers['x-request-id']).toBe('string');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('HTTP error handling', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(
      { nodeEnv: 'test', port: 0 },
      { extraControllers: [UnexpectedExceptionController] },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a safe ApiFailure for unknown routes', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/does-not-exist',
    });
    const body: unknown = JSON.parse(response.payload);
    const result = ApiFailureSchema.safeParse(body);

    expect(response.statusCode).toBe(404);
    expect(result.success).toBe(true);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
      requestId: response.headers['x-request-id'],
    });
    expect(response.payload).not.toContain('at ');
    expect(response.payload).not.toContain('/home/');
  });

  it('redacts unexpected exception details', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/__test/unexpected-error',
    });
    const body: unknown = JSON.parse(response.payload);

    expect(response.statusCode).toBe(500);
    expect(ApiFailureSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      requestId: response.headers['x-request-id'],
    });
    expect(response.payload).not.toContain('sensitive internal exception message');
    expect(response.payload).not.toContain('stack');
    expect(response.payload).not.toContain('/home/');
  });
});

describe('request IDs', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp({ nodeEnv: 'test', port: 0 });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('preserves a valid request ID', async () => {
    const requestId = 'client-request-123';
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': requestId },
      });

    expect(response.headers['x-request-id']).toBe(requestId);
  });

  it('generates an ID when the header is missing or invalid', async () => {
    const missingHeaderResponse = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/health',
    });
    const oversizedHeaderResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': 'a'.repeat(129) },
      });

    expect(typeof missingHeaderResponse.headers['x-request-id']).toBe('string');
    expect(typeof oversizedHeaderResponse.headers['x-request-id']).toBe('string');
    expect(oversizedHeaderResponse.headers['x-request-id']).not.toBe('a'.repeat(129));
  });
});
