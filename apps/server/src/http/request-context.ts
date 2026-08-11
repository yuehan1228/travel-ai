import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_BYTES = 128;

const requestIds = new WeakMap<object, string>();
const requestStartTimes = new WeakMap<object, bigint>();

interface HookRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  url: string;
}

interface HookReply {
  statusCode: number;
  header(name: string, value: string): HookReply;
}

interface HookInstance {
  addHook(
    name: 'onRequest' | 'onResponse',
    hook: (request: HookRequest, reply: HookReply, done: () => void) => void,
  ): HookInstance;
}

interface HeaderRequest {
  headers: Record<string, string | string[] | undefined>;
}

interface HeaderReply {
  header(name: string, value: string): HeaderReply;
}

export const createRequestId = (): string => randomUUID();

export function getRequestId(request: object): string | undefined {
  return requestIds.get(request);
}

export function isValidRequestId(value: string | string[] | undefined): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 0x20 || codePoint === 0x7f) {
      return false;
    }
  }

  const normalized = value.trim();
  if (normalized.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_REQUEST_ID_BYTES) {
    return false;
  }

  return true;
}

export function resolveRequestId(value: string | string[] | undefined): string {
  return isValidRequestId(value) ? value.trim() : createRequestId();
}

export function setRequestId(request: object, requestId: string): void {
  requestIds.set(request, requestId);
}

export function setSecurityHeaders(reply: HeaderReply): void {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('x-frame-options', 'DENY');
  reply.header('referrer-policy', 'no-referrer');
}

export function ensureRequestId(request: HeaderRequest, reply: HeaderReply): string {
  const requestId = getRequestId(request) ?? resolveRequestId(request.headers[REQUEST_ID_HEADER]);
  setRequestId(request, requestId);
  reply.header(REQUEST_ID_HEADER, requestId);
  setSecurityHeaders(reply);
  return requestId;
}

export function registerRequestContext(instance: HookInstance, logger: Logger): void {
  instance.addHook('onRequest', (request, reply, done) => {
    requestStartTimes.set(request, process.hrtime.bigint());
    ensureRequestId(request, reply);
    done();
  });

  instance.addHook('onResponse', (request, reply, done) => {
    const requestId = getRequestId(request) ?? 'unavailable';
    const startTime = requestStartTimes.get(request);
    const latencyMs =
      startTime === undefined ? undefined : Number(process.hrtime.bigint() - startTime) / 1_000_000;
    const path = request.url.split('?')[0] || '/';
    const event = JSON.stringify({
      event: 'http.request',
      requestId,
      method: request.method,
      path,
      status: reply.statusCode,
      ...(latencyMs === undefined ? {} : { latencyMs: Number(latencyMs.toFixed(3)) }),
    });

    if (path === '/health') {
      logger.debug(event);
    } else {
      logger.log(event);
    }

    done();
  });
}
