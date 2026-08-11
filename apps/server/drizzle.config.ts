import { defineConfig } from 'drizzle-kit';

import { loadDatabaseEnvironment } from './src/database/config/database-environment';

const databaseEnvironment = loadDatabaseEnvironment();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    host: databaseEnvironment.host,
    port: databaseEnvironment.port,
    user: databaseEnvironment.user,
    password: databaseEnvironment.password,
    database: databaseEnvironment.database,
    ssl: databaseEnvironment.ssl,
  },
});
