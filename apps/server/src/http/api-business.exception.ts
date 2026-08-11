import { HttpException } from '@nestjs/common';

export class ApiBusinessException extends HttpException {
  public constructor(
    statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super({ code, message }, statusCode);
  }
}
