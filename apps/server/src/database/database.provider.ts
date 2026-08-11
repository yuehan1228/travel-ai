import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { DatabaseEnvironment } from './config/database-environment';
import { DATABASE, DATABASE_ENVIRONMENT, DATABASE_POOL } from './database.tokens';
import type { Database, DatabasePool } from './database.types';
import * as schema from './schema';

export const databasePoolProvider = {
  provide: DATABASE_POOL,
  inject: [DATABASE_ENVIRONMENT],
  useFactory: (environment: DatabaseEnvironment): DatabasePool =>
    new Pool({
      host: environment.host,
      port: environment.port,
      user: environment.user,
      password: environment.password,
      database: environment.database,
      min: environment.poolMin,
      max: environment.poolMax,
      idleTimeoutMillis: environment.idleTimeoutMs,
      connectionTimeoutMillis: environment.connectionTimeoutMs,
      ...(environment.ssl ? { ssl: true } : {}),
    }),
};

export const databaseProvider = {
  provide: DATABASE,
  inject: [DATABASE_POOL],
  useFactory: (pool: DatabasePool): Database => drizzle(pool, { schema }),
};
