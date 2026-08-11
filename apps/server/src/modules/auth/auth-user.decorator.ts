import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest, AuthenticatedUser } from './auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: never, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user === undefined) {
      throw new Error('Authenticated user is not available');
    }

    return request.user;
  },
);

export const CurrentUserId = createParamDecorator(
  (_data: never, context: ExecutionContext): string => CurrentUserFactory(context).userId,
);

const CurrentUserFactory = (context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (request.user === undefined) {
    throw new Error('Authenticated user is not available');
  }

  return request.user;
};
