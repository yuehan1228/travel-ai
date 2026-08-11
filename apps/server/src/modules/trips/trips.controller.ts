import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import {
  CreateTripInputSchema,
  ListTripsInputSchema,
  TripIdSchema,
  UpdateTripInputSchema,
} from '@travel-guide/shared-schemas';
import type {
  ApiSuccess,
  CreateTripInput,
  ListTripsInput,
  TripDeleteResult,
  TripDetail,
  TripListResult,
  UpdateTripInput,
} from '@travel-guide/shared-types';

import { getRequestId } from '../../http/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUserId } from '../auth/auth-user.decorator';
import { TripException } from './trip.errors';
import { TripService } from './trip.service';

const requestIdFor = (request: FastifyRequest): string => getRequestId(request) ?? request.id;

const tripValidationError = (): TripException =>
  new TripException('TRIP_VALIDATION_ERROR', 400, 'The trip input is invalid');

const parseTripId = (tripId: string): string => {
  const parsed = TripIdSchema.safeParse(tripId);
  if (!parsed.success) {
    throw tripValidationError();
  }

  return parsed.data;
};

@Controller('trips')
@UseGuards(AuthGuard)
export class TripsController {
  public constructor(@Inject(TripService) private readonly tripService: TripService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(
    @Body() body: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripDetail>> {
    const parsed = CreateTripInputSchema.safeParse(body);
    if (!parsed.success) {
      throw tripValidationError();
    }

    const data = await this.tripService.create(userId, parsed.data);
    return {
      success: true,
      data,
      requestId: requestIdFor(request),
    };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  public async list(
    @Query() query: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripListResult>> {
    const parsed = ListTripsInputSchema.safeParse(query);
    if (!parsed.success) {
      throw tripValidationError();
    }

    return {
      success: true,
      data: await this.tripService.list(userId, parsed.data),
      requestId: requestIdFor(request),
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  public async get(
    @Param('id') tripId: string,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripDetail>> {
    const parsedTripId = parseTripId(tripId);
    return {
      success: true,
      data: await this.tripService.get(userId, parsedTripId),
      requestId: requestIdFor(request),
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  public async update(
    @Param('id') tripId: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripDetail>> {
    const parsedTripId = parseTripId(tripId);
    const parsed = UpdateTripInputSchema.safeParse(body);
    if (!parsed.success) {
      throw tripValidationError();
    }

    return {
      success: true,
      data: await this.tripService.update(userId, parsedTripId, parsed.data),
      requestId: requestIdFor(request),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  public async remove(
    @Param('id') tripId: string,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripDeleteResult>> {
    const parsedTripId = parseTripId(tripId);
    return {
      success: true,
      data: await this.tripService.remove(userId, parsedTripId),
      requestId: requestIdFor(request),
    };
  }
}

export type { CreateTripInput, ListTripsInput, UpdateTripInput };
