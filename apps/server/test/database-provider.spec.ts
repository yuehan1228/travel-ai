import { describe, expect, it } from 'vitest';

import { loadDatabaseEnvironment } from '../src/database/config/database-environment';
import { databasePoolProvider, databaseProvider } from '../src/database/database.provider';

describe('database providers', () => {
  it('creates a pg pool without opening a database connection', async () => {
    const pool = databasePoolProvider.useFactory(loadDatabaseEnvironment({}));

    expect(pool.totalCount).toBe(0);
    expect(pool.idleCount).toBe(0);
    expect(pool.waitingCount).toBe(0);

    await pool.end();
  });

  it('creates a typed Drizzle instance around the injected pool', async () => {
    const pool = databasePoolProvider.useFactory(loadDatabaseEnvironment({}));
    const database = databaseProvider.useFactory(pool);

    expect(database).toBeDefined();

    await pool.end();
  });
});
