import { describe, expect, it } from 'vitest';

import { HealthResponseSchema } from '../src';

describe('HealthResponseSchema', () => {
  it('continues to validate the TASK-001 health response', () => {
    expect(
      HealthResponseSchema.safeParse({
        status: 'ok',
        environment: 'test',
        timestamp: '2026-08-10T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
