import { DynamicModule, Module } from '@nestjs/common';

import { loadDatabaseEnvironment, type DatabaseEnvironment } from './config/database-environment';
import { DatabaseLifecycleService } from './database-lifecycle.service';
import { DATABASE, DATABASE_ENVIRONMENT, DATABASE_POOL } from './database.tokens';
import { databasePoolProvider, databaseProvider } from './database.provider';

@Module({})
export class DatabaseModule {
  public static register(
    environment: DatabaseEnvironment = loadDatabaseEnvironment(),
  ): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE_ENVIRONMENT,
          useValue: environment,
        },
        databasePoolProvider,
        databaseProvider,
        DatabaseLifecycleService,
      ],
      exports: [DATABASE, DATABASE_POOL, DATABASE_ENVIRONMENT],
    };
  }
}
