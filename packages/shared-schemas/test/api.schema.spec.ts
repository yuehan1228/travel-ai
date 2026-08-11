import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ApiErrorDetailSchema,
  ApiFailureSchema,
  PaginationMetaSchema,
  createApiResponseSchema,
  createApiSuccessSchema,
  createPaginatedDataSchema,
} from '../src';

describe('API schemas', () => {
  it('validates a generic success response', () => {
    const schema = createApiSuccessSchema(z.object({ id: z.number().int() }));
    const result = schema.safeParse({
      success: true,
      data: { id: 42 },
      requestId: 'request-1',
    });

    expect(result.success).toBe(true);
  });

  it('preserves transformed data schema output without parsing it again', () => {
    const schema = createApiSuccessSchema(z.string().transform((value) => value.length));
    const result = schema.safeParse({ success: true, data: 'trip', requestId: 'request-1b' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toBe(4);
    }
  });

  it('validates a failure response and JSON-only details', () => {
    const result = ApiFailureSchema.safeParse({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid trip input',
        details: {
          field: 'startDate',
          reasons: ['invalid_format', null],
          nested: { retryable: false },
        },
      },
      requestId: 'request-2',
    });

    expect(result.success).toBe(true);
  });

  it.each(['', '   '])('rejects an empty request ID: %j', (requestId) => {
    expect(
      createApiSuccessSchema(z.string()).safeParse({ success: true, data: 'ok', requestId })
        .success,
    ).toBe(false);
  });

  it.each(['validation_error', 'VALIDATION-ERROR', 'VALIDATION ERROR', '_ERROR'])(
    'rejects an invalid error code: %s',
    (code) => {
      expect(ApiErrorDetailSchema.safeParse({ code, message: 'message' }).success).toBe(false);
    },
  );

  it('applies the generic data schema in both response branches', () => {
    const schema = createApiResponseSchema(z.object({ id: z.number().int() }));
    expect(
      schema.safeParse({ success: true, data: { id: 'not-a-number' }, requestId: 'request-3' })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Not found' },
        requestId: 'request-4',
      }).success,
    ).toBe(true);
  });

  it('rejects non-JSON values in error details', () => {
    expect(
      ApiErrorDetailSchema.safeParse({ code: 'BAD_DETAILS', message: 'bad', details: new Date() })
        .success,
    ).toBe(false);
    expect(
      ApiErrorDetailSchema.safeParse({
        code: 'BAD_DETAILS',
        message: 'bad',
        details: { callback: () => 'not JSON' },
      }).success,
    ).toBe(false);
    expect(
      ApiErrorDetailSchema.safeParse({
        code: 'BAD_DETAILS',
        message: 'bad',
        details: { number: Number.POSITIVE_INFINITY },
      }).success,
    ).toBe(false);

    const cyclicDetails: Record<string, unknown> = {};
    cyclicDetails.self = cyclicDetails;
    expect(
      ApiErrorDetailSchema.safeParse({
        code: 'BAD_DETAILS',
        message: 'bad',
        details: cyclicDetails,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields in envelopes', () => {
    expect(
      createApiSuccessSchema(z.string()).safeParse({
        success: true,
        data: 'ok',
        requestId: 'request-5',
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('validates pagination metadata and generic paginated data', () => {
    const schema = createPaginatedDataSchema(z.object({ id: z.number() }));
    expect(
      schema.safeParse({
        items: [{ id: 1 }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        items: [{ id: 1 }],
        pagination: { page: 0, pageSize: 20, total: 1, totalPages: 1 },
      }).success,
    ).toBe(false);
  });

  it.each([
    { page: 0, pageSize: 20, total: 0, totalPages: 0 },
    { page: 1, pageSize: 101, total: 0, totalPages: 0 },
    { page: 1, pageSize: 20, total: -1, totalPages: 0 },
    { page: 1, pageSize: 20, total: 0, totalPages: -1 },
    { page: 1.5, pageSize: 20, total: 0, totalPages: 0 },
  ])('rejects invalid pagination metadata: %j', (pagination) => {
    expect(PaginationMetaSchema.safeParse(pagination).success).toBe(false);
  });
});
