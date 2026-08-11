import { ApiBusinessException } from '../../http/api-business.exception';

export const TRIP_ERROR_CODES = [
  'TRIP_VALIDATION_ERROR',
  'TRIP_NOT_FOUND',
  'TRIP_PERSISTENCE_ERROR',
] as const;

export type TripErrorCode = (typeof TRIP_ERROR_CODES)[number];

export class TripException extends ApiBusinessException {
  public constructor(code: TripErrorCode, statusCode: number, message: string) {
    super(statusCode, code, message);
  }
}
