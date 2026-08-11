import { ApiBusinessException } from '../../http/api-business.exception';

export const AUTH_ERROR_CODES = [
  'AUTH_CODE_INVALID',
  'AUTH_PROVIDER_ERROR',
  'AUTH_TOKEN_INVALID',
  'AUTH_CONFIGURATION_ERROR',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export class AuthException extends ApiBusinessException {
  public constructor(code: AuthErrorCode, statusCode: number, message: string) {
    super(statusCode, code, message);
  }
}

export class AccessTokenVerificationError extends Error {
  public constructor() {
    super('Access token verification failed');
    this.name = 'AccessTokenVerificationError';
  }
}
