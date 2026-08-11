import { Inject, Injectable, Optional } from '@nestjs/common';

import { WechatLoginInputSchema } from '@travel-guide/shared-schemas';
import type { AuthUser, LoginResult, WechatLoginInput } from '@travel-guide/shared-types';

import { AuthException } from './auth.errors';
import { ACCESS_TOKEN_SERVICE, USER_REPOSITORY, WECHAT_PROVIDER } from './auth.tokens';
import { AUTH_ENVIRONMENT } from './config/tokens';
import { createTestAuthEnvironment, type AuthEnvironment } from './config/auth-environment';
import type { AccessTokenService } from './token/access-token.service';
import type { UserRepository } from './repositories/user.repository';
import { WechatProviderError, type WechatProvider } from './providers/wechat.provider';

@Injectable()
export class AuthService {
  public constructor(
    @Inject(WECHAT_PROVIDER) private readonly wechatProvider: WechatProvider,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(ACCESS_TOKEN_SERVICE) private readonly accessTokenService: AccessTokenService,
    @Optional()
    @Inject(AUTH_ENVIRONMENT)
    private readonly environment: AuthEnvironment = createTestAuthEnvironment(),
  ) {}

  public async login(input: WechatLoginInput): Promise<LoginResult> {
    const parsedInput = WechatLoginInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new AuthException('AUTH_CODE_INVALID', 400, 'The login code is invalid');
    }

    let session;
    try {
      session = await this.wechatProvider.exchangeCode(parsedInput.data.code);
    } catch (error: unknown) {
      if (error instanceof WechatProviderError && error.kind === 'invalid_code') {
        throw new AuthException('AUTH_CODE_INVALID', 400, 'The login code is invalid');
      }

      throw new AuthException('AUTH_PROVIDER_ERROR', 502, 'The login provider is unavailable');
    }

    if (
      !session ||
      typeof session.openid !== 'string' ||
      session.openid.trim().length === 0 ||
      session.openid.length > 255 ||
      (session.unionid !== undefined &&
        (typeof session.unionid !== 'string' || session.unionid.trim().length > 255))
    ) {
      throw new AuthException('AUTH_PROVIDER_ERROR', 502, 'The login provider is unavailable');
    }

    let user;
    try {
      user = await this.userRepository.findOrCreateByWechatIdentity({
        openid: session.openid,
        ...(session.unionid === undefined ? {} : { unionid: session.unionid }),
      });
    } catch {
      throw new AuthException('AUTH_PROVIDER_ERROR', 502, 'The login provider is unavailable');
    }

    if (user.status !== undefined && user.status !== 'active') {
      throw new AuthException('AUTH_CODE_INVALID', 401, 'The login code is invalid');
    }

    let accessToken: string;
    try {
      accessToken = await this.accessTokenService.signAccessToken(user.id);
    } catch {
      throw new AuthException('AUTH_CONFIGURATION_ERROR', 500, 'Authentication is unavailable');
    }

    const authUser: AuthUser = {
      id: user.id,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
    };

    return {
      user: authUser,
      accessToken,
      expiresIn: this.environment.jwtAccessExpiresInSeconds,
    };
  }
}
