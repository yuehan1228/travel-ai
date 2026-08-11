import { createApiResponseSchema } from '@travel-guide/shared-schemas';
import type { ApiResponse } from '@travel-guide/shared-types';
import type { ZodType, ZodTypeDef } from 'zod';

import {
  CURRENT_MINIAPP_CONFIG,
  isValidBaseUrl,
  type MiniAppEnvironmentConfig,
} from '../config/environment';
import { RequestError } from './request-error';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Request bodies are schema-validated before they reach the adapter. `object`
// keeps strongly typed shared input models assignable without unsafe casts.
export type RequestData = JsonValue | ArrayBuffer | object;

export interface RequestOptions<TResponse> {
  readonly path: string;
  readonly schema: ZodType<TResponse, ZodTypeDef, unknown>;
  readonly method?: HttpMethod;
  readonly data?: RequestData;
  readonly header?: Record<string, string>;
  readonly timeout?: number;
}

export interface RequestAdapterOptions {
  readonly url: string;
  readonly method: HttpMethod;
  readonly data?: RequestData;
  readonly header?: Record<string, string>;
  readonly timeout: number;
}

export interface AdapterResponse {
  readonly statusCode: number;
  readonly data: unknown;
  readonly header?: Record<string, string>;
}

export type RequestAdapter = (options: RequestAdapterOptions) => Promise<AdapterResponse>;

export interface HttpClient {
  requestRaw<TResponse>(options: RequestOptions<TResponse>): Promise<TResponse>;
  requestApi<TResponse>(options: RequestOptions<TResponse>): Promise<TResponse>;
}

interface ValidatedResponse<TResponse> {
  readonly data: TResponse;
  readonly statusCode: number;
  readonly header?: Record<string, string>;
}

const getHeader = (
  headers: Record<string, string> | undefined,
  headerName: string,
): string | undefined => {
  if (headers === undefined) {
    return undefined;
  }

  const expectedName = headerName.toLowerCase();
  const matchingEntry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === expectedName,
  );
  return matchingEntry?.[1];
};

const getResponseRequestId = (response: AdapterResponse): string | undefined => {
  const headerRequestId = getHeader(response.header, 'x-request-id');
  if (headerRequestId !== undefined && headerRequestId.trim().length > 0) {
    return headerRequestId;
  }

  if (typeof response.data !== 'object' || response.data === null || Array.isArray(response.data)) {
    return undefined;
  }

  if (!('requestId' in response.data)) {
    return undefined;
  }

  const requestId = response.data.requestId;
  return typeof requestId === 'string' && requestId.trim().length > 0 ? requestId : undefined;
};

const getFailureMessage = (failure: unknown): string => {
  if (failure instanceof Error) {
    return failure.message;
  }

  if (typeof failure === 'string') {
    return failure;
  }

  if (typeof failure === 'object' && failure !== null && 'errMsg' in failure) {
    const errorMessage = failure.errMsg;
    return typeof errorMessage === 'string' ? errorMessage : '';
  }

  return '';
};

const isTimeoutFailure = (failure: unknown): boolean => {
  const message = getFailureMessage(failure).toLowerCase();
  return message.includes('timeout') || message.includes('timed out');
};

const createInvalidConfigurationError = (message: string): RequestError =>
  new RequestError({
    code: 'INVALID_RESPONSE',
    message,
  });

const validateTimeout = (timeout: number): number => {
  if (!Number.isFinite(timeout) || !Number.isInteger(timeout) || timeout <= 0) {
    throw createInvalidConfigurationError('Invalid request timeout configuration');
  }

  return timeout;
};

export const joinBaseUrl = (baseUrl: string, path: string): string => {
  const normalizedBaseUrl = baseUrl.trim();
  if (!isValidBaseUrl(normalizedBaseUrl)) {
    throw createInvalidConfigurationError('Invalid base URL configuration');
  }

  const normalizedPath = path.trim();
  if (
    normalizedPath.length === 0 ||
    /^https?:\/\//i.test(normalizedPath) ||
    normalizedPath.replace(/^\/+/, '').length === 0
  ) {
    throw createInvalidConfigurationError('Invalid request path');
  }

  return `${normalizedBaseUrl.replace(/\/+$/, '')}/${normalizedPath.replace(/^\/+/, '')}`;
};

const withTimeout = async <TResult>(
  promise: Promise<TResult>,
  timeout: number,
): Promise<TResult> => {
  const timeoutError = new RequestError({
    code: 'REQUEST_TIMEOUT',
    message: 'Request timed out',
  });

  return new Promise<TResult>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError), timeout);

    void promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (failure: unknown) => {
        clearTimeout(timer);
        reject(failure);
      },
    );
  });
};

const isSuccessfulStatus = (statusCode: number): boolean => statusCode >= 200 && statusCode <= 299;

const invokeAdapter = async (
  adapter: RequestAdapter,
  options: RequestAdapterOptions,
): Promise<AdapterResponse> => {
  try {
    return await adapter(options);
  } catch (failure: unknown) {
    if (failure instanceof RequestError) {
      throw failure;
    }

    if (isTimeoutFailure(failure)) {
      throw new RequestError({
        code: 'REQUEST_TIMEOUT',
        message: 'Request timed out',
        cause: failure,
      });
    }

    throw new RequestError({
      code: 'NETWORK_ERROR',
      message: 'Network request failed',
      cause: failure,
    });
  }
};

const createValidatedResponse = <TResponse>(
  response: AdapterResponse,
  schema: ZodType<TResponse, ZodTypeDef, unknown>,
  allowApiFailure = false,
): ValidatedResponse<TResponse> => {
  const requestId = getResponseRequestId(response);

  if (!isSuccessfulStatus(response.statusCode) && !allowApiFailure) {
    throw new RequestError({
      code: 'HTTP_ERROR',
      message: 'HTTP request failed',
      httpStatus: response.statusCode,
      requestId,
    });
  }

  const parsed = schema.safeParse(response.data);
  if (!parsed.success) {
    if (!isSuccessfulStatus(response.statusCode)) {
      throw new RequestError({
        code: 'HTTP_ERROR',
        message: 'HTTP request failed',
        httpStatus: response.statusCode,
        requestId,
      });
    }

    throw new RequestError({
      code: 'INVALID_RESPONSE',
      message: 'Response did not match the expected schema',
      httpStatus: response.statusCode,
      requestId,
      cause: parsed.error,
    });
  }

  return {
    data: parsed.data,
    statusCode: response.statusCode,
    header: response.header,
  };
};

export const createWxRequestAdapter =
  (request: WxRequestFunction): RequestAdapter =>
  (options: RequestAdapterOptions) =>
    new Promise<AdapterResponse>((resolve, reject) => {
      try {
        request({
          url: options.url,
          method: options.method,
          data: options.data,
          header: options.header,
          timeout: options.timeout,
          success: (response) => {
            resolve({
              statusCode: response.statusCode,
              data: response.data,
              header: response.header,
            });
          },
          fail: (failure) => reject(failure),
        });
      } catch (failure: unknown) {
        reject(failure);
      }
    });

export const wxRequestAdapter: RequestAdapter = createWxRequestAdapter((options) =>
  wx.request(options),
);

export const createHttpClient = (
  config: MiniAppEnvironmentConfig = CURRENT_MINIAPP_CONFIG,
  adapter: RequestAdapter = wxRequestAdapter,
): HttpClient => {
  if (!isValidBaseUrl(config.baseUrl)) {
    throw createInvalidConfigurationError('Invalid base URL configuration');
  }

  const defaultTimeout = validateTimeout(config.requestTimeout);

  const requestValidated = async <TResponse>(
    options: Omit<RequestOptions<TResponse>, 'schema'>,
    schema: ZodType<TResponse, ZodTypeDef, unknown>,
    allowApiFailure = false,
  ): Promise<ValidatedResponse<TResponse>> => {
    const requestOptions: RequestAdapterOptions = {
      url: joinBaseUrl(config.baseUrl, options.path),
      method: options.method ?? 'GET',
      data: options.data,
      header: options.header,
      timeout: validateTimeout(options.timeout ?? defaultTimeout),
    };

    let response: AdapterResponse;
    try {
      response = await withTimeout(invokeAdapter(adapter, requestOptions), requestOptions.timeout);
    } catch (failure: unknown) {
      if (failure instanceof RequestError) {
        throw failure;
      }

      if (isTimeoutFailure(failure)) {
        throw new RequestError({
          code: 'REQUEST_TIMEOUT',
          message: 'Request timed out',
          cause: failure,
        });
      }

      throw new RequestError({
        code: 'NETWORK_ERROR',
        message: 'Network request failed',
        cause: failure,
      });
    }

    return createValidatedResponse(response, schema, allowApiFailure);
  };

  return {
    async requestRaw<TResponse>(options: RequestOptions<TResponse>): Promise<TResponse> {
      const response = await requestValidated(options, options.schema);
      return response.data;
    },

    async requestApi<TResponse>(options: RequestOptions<TResponse>): Promise<TResponse> {
      const responseSchema = createApiResponseSchema<TResponse>(options.schema);
      const response = await requestValidated<ApiResponse<TResponse>>(
        options,
        responseSchema,
        true,
      );

      if (!response.data.success) {
        throw new RequestError({
          code: 'API_ERROR',
          message: response.data.error.message,
          requestId: response.data.requestId,
          httpStatus: response.statusCode,
          apiCode: response.data.error.code,
          cause: response.data.error,
        });
      }

      return response.data.data;
    },
  };
};

export const defaultHttpClient = createHttpClient(CURRENT_MINIAPP_CONFIG);

export const requestRaw = <TResponse>(
  options: RequestOptions<TResponse>,
  client: HttpClient = defaultHttpClient,
): Promise<TResponse> => client.requestRaw(options);

export const requestApi = <TResponse>(
  options: RequestOptions<TResponse>,
  client: HttpClient = defaultHttpClient,
): Promise<TResponse> => client.requestApi(options);
