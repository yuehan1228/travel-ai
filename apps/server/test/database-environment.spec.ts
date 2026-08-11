import { describe, expect, it } from 'vitest';

import { loadDatabaseEnvironment } from '../src/database/config/database-environment';

const validEnvironment: NodeJS.ProcessEnv = {
  POSTGRES_HOST: 'db.example.test',
  POSTGRES_PORT: '5433',
  POSTGRES_USER: 'travel_user',
  POSTGRES_PASSWORD: 'test-password',
  POSTGRES_DB: 'travel_db',
  POSTGRES_SSL: 'true',
  POSTGRES_POOL_MIN: '2',
  POSTGRES_POOL_MAX: '12',
  POSTGRES_IDLE_TIMEOUT_MS: '12000',
  POSTGRES_CONNECTION_TIMEOUT_MS: '6000',
};

describe('loadDatabaseEnvironment', () => {
  it('loads a valid database configuration', () => {
    expect(loadDatabaseEnvironment(validEnvironment)).toEqual({
      host: 'db.example.test',
      port: 5433,
      user: 'travel_user',
      password: 'test-password',
      database: 'travel_db',
      ssl: true,
      poolMin: 2,
      poolMax: 12,
      idleTimeoutMs: 12000,
      connectionTimeoutMs: 6000,
    });
  });

  it('uses safe local defaults', () => {
    expect(loadDatabaseEnvironment({})).toEqual({
      host: 'localhost',
      port: 5432,
      user: 'travel_guide',
      password: 'replace-with-a-local-password',
      database: 'travel_guide',
      ssl: false,
      poolMin: 0,
      poolMax: 10,
      idleTimeoutMs: 10000,
      connectionTimeoutMs: 5000,
    });
  });

  it.each([
    ['an invalid port', { POSTGRES_PORT: '65536' }],
    ['an empty host', { POSTGRES_HOST: '' }],
    ['an empty user', { POSTGRES_USER: '' }],
    ['an empty password', { POSTGRES_PASSWORD: '' }],
    ['an empty database name', { POSTGRES_DB: '' }],
    ['an invalid pool range', { POSTGRES_POOL_MIN: '11', POSTGRES_POOL_MAX: '10' }],
    ['an invalid SSL value', { POSTGRES_SSL: 'yes' }],
  ])('rejects %s', (_description, overrides) => {
    expect(() => loadDatabaseEnvironment({ ...validEnvironment, ...overrides })).toThrow(
      'Invalid database environment configuration',
    );
  });

  it('does not echo a password in validation errors', () => {
    const password = 'do-not-leak-this-password';

    expect(() =>
      loadDatabaseEnvironment({
        ...validEnvironment,
        POSTGRES_PASSWORD: password,
        POSTGRES_PORT: '0',
      }),
    ).toThrowError(expect.not.stringContaining(password));
  });
});
