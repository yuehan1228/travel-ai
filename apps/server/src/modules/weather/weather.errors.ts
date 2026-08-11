import { ApiBusinessException } from '../../http/api-business.exception';

export const WEATHER_ERROR_CODES = [
  'WEATHER_VALIDATION_ERROR',
  'WEATHER_PROVIDER_ERROR',
  'WEATHER_UNAVAILABLE',
  'WEATHER_PERSISTENCE_ERROR',
] as const;

export type WeatherErrorCode = (typeof WEATHER_ERROR_CODES)[number];

export class WeatherException extends ApiBusinessException {
  public constructor(code: WeatherErrorCode, statusCode: number, message: string) {
    super(statusCode, code, message);
  }
}

export class WeatherProviderError extends Error {
  public constructor() {
    super('Weather provider request failed');
    this.name = 'WeatherProviderError';
  }
}
