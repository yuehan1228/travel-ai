import { z } from 'zod';

import type {
  ApiErrorDetail,
  ApiFailure,
  ApiResponse,
  ApiSuccess,
  PaginatedData,
  PaginationMeta,
} from '@travel-guide/shared-types';

type JsonPrimitive = string | number | boolean | null;
type JsonObject = { [key: string]: JsonValue };
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

const isPlainJsonObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isJsonCompatible = (value: unknown, ancestors = new WeakSet<object>()): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value !== 'object' || (!isPlainJsonObject(value) && !Array.isArray(value))) {
    return false;
  }

  if (ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);

  const isValid = Array.isArray(value)
    ? value.every((item) => isJsonCompatible(item, ancestors))
    : Object.values(value).every((item) => isJsonCompatible(item, ancestors));

  ancestors.delete(value);
  return isValid;
};

const hasDataProperty = <TData>(value: { data?: TData }): value is { data: TData } =>
  Object.prototype.hasOwnProperty.call(value, 'data');

const JsonValueSchema: z.ZodType<JsonValue, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    JsonObjectSchema,
  ]),
);

const JsonObjectSchema: z.ZodType<JsonObject, z.ZodTypeDef, unknown> = z.preprocess(
  (value: unknown) => (isPlainJsonObject(value) && isJsonCompatible(value) ? value : undefined),
  z.record(JsonValueSchema),
);

export const requestIdSchema = z
  .string({ invalid_type_error: 'requestId must be a string' })
  .trim()
  .min(1, { message: 'requestId must not be empty' });

export const RequestIdSchema = requestIdSchema;

export const ApiErrorDetailSchema: z.ZodType<ApiErrorDetail, z.ZodTypeDef, unknown> = z
  .object({
    code: z
      .string({ invalid_type_error: 'error.code must be a string' })
      .trim()
      .regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/, {
        message: 'error.code must use uppercase underscore format',
      }),
    message: z
      .string({ invalid_type_error: 'error.message must be a string' })
      .trim()
      .min(1, { message: 'error.message must not be empty' }),
    details: JsonObjectSchema.optional(),
  })
  .strict();

export const ApiFailureSchema: z.ZodType<ApiFailure, z.ZodTypeDef, unknown> = z
  .object({
    success: z.literal(false),
    error: ApiErrorDetailSchema,
    requestId: requestIdSchema,
  })
  .strict();

export function createApiSuccessSchema<TData>(
  dataSchema: z.ZodType<TData, z.ZodTypeDef, unknown>,
): z.ZodType<ApiSuccess<TData>, z.ZodTypeDef, unknown> {
  return z
    .object({
      success: z.literal(true),
      data: dataSchema,
      requestId: requestIdSchema,
    })
    .strict()
    .transform((value): ApiSuccess<TData> => {
      if (!hasDataProperty(value)) {
        return {
          success: true,
          data: dataSchema.parse(value.data),
          requestId: value.requestId,
        };
      }

      return {
        success: true,
        data: value.data,
        requestId: value.requestId,
      };
    });
}

export function createApiResponseSchema<TData>(
  dataSchema: z.ZodType<TData, z.ZodTypeDef, unknown>,
): z.ZodType<ApiResponse<TData>, z.ZodTypeDef, unknown> {
  return z.union([createApiSuccessSchema(dataSchema), ApiFailureSchema]);
}

const pageSchema = z
  .number({ invalid_type_error: 'pagination.page must be a number' })
  .finite({ message: 'pagination.page must be finite' })
  .int({ message: 'pagination.page must be an integer' })
  .min(1, { message: 'pagination.page must be at least 1' });

const pageSizeSchema = z
  .number({ invalid_type_error: 'pagination.pageSize must be a number' })
  .finite({ message: 'pagination.pageSize must be finite' })
  .int({ message: 'pagination.pageSize must be an integer' })
  .min(1, { message: 'pagination.pageSize must be at least 1' })
  .max(100, { message: 'pagination.pageSize must be at most 100' });

const totalSchema = z
  .number({ invalid_type_error: 'pagination.total must be a number' })
  .finite({ message: 'pagination.total must be finite' })
  .int({ message: 'pagination.total must be an integer' })
  .min(0, { message: 'pagination.total must be at least 0' });

const totalPagesSchema = z
  .number({ invalid_type_error: 'pagination.totalPages must be a number' })
  .finite({ message: 'pagination.totalPages must be finite' })
  .int({ message: 'pagination.totalPages must be an integer' })
  .min(0, { message: 'pagination.totalPages must be at least 0' });

export const PaginationMetaSchema: z.ZodType<PaginationMeta, z.ZodTypeDef, unknown> = z
  .object({
    page: pageSchema,
    pageSize: pageSizeSchema,
    total: totalSchema,
    totalPages: totalPagesSchema,
  })
  .strict();

export const createPaginationMetaSchema = (): typeof PaginationMetaSchema => PaginationMetaSchema;

export const createPaginationSchema = createPaginationMetaSchema;

export function createPaginatedDataSchema<TData>(
  itemSchema: z.ZodType<TData>,
): z.ZodType<PaginatedData<TData>, z.ZodTypeDef, unknown> {
  return z
    .object({
      items: z.array(itemSchema),
      pagination: PaginationMetaSchema,
    })
    .strict();
}

export const createPaginatedSchema = createPaginatedDataSchema;
