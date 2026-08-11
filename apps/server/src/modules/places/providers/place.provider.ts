import { z } from 'zod';

import {
  GeoPointSchema,
  PlaceCategorySchema,
  createOptionalTrimmedStringSchema,
  createTrimmedRequiredStringSchema,
} from '@travel-guide/shared-schemas';
import type {
  GeoPoint,
  PlaceCategory,
  PlaceListResult,
  SearchPlacesInput,
} from '@travel-guide/shared-types';

export interface NormalizedPlaceSearch {
  readonly provider?: string;
  readonly cityName: string;
  readonly cityCode?: string;
  readonly keyword?: string;
  readonly categories: PlaceCategory[];
  readonly page: number;
  readonly pageSize: number;
}

export interface ProviderPlace {
  readonly provider: string;
  readonly providerPlaceId: string;
  readonly cityName?: string;
  readonly cityCode?: string;
  readonly name: string;
  readonly category: PlaceCategory;
  readonly categoryText: string;
  readonly address: string;
  readonly location: GeoPoint;
  readonly rating?: number;
  readonly openingHours?: string;
  readonly telephone?: string;
  readonly rawTypeCode?: string;
}

export const ProviderPlaceSchema: z.ZodType<ProviderPlace, z.ZodTypeDef, unknown> = z
  .object({
    provider: createTrimmedRequiredStringSchema('provider', 64),
    providerPlaceId: createTrimmedRequiredStringSchema('providerPlaceId', 128),
    cityName: createOptionalTrimmedStringSchema('cityName', 100),
    cityCode: createOptionalTrimmedStringSchema('cityCode', 32),
    name: createTrimmedRequiredStringSchema('name', 200),
    category: PlaceCategorySchema,
    categoryText: createTrimmedRequiredStringSchema('categoryText', 100),
    address: createTrimmedRequiredStringSchema('address', 500),
    location: GeoPointSchema,
    rating: z.number().finite().min(0).max(5).optional(),
    openingHours: createOptionalTrimmedStringSchema('openingHours', 500),
    telephone: createOptionalTrimmedStringSchema('telephone', 64),
    rawTypeCode: createOptionalTrimmedStringSchema('rawTypeCode', 32),
  })
  .strict();

export interface PlaceProviderInput {
  readonly cityName: string;
  readonly cityCode?: string;
  readonly keyword?: string;
  readonly categories: PlaceCategory[];
  readonly page: number;
  readonly pageSize: number;
}

export interface PlaceProviderResult {
  readonly items: ProviderPlace[];
  readonly total?: number;
  readonly fetchedAt: string;
}

export interface PlaceProvider {
  readonly name: string;
  searchPlaces(input: PlaceProviderInput): Promise<PlaceProviderResult>;
}

export type PlaceSearchInput = SearchPlacesInput;
export type PlaceSearchResult = PlaceListResult;
