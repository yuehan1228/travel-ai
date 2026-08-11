import { z } from 'zod';

import type {
  ListTripsInput,
  TripDeleteResult,
  TripDetail,
  TripListResult,
  TripStatus,
  TripSummary,
  UpdateTripInput,
} from '@travel-guide/shared-types';
import { TRIP_STATUSES } from '@travel-guide/shared-types';

import {
  CreateTripInputSchema,
  CreateTripInputObjectSchema,
  DestinationInputSchema,
  IsoDateSchema,
} from './trip-input.schema';
import { PaginationMetaSchema } from './api.schema';

export const TripStatusSchema: z.ZodType<TripStatus, z.ZodTypeDef, unknown> = z.enum(TRIP_STATUSES);

export const TripIdSchema = z
  .string({ invalid_type_error: 'trip id must be a string' })
  .uuid({ message: 'trip id must be a valid UUID' });

/** A partial input used by PATCH. At least one complete input field is required. */
export const UpdateTripInputSchema: z.ZodType<UpdateTripInput, z.ZodTypeDef, unknown> =
  CreateTripInputObjectSchema.innerType()
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: 'at least one trip field must be provided',
    });

const pageSchema = z.coerce
  .number({ invalid_type_error: 'page must be a number' })
  .finite({ message: 'page must be finite' })
  .int({ message: 'page must be an integer' })
  .min(1, { message: 'page must be at least 1' })
  .default(1);

const pageSizeSchema = z.coerce
  .number({ invalid_type_error: 'pageSize must be a number' })
  .finite({ message: 'pageSize must be finite' })
  .int({ message: 'pageSize must be an integer' })
  .min(1, { message: 'pageSize must be at least 1' })
  .max(100, { message: 'pageSize must be at most 100' })
  .default(20);

export const ListTripsInputSchema: z.ZodType<ListTripsInput, z.ZodTypeDef, unknown> = z
  .object({
    page: pageSchema,
    pageSize: pageSizeSchema,
    status: TripStatusSchema.optional(),
  })
  .strict() as z.ZodType<ListTripsInput, z.ZodTypeDef, unknown>;

const responseTimestampSchema = z
  .string({ invalid_type_error: 'timestamp must be a string' })
  .datetime({ offset: true });

export const TripSummarySchema: z.ZodType<TripSummary, z.ZodTypeDef, unknown> = z
  .object({
    id: TripIdSchema,
    status: TripStatusSchema,
    destination: DestinationInputSchema,
    startDate: IsoDateSchema,
    endDate: IsoDateSchema,
    travelerCount: z.number().int().min(1).max(20),
    createdAt: responseTimestampSchema,
    updatedAt: responseTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const start = Date.parse(`${value.startDate}T00:00:00Z`);
    const end = Date.parse(`${value.endDate}T00:00:00Z`);
    const durationDays = Math.round((end - start) / 86_400_000) + 1;
    if (end < start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must not be earlier than startDate',
      });
    } else if (durationDays > 14) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'trip duration must not exceed 14 days',
      });
    }
  });

export const TripDetailSchema: z.ZodType<TripDetail, z.ZodTypeDef, unknown> = z
  .object({
    ...CreateTripInputObjectSchema.innerType().shape,
    id: TripIdSchema,
    status: TripStatusSchema,
    createdAt: responseTimestampSchema,
    updatedAt: responseTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const input: Record<string, unknown> = Object.assign({}, value);
    delete input.id;
    delete input.status;
    delete input.createdAt;
    delete input.updatedAt;
    const parsedInput = CreateTripInputSchema.safeParse(input);
    if (!parsedInput.success) {
      for (const issue of parsedInput.error.issues) {
        context.addIssue(issue);
      }
    }
  });

export const TripListResultSchema: z.ZodType<TripListResult, z.ZodTypeDef, unknown> = z
  .object({
    items: z.array(TripSummarySchema),
    pagination: PaginationMetaSchema,
  })
  .strict();

export const TripDeleteResultSchema: z.ZodType<TripDeleteResult, z.ZodTypeDef, unknown> = z
  .object({
    id: TripIdSchema,
    deleted: z.literal(true),
  })
  .strict();
