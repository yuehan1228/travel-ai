export const REQUEST_ERROR_CODES = [
  'NETWORK_ERROR',
  'REQUEST_TIMEOUT',
  'HTTP_ERROR',
  'INVALID_RESPONSE',
  'API_ERROR',
  'AUTH_TOKEN_INVALID',
] as const;

export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[number];

export interface RequestErrorOptions {
  readonly code: RequestErrorCode;
  readonly message: string;
  readonly httpStatus?: number;
  readonly requestId?: string;
  readonly apiCode?: string;
  readonly cause?: unknown;
}

export class RequestError extends Error {
  public readonly code: RequestErrorCode;
  public readonly httpStatus?: number;
  public readonly requestId?: string;
  public readonly apiCode?: string;
  public readonly cause?: unknown;

  public constructor(options: RequestErrorOptions) {
    super(options.message);
    this.name = 'RequestError';
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.requestId = options.requestId;
    this.apiCode = options.apiCode;
    this.cause = options.cause;
  }
}

const USER_FACING_MESSAGES: Record<RequestErrorCode, string> = {
  NETWORK_ERROR: '暂时无法连接服务，请稍后重试。',
  REQUEST_TIMEOUT: '服务响应超时，请稍后重试。',
  HTTP_ERROR: '服务暂时不可用，请稍后重试。',
  INVALID_RESPONSE: '服务返回了无法识别的数据，请稍后重试。',
  API_ERROR: '服务未能完成请求，请稍后重试。',
  AUTH_TOKEN_INVALID: '登录状态已失效，请重新登录。',
};

export const getRequestUserMessage = (error: unknown): string => {
  if (error instanceof RequestError) {
    return USER_FACING_MESSAGES[error.code];
  }

  return '服务暂时不可用，请稍后重试。';
};

export const getAuthUserMessage = (error: unknown): string => {
  if (error instanceof RequestError) {
    if (error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_TIMEOUT') {
      return '登录服务暂时不可用，请稍后重试。';
    }

    return '登录失败，请稍后重试。';
  }

  return '登录失败，请稍后重试。';
};

export const createRequestError = (options: RequestErrorOptions): RequestError =>
  new RequestError(options);
