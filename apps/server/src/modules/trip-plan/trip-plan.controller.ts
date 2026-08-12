import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import {
  GenerateTripPlanInputSchema,
  RegenerateTripPlanDayInputSchema,
  RegenerateTripPlanDayResultSchema,
  TripIdSchema,
  TripPlanGenerationResultSchema,
  TripPlanVersionListResultSchema,
} from '@travel-guide/shared-schemas';
import type {
  ApiSuccess,
  GenerateTripPlanInput,
  RegenerateTripPlanDayInput,
  RegenerateTripPlanDayResult,
  TripPlanGenerationResult,
  TripPlanVersionListResult,
} from '@travel-guide/shared-types';

import { getRequestId } from '../../http/request-context';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUserId } from '../auth/auth-user.decorator';
import { TripPlanException } from './trip-plan.errors';
import { TripPlanService } from './trip-plan.service';

const requestIdFor = (request: FastifyRequest): string => getRequestId(request) ?? request.id;

const validationError = (): TripPlanException =>
  new TripPlanException('TRIP_PLAN_VALIDATION_ERROR', 400, 'The TripPlan request is invalid');

const parseTripId = (value: string): string => {
  const parsed = TripIdSchema.safeParse(value);
  if (!parsed.success) throw validationError();
  return parsed.data;
};

const parseVersion = (value: string): number => {
  if (!/^\d+$/.test(value)) throw validationError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
    throw validationError();
  }
  return parsed;
};

@Controller('trips')
@UseGuards(AuthGuard)
export class TripPlanController {
  public constructor(@Inject(TripPlanService) private readonly service: TripPlanService) {}

  @Post(':id/generate')
  @HttpCode(HttpStatus.OK)
  public async generate(
    @Param('id') tripId: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripPlanGenerationResult>> {
    const parsedBody = GenerateTripPlanInputSchema.safeParse(body);
    if (!parsedBody.success) throw validationError();
    const result = await this.service.generate(userId, parseTripId(tripId), parsedBody.data);
    const validated = TripPlanGenerationResultSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }

  @Post(':id/regenerate-day')
  @HttpCode(HttpStatus.OK)
  public async regenerateDay(
    @Param('id') tripId: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<RegenerateTripPlanDayResult>> {
    const parsedBody = RegenerateTripPlanDayInputSchema.safeParse(body);
    if (!parsedBody.success) throw validationError();
    const result = await this.service.regenerateDay(userId, parseTripId(tripId), parsedBody.data);
    const validated = RegenerateTripPlanDayResultSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }

  @Get(':id/plan')
  @HttpCode(HttpStatus.OK)
  public async getLatest(
    @Param('id') tripId: string,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripPlanVersionListResult>> {
    const result = await this.service.getLatest(userId, parseTripId(tripId));
    const validated = TripPlanVersionListResultSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }

  @Get(':id/plan/:version')
  @HttpCode(HttpStatus.OK)
  public async getVersion(
    @Param('id') tripId: string,
    @Param('version') version: string,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripPlanGenerationResult>> {
    const result = await this.service.getVersion(
      userId,
      parseTripId(tripId),
      parseVersion(version),
    );
    const validated = TripPlanGenerationResultSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }
}

export type { GenerateTripPlanInput, RegenerateTripPlanDayInput };
