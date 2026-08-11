import { describe, expect, it } from 'vitest';

import { isValidRequestId, resolveRequestId } from '../src/http/request-context';

describe('request ID validation', () => {
  it('accepts a printable request ID within the limit', () => {
    expect(isValidRequestId('client-request-123')).toBe(true);
  });

  it('rejects control characters and oversized values', () => {
    expect(isValidRequestId('client\nrequest')).toBe(false);
    expect(isValidRequestId('client-request\n')).toBe(false);
    expect(isValidRequestId('a'.repeat(129))).toBe(false);
  });

  it('generates a value for an invalid header', () => {
    const requestId = resolveRequestId('client\u0000request');

    expect(requestId).not.toBe('client\u0000request');
    expect(isValidRequestId(requestId)).toBe(true);
  });
});
