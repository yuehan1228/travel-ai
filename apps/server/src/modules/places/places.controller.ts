import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { SearchPlacesInputSchema } from '@travel-guide/shared-schemas';
import type { ApiSuccess, PlaceListResult, SearchPlacesInput } from '@travel-guide/shared-types';

import { getRequestId } from '../../http/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUserId } from '../auth/auth-user.decorator';
import { PlaceException } from './place.errors';
import { PlaceService } from './place.service';

const requestIdFor = (request: FastifyRequest): string => getRequestId(request) ?? request.id;

const validationError = (): PlaceException =>
  new PlaceException('PLACE_VALIDATION_ERROR', 400, 'The place input is invalid');

const parseQuery = (query: unknown): SearchPlacesInput => {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw validationError();
  }
  const record = query as Record<string, unknown>;
  const allowedKeys = new Set([
    'cityName',
    'cityCode',
    'keyword',
    'categories',
    'page',
    'pageSize',
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) throw validationError();

  const categories = record.categories;
  const categoryList =
    typeof categories === 'string'
      ? categories
          .split(',')
          .map((category) => category.trim())
          .filter((category) => category.length > 0)
      : Array.isArray(categories)
        ? categories
        : undefined;
  const parsed = SearchPlacesInputSchema.safeParse({
    cityName: record.cityName,
    ...(record.cityCode === undefined ? {} : { cityCode: record.cityCode }),
    ...(record.keyword === undefined ? {} : { keyword: record.keyword }),
    categories: categoryList,
    ...(record.page === undefined ? {} : { page: record.page }),
    ...(record.pageSize === undefined ? {} : { pageSize: record.pageSize }),
  });
  if (!parsed.success) throw validationError();
  return parsed.data;
};

@Controller('places')
@UseGuards(AuthGuard)
export class PlacesController {
  public constructor(@Inject(PlaceService) private readonly placeService: PlaceService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  public async search(
    @Query() query: unknown,
    @CurrentUserId() _userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<PlaceListResult>> {
    return {
      success: true,
      data: await this.placeService.searchPlaces(parseQuery(query)),
      requestId: requestIdFor(request),
    };
  }
}
