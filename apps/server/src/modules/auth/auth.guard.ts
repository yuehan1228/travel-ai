import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AuthException } from './auth.errors';
import { ACCESS_TOKEN_SERVICE } from './auth.tokens';
import type { AccessTokenService } from './token/access-token.service';

export interface AuthenticatedRequest extends FastifyRequest {
  user?: AuthenticatedUser;
}

export interface AuthenticatedUser {
  readonly userId: string;
}

const getBearerToken = (authorization: string | string[] | undefined): string | undefined => {
  if (typeof authorization !== 'string') {
    return undefined;
  }

  const match = /^Bearer[ \t]+([^ \t]+)[ \t]*$/i.exec(authorization);
  return match?.[1];
};

@Injectable()
export class AuthGuard implements CanActivate {
  public constructor(
    @Inject(ACCESS_TOKEN_SERVICE) private readonly tokenService: AccessTokenService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = getBearerToken(request.headers.authorization);
    if (token === undefined) {
      throw new AuthException('AUTH_TOKEN_INVALID', 401, 'The access token is invalid');
    }

    try {
      const claims = await this.tokenService.verifyAccessToken(token);
      request.user = { userId: claims.sub };
      return true;
    } catch {
      throw new AuthException('AUTH_TOKEN_INVALID', 401, 'The access token is invalid');
    }
  }
}

export { getBearerToken };
