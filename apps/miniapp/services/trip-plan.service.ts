import {
  EditTripPlanInputSchema,
  EditTripPlanResultSchema,
  GenerateTripPlanInputSchema,
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
} from '@travel-guide/shared-schemas';
import type {
  EditTripPlanInput,
  EditTripPlanResult,
  GenerateTripPlanInput,
  RegenerateTripPlanDayInput,
  RegenerateTripPlanDayResult,
  RestoreTripPlanVersionInput,
  RestoreTripPlanVersionResult,
  TripPlanGenerationResult,
  TripPlanVersionDiffResult,
  TripPlanVersionListResult,
  ListTripPlanItemReplacementCandidatesInput,
  TripPlanItemReplacementCandidateList,
  ReplaceTripPlanItemInput,
  ReplaceTripPlanItemResult,
} from '@travel-guide/shared-types';

import { AuthService, authService } from './auth.service';
import { createHttpClient, requestApi, type HttpClient, type RequestOptions } from './http-client';
import { RequestError } from './request-error';

export type TripPlanAuthService = Pick<AuthService, 'getAccessToken' | 'logout'>;

const parseVersion = (version: number): number => {
  if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
    throw new RequestError({ code: 'INVALID_RESPONSE', message: 'Invalid TripPlan version' });
  }
  return version;
};

export class TripPlanService {
  public constructor(
    private readonly client: HttpClient = createHttpClient(),
    private readonly auth: TripPlanAuthService = authService,
  ) {}

  public async generateTripPlan(
    id: string,
    input: GenerateTripPlanInput = {},
  ): Promise<TripPlanGenerationResult> {
    const tripId = TripIdSchema.parse(id);
    const parsedInput = GenerateTripPlanInputSchema.parse(input);
    return this.request<TripPlanGenerationResult>({
      method: 'POST',
      path: `/trips/${encodeURIComponent(tripId)}/generate`,
      data: parsedInput,
      schema: TripPlanGenerationResultSchema,
    });
  }

  public async getLatestTripPlan(id: string): Promise<TripPlanVersionListResult> {
    const tripId = TripIdSchema.parse(id);
    return this.request<TripPlanVersionListResult>({
      method: 'GET',
      path: `/trips/${encodeURIComponent(tripId)}/plan`,
      schema: TripPlanVersionListResultSchema,
    });
  }

  public async getTripPlanVersion(id: string, version: number): Promise<TripPlanGenerationResult> {
    const tripId = TripIdSchema.parse(id);
    const parsedVersion = parseVersion(version);
    return this.request<TripPlanGenerationResult>({
      method: 'GET',
      path: `/trips/${encodeURIComponent(tripId)}/plan/${parsedVersion}`,
      schema: TripPlanGenerationResultSchema,
    });
  }

  public async getTripPlanDiff(
    id: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<TripPlanVersionDiffResult> {
    const tripId = TripIdSchema.parse(id);
    const parsedInput = TripPlanVersionDiffInputSchema.parse({ fromVersion, toVersion });
    return this.request<TripPlanVersionDiffResult>({
      method: 'GET',
      path: `/trips/${encodeURIComponent(tripId)}/plan/diff?fromVersion=${parsedInput.fromVersion}&toVersion=${parsedInput.toVersion}`,
      schema: TripPlanVersionDiffResultSchema,
    });
  }

  public async restoreTripPlanVersion(
    id: string,
    version: number,
    input: RestoreTripPlanVersionInput = {},
  ): Promise<RestoreTripPlanVersionResult> {
    const tripId = TripIdSchema.parse(id);
    const parsedVersion = parseVersion(version);
    const parsedInput = RestoreTripPlanVersionInputSchema.parse(input);
    return this.request<RestoreTripPlanVersionResult>({
      method: 'POST',
      path: `/trips/${encodeURIComponent(tripId)}/plan/${parsedVersion}/restore`,
      data: parsedInput,
      schema: RestoreTripPlanVersionResultSchema,
    });
  }

  public async regenerateTripPlanDay(
    id: string,
    input: RegenerateTripPlanDayInput,
  ): Promise<RegenerateTripPlanDayResult>;
  public async regenerateTripPlanDay(
    id: string,
    sourceVersion: number,
    dayNumber: number,
    instruction?: string,
  ): Promise<RegenerateTripPlanDayResult>;
  public async regenerateTripPlanDay(
    id: string,
    inputOrSourceVersion: RegenerateTripPlanDayInput | number,
    dayNumber?: number,
    instruction?: string,
  ): Promise<RegenerateTripPlanDayResult> {
    const tripId = TripIdSchema.parse(id);
    const input: RegenerateTripPlanDayInput =
      typeof inputOrSourceVersion === 'number'
        ? {
            sourceVersion: inputOrSourceVersion,
            dayNumber: dayNumber ?? 0,
            ...(instruction === undefined ? {} : { instruction }),
          }
        : inputOrSourceVersion;
    const parsedInput = RegenerateTripPlanDayInputSchema.parse(input);
    return this.request<RegenerateTripPlanDayResult>({
      method: 'POST',
      path: `/trips/${encodeURIComponent(tripId)}/regenerate-day`,
      data: parsedInput,
      schema: RegenerateTripPlanDayResultSchema,
    });
  }

  public async editTripPlanVersion(
    id: string,
    version: number,
    input: EditTripPlanInput,
  ): Promise<EditTripPlanResult> {
    const tripId = TripIdSchema.parse(id);
    const parsedVersion = parseVersion(version);
    const parsedInput = EditTripPlanInputSchema.parse(input);
    if (parsedInput.sourceVersion !== parsedVersion) {
      throw new RequestError({
        code: 'INVALID_RESPONSE',
        message: 'Edit source version does not match the URL version',
      });
    }
    return this.request<EditTripPlanResult>({
      method: 'PATCH',
      path: `/trips/${encodeURIComponent(tripId)}/plan/${parsedVersion}`,
      data: parsedInput,
      schema: EditTripPlanResultSchema,
    });
  }

  public async listReplacementCandidates(
    id: string,
    version: number,
    input: ListTripPlanItemReplacementCandidatesInput,
  ): Promise<TripPlanItemReplacementCandidateList>;
  public async listReplacementCandidates(
    id: string,
    version: number,
    dayNumber: number,
    itemId: string,
    page?: number,
    pageSize?: number,
  ): Promise<TripPlanItemReplacementCandidateList>;
  public async listReplacementCandidates(
    id: string,
    version: number,
    inputOrDayNumber: ListTripPlanItemReplacementCandidatesInput | number,
    itemId?: string,
    page?: number,
    pageSize?: number,
  ): Promise<TripPlanItemReplacementCandidateList> {
    const tripId = TripIdSchema.parse(id);
    const input: ListTripPlanItemReplacementCandidatesInput =
      typeof inputOrDayNumber === 'number'
        ? {
            sourceVersion: version,
            dayNumber: inputOrDayNumber,
            itemId: itemId ?? '',
            ...(page === undefined ? {} : { page }),
            ...(pageSize === undefined ? {} : { pageSize }),
          }
        : inputOrDayNumber;
    const parsedInput = ListTripPlanItemReplacementCandidatesInputSchema.parse(input);
    if (parsedInput.sourceVersion !== version) {
      throw new RequestError({
        code: 'INVALID_RESPONSE',
        message: 'Replacement source version does not match the URL version',
      });
    }
    const query = [`dayNumber=${parsedInput.dayNumber}`];
    if (parsedInput.page !== undefined) query.push(`page=${parsedInput.page}`);
    if (parsedInput.pageSize !== undefined) query.push(`pageSize=${parsedInput.pageSize}`);
    return this.request<TripPlanItemReplacementCandidateList>({
      method: 'GET',
      path: `/trips/${encodeURIComponent(tripId)}/plan/${parsedInput.sourceVersion}/items/${encodeURIComponent(parsedInput.itemId)}/replacement-candidates?${query.join('&')}`,
      schema: TripPlanItemReplacementCandidateListSchema,
    });
  }

  public async replaceTripPlanItem(
    id: string,
    version: number,
    input: ReplaceTripPlanItemInput,
  ): Promise<ReplaceTripPlanItemResult> {
    const tripId = TripIdSchema.parse(id);
    const parsedVersion = parseVersion(version);
    const parsedInput = ReplaceTripPlanItemInputSchema.parse(input);
    if (parsedInput.sourceVersion !== parsedVersion) {
      throw new RequestError({
        code: 'INVALID_RESPONSE',
        message: 'Replacement source version does not match the URL version',
      });
    }
    const result = await this.request<ReplaceTripPlanItemResult>({
      method: 'POST',
      path: `/trips/${encodeURIComponent(tripId)}/plan/${parsedVersion}/replace-item`,
      data: parsedInput,
      schema: ReplaceTripPlanItemResultSchema,
    });
    if (
      result.tripId !== tripId ||
      result.sourceVersion !== parsedInput.sourceVersion ||
      result.dayNumber !== parsedInput.dayNumber ||
      result.itemId !== parsedInput.itemId
    ) {
      throw new RequestError({ code: 'INVALID_RESPONSE', message: 'Replacement result mismatch' });
    }
    return result;
  }

  private async request<TResponse>(options: RequestOptions<TResponse>): Promise<TResponse> {
    const token = this.auth.getAccessToken();
    if (token === undefined || token.trim().length === 0) {
      throw new RequestError({ code: 'AUTH_TOKEN_INVALID', message: 'Authentication is required' });
    }

    try {
      return await requestApi(
        {
          ...options,
          header: {
            ...(options.header ?? {}),
            Authorization: `Bearer ${token}`,
          },
        },
        this.client,
      );
    } catch (error: unknown) {
      if (
        error instanceof RequestError &&
        (error.apiCode === 'AUTH_TOKEN_INVALID' || error.code === 'AUTH_TOKEN_INVALID')
      ) {
        this.auth.logout();
      }
      throw error;
    }
  }
}

export const createTripPlanService = (
  client: HttpClient = createHttpClient(),
  auth: TripPlanAuthService = authService,
): TripPlanService => new TripPlanService(client, auth);

export const tripPlanService = new TripPlanService();
