import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ApiSuccess, LoginResult } from '@travel-guide/shared-types';

import { WechatLoginInputSchema } from '@travel-guide/shared-schemas';

import { AuthException } from './auth.errors';
import { AuthService } from './auth.service';
import { getRequestId } from '../../http/request-context';

@Controller('auth')
export class AuthController {
  public constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  public async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ApiSuccess<LoginResult>> {
    // TODO(TASK-007): attach a bounded rate-limit hook for repeated login attempts.
    const parsed = WechatLoginInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new AuthException('AUTH_CODE_INVALID', 400, 'The login code is invalid');
    }

    const data: LoginResult = await this.authService.login(parsed.data);
    const requestId = getRequestId(request) ?? request.id;

    return {
      success: true,
      data,
      requestId,
    };
  }
}
