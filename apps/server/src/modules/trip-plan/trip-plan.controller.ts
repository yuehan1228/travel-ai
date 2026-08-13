import {
  Body,
  Controller,
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
import { z } from 'zod';

import {
  GenerateTripPlanInputSchema,
  EditTripPlanInputSchema,
  EditTripPlanResultSchema,
  RegenerateTripPlanDayInputSchema,
  RegenerateTripPlanDayResultSchema,
  RestoreTripPlanVersionInputSchema,
  RestoreTripPlanVersionResultSchema,
  TripIdSchema,
  TripPlanGenerationResultSchema,
  TripPlanVersionDiffInputSchema,
  TripPlanVersionDiffResultSchema,
  TripPlanVersionListResultSchema,
  ListTripPlanItemReplacementCandidatesInputSchema,
  TripPlanItemReplacementCandidateListSchema,
  ReplaceTripPlanItemInputSchema,
  ReplaceTripPlanItemResultSchema,
  ReorderTripPlanItemsInputSchema,
  ReorderTripPlanItemsResultSchema,
  OptimizeTripPlanDayInputSchema,
  OptimizeTripPlanDayResultSchema,
} from '@travel-guide/shared-schemas';
import type {
  ApiSuccess,
  GenerateTripPlanInput,
  EditTripPlanResult,
  RegenerateTripPlanDayInput,
  RegenerateTripPlanDayResult,
  RestoreTripPlanVersionInput,
  RestoreTripPlanVersionResult,
  TripPlanVersionDiffInput,
  TripPlanVersionDiffResult,
  TripPlanGenerationResult,
  TripPlanVersionListResult,
  ListTripPlanItemReplacementCandidatesInput,
  TripPlanItemReplacementCandidateList,
  ReplaceTripPlanItemResult,
  ReorderTripPlanItemsResult,
  OptimizeTripPlanDayResult,
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

const parseItemId = (value: string): string => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw validationError();
  return parsed.data;
};

const parseDiffQuery = (query: unknown): TripPlanVersionDiffInput => {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw validationError();
  }
  const value = query as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'fromVersion' || keys[1] !== 'toVersion') {
    throw validationError();
  }
  const parseQueryVersion = (raw: unknown): number | undefined => {
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  };
  const parsed = TripPlanVersionDiffInputSchema.safeParse({
    fromVersion: parseQueryVersion(value.fromVersion),
    toVersion: parseQueryVersion(value.toVersion),
  });
  if (!parsed.success) throw validationError();
  return parsed.data;
};

const parseReplacementCandidateQuery = (
  query: unknown,
  sourceVersion: number,
  itemId: string,
): ListTripPlanItemReplacementCandidatesInput => {
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw validationError();
  }
  const value = query as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.some((key) => !['dayNumber', 'page', 'pageSize'].includes(key))) {
    throw validationError();
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'dayNumber')) {
    throw validationError();
  }
  const parseQueryNumber = (raw: unknown): number | undefined => {
    if (typeof raw === 'number') return raw;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  };
  const parsed = ListTripPlanItemReplacementCandidatesInputSchema.safeParse({
    sourceVersion,
    itemId,
    dayNumber: parseQueryNumber(value.dayNumber),
    ...(Object.prototype.hasOwnProperty.call(value, 'page')
      ? { page: parseQueryNumber(value.page) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'pageSize')
      ? { pageSize: parseQueryNumber(value.pageSize) }
      : {}),
  });
  if (!parsed.success) throw validationError();
  return parsed.data;
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

  @Get(':id/plan/:version/items/:itemId/replacement-candidates')
  @HttpCode(HttpStatus.OK)
  public async listReplacementCandidates(
    @Param('id') tripId: string,
    @Param('version') version: string,
    @Param('itemId') itemId: string,
    @Query() query: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripPlanItemReplacementCandidateList>> {
    const parsedVersion = parseVersion(version);
    const parsedItemId = parseItemId(itemId);
    const parsedInput = parseReplacementCandidateQuery(query, parsedVersion, parsedItemId);
    const result = await this.service.listReplacementCandidates(
      userId,
      parseTripId(tripId),
      parsedVersion,
      parsedInput,
    );
    const validated = TripPlanItemReplacementCandidateListSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }

  @Post(':id/plan/:version/replace-item')
  @HttpCode(HttpStatus.OK)
  public async replaceItem(
    @Param('id') tripId: string,
    @Param('version') version: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<ReplaceTripPlanItemResult>> {
    const parsedVersion = parseVersion(version);
    const parsedBody = ReplaceTripPlanItemInputSchema.safeParse(body);
    if (!parsedBody.success || parsedBody.data.sourceVersion !== parsedVersion) {
      throw validationError();
    }
    const result = await this.service.replaceTripPlanItem(
      userId,
      parseTripId(tripId),
      parsedVersion,
      parsedBody.data,
    );
    const validated = ReplaceTripPlanItemResultSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }

  @Post(':id/plan/:version/reorder-items')
  @HttpCode(HttpStatus.OK)
  public async reorderItems(
    @Param('id') tripId: string,
    @Param('version') version: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<ReorderTripPlanItemsResult>> {
    const parsedVersion = parseVersion(version);
    const parsedBody = ReorderTripPlanItemsInputSchema.safeParse(body);
    if (!parsedBody.success || parsedBody.data.sourceVersion !== parsedVersion) {
      throw validationError();
    }
    const result = await this.service.reorderTripPlanItems(
      userId,
      parseTripId(tripId),
      parsedVersion,
      parsedBody.data,
    );
    const validated = ReorderTripPlanItemsResultSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }

  @Post(':id/plan/:version/optimize-order')
  @HttpCode(HttpStatus.OK)
  public async optimizeOrder(
    @Param('id') tripId: string,
    @Param('version') version: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<OptimizeTripPlanDayResult>> {
    const parsedVersion = parseVersion(version);
    const parsedBody = OptimizeTripPlanDayInputSchema.safeParse(body);
    if (!parsedBody.success || parsedBody.data.sourceVersion !== parsedVersion) {
      throw validationError();
    }
    const result = await this.service.optimizeTripPlanDay(
      userId,
      parseTripId(tripId),
      parsedVersion,
      parsedBody.data,
    );
    const validated = OptimizeTripPlanDayResultSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }

  @Patch(':id/plan/:version')
  @HttpCode(HttpStatus.OK)
  public async edit(
    @Param('id') tripId: string,
    @Param('version') version: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<EditTripPlanResult>> {
    const parsedBody = EditTripPlanInputSchema.safeParse(body);
    if (!parsedBody.success) throw validationError();
    const parsedVersion = parseVersion(version);
    if (parsedBody.data.sourceVersion !== parsedVersion) throw validationError();
    const result = await this.service.editTripPlanVersion(
      userId,
      parseTripId(tripId),
      parsedVersion,
      parsedBody.data,
    );
    const validated = EditTripPlanResultSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }

  @Get(':id/plan/diff')
  @HttpCode(HttpStatus.OK)
  public async diff(
    @Param('id') tripId: string,
    @Query() query: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<TripPlanVersionDiffResult>> {
    const result = await this.service.getTripPlanDiff(
      userId,
      parseTripId(tripId),
      parseDiffQuery(query),
    );
    const validated = TripPlanVersionDiffResultSchema.safeParse(result);
    if (!validated.success)
      throw new TripPlanException(
        'TRIP_PLAN_PERSISTENCE_ERROR',
        500,
        'TripPlan data could not be persisted',
      );
    return { success: true, data: validated.data, requestId: requestIdFor(request) };
  }

  @Post(':id/plan/:version/restore')
  @HttpCode(HttpStatus.OK)
  public async restore(
    @Param('id') tripId: string,
    @Param('version') version: string,
    @Body() body: unknown,
    @CurrentUserId() userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<RestoreTripPlanVersionResult>> {
    const parsedBody = RestoreTripPlanVersionInputSchema.safeParse(body);
    if (!parsedBody.success) throw validationError();
    const result = await this.service.restoreTripPlanVersion(
      userId,
      parseTripId(tripId),
      parseVersion(version),
      parsedBody.data,
    );
    const validated = RestoreTripPlanVersionResultSchema.safeParse(result);
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

export type {
  GenerateTripPlanInput,
  RegenerateTripPlanDayInput,
  RestoreTripPlanVersionInput,
  TripPlanVersionDiffInput,
};
