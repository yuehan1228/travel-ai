import { ApiBusinessException } from '../../http/api-business.exception';

export const PLACE_ERROR_CODES = [
  'PLACE_VALIDATION_ERROR',
  'PLACE_PROVIDER_ERROR',
  'PLACE_PERSISTENCE_ERROR',
] as const;

export type PlaceErrorCode = (typeof PLACE_ERROR_CODES)[number];

export class PlaceException extends ApiBusinessException {
  public constructor(code: PlaceErrorCode, statusCode: number, message: string) {
    super(statusCode, code, message);
  }
}

export class PlaceProviderError extends Error {
  public constructor() {
    super('Place provider request failed');
    this.name = 'PlaceProviderError';
  }
}
