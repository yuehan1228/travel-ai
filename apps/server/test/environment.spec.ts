import { describe, expect, it } from 'vitest';

import { loadEnvironment } from '../src/config/environment';

describe('loadEnvironment', () => {
  it('loads supported values', () => {
    expect(loadEnvironment({ NODE_ENV: 'test', PORT: '4321' })).toEqual({
      nodeEnv: 'test',
      port: 4321,
    });
  });

  it('uses documented defaults', () => {
    expect(loadEnvironment({})).toEqual({
      nodeEnv: 'development',
      port: 3000,
    });
  });

  it('rejects an unsupported environment without echoing values', () => {
    const secret = 'do-not-print-this-secret';

    expect(() => loadEnvironment({ NODE_ENV: secret })).toThrow(
      'Invalid environment configuration',
    );
    expect(() => loadEnvironment({ NODE_ENV: secret })).toThrowError(
      expect.not.stringContaining(secret),
    );
  });

  it('rejects ports outside the TCP range', () => {
    expect(() => loadEnvironment({ PORT: '0' })).toThrow('Invalid environment configuration');
    expect(() => loadEnvironment({ PORT: '65536' })).toThrow('Invalid environment configuration');
    expect(() => loadEnvironment({ PORT: 'not-a-port' })).toThrow(
      'Invalid environment configuration',
    );
  });
});
