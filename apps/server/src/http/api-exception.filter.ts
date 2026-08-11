import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiFailureSchema } from '@travel-guide/shared-schemas';

import {
  createRequestId,
  ensureRequestId,
  getRequestId,
  setRequestId,
  setSecurityHeaders,
} from './request-context';
import { ApiBusinessException } from './api-business.exception';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    if (reply.sent) {
      return;
    }

    const requestId = this.resolveRequestId(request, reply);
    const { statusCode, code, message } = this.classify(exception);

    if (code === 'INTERNAL_ERROR') {
      this.logger.error(
        JSON.stringify({
          event: 'http.unexpected_error',
          requestId,
          errorType: this.getErrorType(exception),
        }),
      );
    }

    const failure = ApiFailureSchema.parse({
      success: false,
      error: { code, message },
      requestId,
    });

    setSecurityHeaders(reply);
    reply.code(statusCode).send(failure);
  }

  private resolveRequestId(request: FastifyRequest, reply: FastifyReply): string {
    const currentRequestId = getRequestId(request);
    if (currentRequestId !== undefined) {
      reply.header('x-request-id', currentRequestId);
      return currentRequestId;
    }

    if (request.headers['x-request-id'] !== undefined) {
      return ensureRequestId(request, reply);
    }

    const requestId = createRequestId();
    setRequestId(request, requestId);
    reply.header('x-request-id', requestId);
    return requestId;
  }

  private classify(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
  } {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      };
    }

    if (exception instanceof ApiBusinessException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
      };
    }

    const statusCode = exception.getStatus();
    if (statusCode === 404) {
      return {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'The requested resource was not found',
      };
    }

    if (statusCode >= 500) {
      return {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      };
    }

    return {
      statusCode,
      code: 'VALIDATION_ERROR',
      message: 'The request could not be processed',
    };
  }

  private getErrorType(exception: unknown): string {
    const errorType = exception instanceof Error ? exception.name : typeof exception;
    return errorType.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'Error';
  }
}
