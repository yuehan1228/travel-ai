import { DynamicModule, Module } from '@nestjs/common';

import {
  loadDatabaseEnvironment,
  type DatabaseEnvironment,
} from '../../database/config/database-environment';
import { DatabaseModule } from '../../database/database.module';
import { TripsController } from './trips.controller';
import { TripService } from './trip.service';
import { TRIP_REPOSITORY } from './trip.tokens';
import { DrizzleTripRepository, type TripRepository } from './repositories/trip.repository';

export interface TripModuleOptions {
  readonly tripRepository?: TripRepository;
  readonly databaseEnvironment?: DatabaseEnvironment;
}

@Module({})
export class TripModule {
  public static register(options: TripModuleOptions = {}): DynamicModule {
    const repositoryProvider = options.tripRepository
      ? { provide: TRIP_REPOSITORY, useValue: options.tripRepository }
      : { provide: TRIP_REPOSITORY, useClass: DrizzleTripRepository };

    return {
      module: TripModule,
      imports: options.tripRepository
        ? []
        : [DatabaseModule.register(options.databaseEnvironment ?? loadDatabaseEnvironment())],
      controllers: [TripsController],
      providers: [repositoryProvider, TripService],
      exports: [TripService, TRIP_REPOSITORY],
    };
  }
}

export { TRIP_REPOSITORY } from './trip.tokens';
export { TripException, TRIP_ERROR_CODES, type TripErrorCode } from './trip.errors';
export { TripService } from './trip.service';
export type { TripRecord, TripRepository } from './repositories/trip.repository';
