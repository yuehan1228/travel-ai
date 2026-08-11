import { z } from 'zod';

import {
  PLACE_CATEGORIES,
  PLACE_DATA_SOURCES,
  type GeoPoint,
  type Place,
  type PlaceCategory,
  type PlaceDataSource,
  type PlaceListResult,
  type SearchPlacesInput,
} from '@travel-guide/shared-types';

import {
  createOptionalTrimmedStringSchema,
  createTrimmedRequiredStringSchema,
} from './common.schema';
import { PaginationMetaSchema } from './api.schema';

export const PlaceCategorySchema: z.ZodType<PlaceCategory, z.ZodTypeDef, unknown> =
  z.enum(PLACE_CATEGORIES);

export const PlaceDataSourceSchema: z.ZodType<PlaceDataSource, z.ZodTypeDef, unknown> =
  z.enum(PLACE_DATA_SOURCES);

export const GeoPointSchema: z.ZodType<GeoPoint, z.ZodTypeDef, unknown> = z
  .object({
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
  })
  .strict();

const pageSchema = z.coerce
  .number({ invalid_type_error: 'page must be a number' })
  .finite()
  .int()
  .min(1)
  .default(1);

const pageSizeSchema = z.coerce
  .number({ invalid_type_error: 'pageSize must be a number' })
  .finite()
  .int()
  .min(1)
  .max(50)
  .default(20);

export const SearchPlacesInputSchema: z.ZodType<SearchPlacesInput, z.ZodTypeDef, unknown> = z
  .object({
    cityName: createTrimmedRequiredStringSchema('cityName', 100),
    cityCode: createOptionalTrimmedStringSchema('cityCode', 32),
    keyword: createOptionalTrimmedStringSchema('keyword', 80),
    categories: z
      .array(PlaceCategorySchema)
      .min(1, { message: 'at least one category is required' })
      .max(PLACE_CATEGORIES.length)
      .refine((categories) => new Set(categories).size === categories.length, {
        message: 'categories must not contain duplicates',
      }),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .strict() as z.ZodType<SearchPlacesInput, z.ZodTypeDef, unknown>;

export const PlaceSchema: z.ZodType<Place, z.ZodTypeDef, unknown> = z
  .object({
    id: z.string().uuid(),
    provider: createTrimmedRequiredStringSchema('provider', 64),
    providerPlaceId: createTrimmedRequiredStringSchema('providerPlaceId', 128),
    name: createTrimmedRequiredStringSchema('name', 200),
    category: PlaceCategorySchema,
    categoryText: createTrimmedRequiredStringSchema('categoryText', 100),
    address: createTrimmedRequiredStringSchema('address', 500),
    location: GeoPointSchema,
    rating: z.number().finite().min(0).max(5).optional(),
    openingHours: createOptionalTrimmedStringSchema('openingHours', 500),
    telephone: createOptionalTrimmedStringSchema('telephone', 64),
    verifiedAt: z.string().datetime({ offset: true }),
    dataSource: PlaceDataSourceSchema,
  })
  .strict();

export const PlaceListResultSchema: z.ZodType<PlaceListResult, z.ZodTypeDef, unknown> = z
  .object({
    items: z.array(PlaceSchema),
    pagination: PaginationMetaSchema,
    fetchedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.pagination.pageSize > 50) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pagination', 'pageSize'],
        message: 'place pageSize must be at most 50',
      });
    }
  });
