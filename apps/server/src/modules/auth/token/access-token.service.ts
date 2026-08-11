import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';

import type { AuthEnvironment } from '../config/auth-environment';
import { AUTH_ENVIRONMENT } from '../config/tokens';
import { AccessTokenVerificationError } from '../auth.errors';

export interface AccessTokenClaims {
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly iss: string;
  readonly aud: string;
  readonly jti: string;
}

export interface AccessTokenService {
  signAccessToken(userId: string): Promise<string>;
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;
}

export const ACCESS_TOKEN_ISSUER = 'travel-guide-api';
export const ACCESS_TOKEN_AUDIENCE = 'travel-guide-miniapp';

@Injectable()
export class JwtAccessTokenService implements AccessTokenService {
  private readonly secret: Uint8Array;

  public constructor(@Inject(AUTH_ENVIRONMENT) private readonly environment: AuthEnvironment) {
    this.secret = new TextEncoder().encode(environment.jwtAccessSecret);
  }

  public signAccessToken(userId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    const expiresAt = now + this.environment.jwtAccessExpiresInSeconds;

    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setJti(randomUUID())
      .sign(this.secret);
  }

  public async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    if (token.trim().length === 0) {
      throw new AccessTokenVerificationError();
    }

    try {
      const result = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
      });
      const payload = result.payload;

      if (
        typeof payload.sub !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' ||
        typeof payload.iss !== 'string' ||
        payload.iss !== ACCESS_TOKEN_ISSUER ||
        typeof payload.aud !== 'string' ||
        payload.aud !== ACCESS_TOKEN_AUDIENCE ||
        typeof payload.jti !== 'string'
      ) {
        throw new AccessTokenVerificationError();
      }

      return {
        sub: payload.sub,
        iat: payload.iat,
        exp: payload.exp,
        iss: payload.iss,
        aud: payload.aud,
        jti: payload.jti,
      };
    } catch (error: unknown) {
      if (error instanceof AccessTokenVerificationError) {
        throw error;
      }

      throw new AccessTokenVerificationError();
    }
  }
}
