import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';

import { createTestAuthEnvironment } from '../src/modules/auth/config/auth-environment';
import { AccessTokenVerificationError } from '../src/modules/auth/auth.errors';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  JwtAccessTokenService,
} from '../src/modules/auth/token/access-token.service';

describe('JwtAccessTokenService', () => {
  it('signs and verifies application claims', async () => {
    const service = new JwtAccessTokenService(createTestAuthEnvironment());
    const token = await service.signAccessToken('123e4567-e89b-12d3-a456-426614174000');
    const claims = await service.verifyAccessToken(token);

    expect(claims.sub).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(claims.iss).toBe(ACCESS_TOKEN_ISSUER);
    expect(claims.aud).toBe(ACCESS_TOKEN_AUDIENCE);
    expect(typeof claims.jti).toBe('string');
    expect(claims.exp).toBeGreaterThan(claims.iat);
    expect(token).not.toContain('openid');
  });

  it('rejects malformed, expired, and wrong issuer/audience tokens', async () => {
    const environment = createTestAuthEnvironment();
    const service = new JwtAccessTokenService(environment);
    const secret = new TextEncoder().encode(environment.jwtAccessSecret);
    const now = Math.floor(Date.now() / 1_000);

    await expect(service.verifyAccessToken('not-a-jwt')).rejects.toBeInstanceOf(
      AccessTokenVerificationError,
    );
    const expiredToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('123e4567-e89b-12d3-a456-426614174000')
      .setIssuedAt(now - 100)
      .setExpirationTime(now - 1)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setJti('expired-token')
      .sign(secret);
    await expect(service.verifyAccessToken(expiredToken)).rejects.toBeInstanceOf(
      AccessTokenVerificationError,
    );

    const wrongIssuer = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('123e4567-e89b-12d3-a456-426614174000')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setIssuer('wrong-issuer')
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setJti('wrong-issuer-token')
      .sign(secret);
    await expect(service.verifyAccessToken(wrongIssuer)).rejects.toBeInstanceOf(
      AccessTokenVerificationError,
    );

    const wrongAudience = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('123e4567-e89b-12d3-a456-426614174000')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience('wrong-audience')
      .setJti('wrong-audience-token')
      .sign(secret);
    await expect(service.verifyAccessToken(wrongAudience)).rejects.toBeInstanceOf(
      AccessTokenVerificationError,
    );
  });
});
