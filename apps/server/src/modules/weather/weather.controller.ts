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

import { GetWeatherInputSchema } from '@travel-guide/shared-schemas';
import type { ApiSuccess, GetWeatherInput, WeatherResult } from '@travel-guide/shared-types';

import { getRequestId } from '../../http/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUserId } from '../auth/auth-user.decorator';
import { WeatherException } from './weather.errors';
import { WeatherService } from './weather.service';

const requestIdFor = (request: FastifyRequest): string => getRequestId(request) ?? request.id;

const parseQuery = (query: unknown): GetWeatherInput => {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw new WeatherException('WEATHER_VALIDATION_ERROR', 400, 'The weather input is invalid');
  }

  const record = query as Record<string, unknown>;
  const allowedKeys = new Set(['cityName', 'cityCode', 'startDate', 'endDate']);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new WeatherException('WEATHER_VALIDATION_ERROR', 400, 'The weather input is invalid');
  }
  const parsed = GetWeatherInputSchema.safeParse({
    destination: {
      cityName: record.cityName,
      ...(record.cityCode === undefined ? {} : { cityCode: record.cityCode }),
    },
    startDate: record.startDate,
    endDate: record.endDate,
  });
  if (!parsed.success) {
    throw new WeatherException('WEATHER_VALIDATION_ERROR', 400, 'The weather input is invalid');
  }
  return parsed.data;
};

@Controller('weather')
@UseGuards(AuthGuard)
export class WeatherController {
  public constructor(@Inject(WeatherService) private readonly weatherService: WeatherService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  public async get(
    @Query() query: unknown,
    @CurrentUserId() _userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<WeatherResult>> {
    const input = parseQuery(query);
    return {
      success: true,
      data: await this.weatherService.getWeather(input),
      requestId: requestIdFor(request),
    };
  }
}
