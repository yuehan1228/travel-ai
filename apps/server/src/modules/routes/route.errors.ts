import { ApiBusinessException } from '../../http/api-business.exception';

export const ROUTE_ERROR_CODES = [
  'ROUTE_VALIDATION_ERROR',
  'ROUTE_PROVIDER_ERROR',
  'ROUTE_PERSISTENCE_ERROR',
  'ROUTE_UNAVAILABLE',
] as const;

export type RouteErrorCode = (typeof ROUTE_ERROR_CODES)[number];

export class RouteException extends ApiBusinessException {
  public constructor(code: RouteErrorCode, statusCode: number, message: string) {
    super(statusCode, code, message);
  }
}

export class RouteProviderError extends Error {
  public constructor() {
    super('Route provider request failed');
    this.name = 'RouteProviderError';
  }
}
