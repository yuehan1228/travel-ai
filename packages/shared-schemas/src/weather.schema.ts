import { z } from 'zod';

import type {
  DailyWeather,
  GetWeatherInput,
  WeatherCondition,
  WeatherDataSource,
  WeatherLocationInput,
  WeatherResult,
} from '@travel-guide/shared-types';
import { WEATHER_CONDITIONS, WEATHER_DATA_SOURCES } from '@travel-guide/shared-types';

import {
  createOptionalTrimmedStringSchema,
  createTrimmedRequiredStringSchema,
} from './common.schema';
import { IsoDateSchema } from './trip-input.schema';

export const WeatherDataSourceSchema: z.ZodType<WeatherDataSource, z.ZodTypeDef, unknown> =
  z.enum(WEATHER_DATA_SOURCES);

export const WeatherConditionSchema: z.ZodType<WeatherCondition, z.ZodTypeDef, unknown> =
  z.enum(WEATHER_CONDITIONS);

export const WeatherLocationInputSchema: z.ZodType<WeatherLocationInput, z.ZodTypeDef, unknown> = z
  .object({
    cityName: createTrimmedRequiredStringSchema('cityName', 100),
    cityCode: createOptionalTrimmedStringSchema('cityCode', 32),
  })
  .strict();

const validateDateRange = <T extends { startDate: string; endDate: string }>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): z.ZodType<T, z.ZodTypeDef, unknown> =>
  schema.superRefine((value, context) => {
    const start = Date.parse(`${value.startDate}T00:00:00Z`);
    const end = Date.parse(`${value.endDate}T00:00:00Z`);
    if (end < start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'endDate must not be earlier than startDate',
      });
      return;
    }

    const durationDays = Math.floor((end - start) / 86_400_000) + 1;
    if (durationDays > 14) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'weather query must not exceed 14 days',
      });
    }
  });

export const GetWeatherInputSchema: z.ZodType<GetWeatherInput, z.ZodTypeDef, unknown> =
  validateDateRange(
    z
      .object({
        destination: WeatherLocationInputSchema,
        startDate: IsoDateSchema,
        endDate: IsoDateSchema,
      })
      .strict(),
  );

const temperatureSchema = z.number().finite().min(-80).max(60);
const precipitationProbabilitySchema = z.number().finite().min(0).max(100);
const humiditySchema = z.number().finite().min(0).max(100);

export const DailyWeatherSchema: z.ZodType<DailyWeather, z.ZodTypeDef, unknown> = z
  .object({
    date: IsoDateSchema,
    condition: WeatherConditionSchema,
    conditionText: z.string().trim().min(1).max(100),
    minTemperatureC: temperatureSchema.optional(),
    maxTemperatureC: temperatureSchema.optional(),
    precipitationProbability: precipitationProbabilitySchema.optional(),
    windScale: z.string().trim().min(1).max(32).optional(),
    humidityPercent: humiditySchema.optional(),
    source: WeatherDataSourceSchema,
    isReference: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.minTemperatureC !== undefined &&
      value.maxTemperatureC !== undefined &&
      value.minTemperatureC > value.maxTemperatureC
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxTemperatureC'],
        message: 'maxTemperatureC must not be lower than minTemperatureC',
      });
    }

    if (value.source === 'forecast' && value.isReference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isReference'],
        message: 'forecast weather cannot be marked as reference data',
      });
    }
    if (value.source === 'climate_reference' && !value.isReference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isReference'],
        message: 'climate reference weather must be marked as reference data',
      });
    }
    if (value.source === 'unavailable' && value.condition !== 'unknown') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['condition'],
        message: 'unavailable weather must use unknown condition',
      });
    }
    if (value.source === 'unavailable') {
      if (
        value.isReference ||
        value.minTemperatureC !== undefined ||
        value.maxTemperatureC !== undefined ||
        value.precipitationProbability !== undefined ||
        value.humidityPercent !== undefined ||
        value.windScale !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['source'],
          message: 'unavailable weather must not contain measurements or reference metadata',
        });
      }
    }
  });

export const WeatherResultSchema: z.ZodType<WeatherResult, z.ZodTypeDef, unknown> = z
  .object({
    destination: WeatherLocationInputSchema,
    days: z.array(DailyWeatherSchema).max(14),
    source: WeatherDataSourceSchema,
    notice: z.string().trim().min(1).max(200).optional(),
    fetchedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasForecast = value.days.some((day) => day.source === 'forecast');
    const hasClimateReference = value.days.some((day) => day.source === 'climate_reference');
    const expectedSource = hasForecast
      ? 'forecast'
      : hasClimateReference
        ? 'climate_reference'
        : 'unavailable';
    if (value.source !== expectedSource) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source'],
        message: 'source does not match the daily data sources',
      });
    }
    if (hasClimateReference && value.notice === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notice'],
        message: 'climate reference days require a notice',
      });
    }
  });
