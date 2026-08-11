import { DynamicModule, Global, Module } from '@nestjs/common';

import {
  loadDatabaseEnvironment,
  type DatabaseEnvironment,
} from '../../database/config/database-environment';
import { DatabaseModule } from '../../database/database.module';

import type { AuthEnvironment } from './config/auth-environment';
import { AUTH_ENVIRONMENT } from './config/tokens';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ACCESS_TOKEN_SERVICE, USER_REPOSITORY, WECHAT_PROVIDER } from './auth.tokens';
import { DrizzleUserRepository, type UserRepository } from './repositories/user.repository';
import { WechatCode2SessionProvider, type WechatProvider } from './providers/wechat.provider';
import { JwtAccessTokenService } from './token/access-token.service';

export interface AuthModuleOptions {
  readonly wechatProvider?: WechatProvider;
  readonly userRepository?: UserRepository;
  readonly databaseEnvironment?: DatabaseEnvironment;
}

@Global()
@Module({})
export class AuthModule {
  public static register(
    environment: AuthEnvironment,
    options: AuthModuleOptions = {},
  ): DynamicModule {
    const wechatProvider = options.wechatProvider
      ? { provide: WECHAT_PROVIDER, useValue: options.wechatProvider }
      : {
          provide: WECHAT_PROVIDER,
          inject: [AUTH_ENVIRONMENT],
          useFactory: (authEnvironment: AuthEnvironment): WechatProvider =>
            new WechatCode2SessionProvider(authEnvironment),
        };
    const userRepository = options.userRepository
      ? { provide: USER_REPOSITORY, useValue: options.userRepository }
      : { provide: USER_REPOSITORY, useClass: DrizzleUserRepository };

    return {
      module: AuthModule,
      imports: [DatabaseModule.register(options.databaseEnvironment ?? loadDatabaseEnvironment())],
      controllers: [AuthController],
      providers: [
        { provide: AUTH_ENVIRONMENT, useValue: environment },
        wechatProvider,
        userRepository,
        JwtAccessTokenService,
        { provide: ACCESS_TOKEN_SERVICE, useExisting: JwtAccessTokenService },
        AuthService,
        AuthGuard,
      ],
      exports: [AuthService, AuthGuard, ACCESS_TOKEN_SERVICE, AUTH_ENVIRONMENT],
    };
  }
}

export { AUTH_ENVIRONMENT } from './config/tokens';
export { ACCESS_TOKEN_SERVICE, USER_REPOSITORY, WECHAT_PROVIDER } from './auth.tokens';
