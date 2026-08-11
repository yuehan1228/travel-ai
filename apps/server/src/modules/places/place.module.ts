import { DynamicModule, Module } from '@nestjs/common';

import {
  loadDatabaseEnvironment,
  type DatabaseEnvironment,
} from '../../database/config/database-environment';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import {
  createTestPlaceEnvironment,
  loadPlaceEnvironment,
  type PlaceEnvironment,
} from './config/place-environment';
import { PLACE_ENVIRONMENT } from './config/tokens';
import { AmapPlaceProvider } from './providers';
import type { PlaceProvider } from './providers/place.provider';
import { DrizzlePlaceRepository, type PlaceRepository } from './repositories/place.repository';
import { PLACE_CLOCK, PLACE_PROVIDER, PLACE_REPOSITORY } from './place.tokens';
import { systemPlaceClock, type PlaceClock } from './place.clock';
import { PlaceService } from './place.service';
import { PlacesController } from './places.controller';

export interface PlaceModuleOptions {
  readonly placeEnvironment?: PlaceEnvironment;
  readonly placeProvider?: PlaceProvider;
  readonly placeRepository?: PlaceRepository;
  readonly placeClock?: PlaceClock;
  readonly databaseEnvironment?: DatabaseEnvironment;
}

@Module({})
export class PlaceModule {
  public static register(options: PlaceModuleOptions = {}): DynamicModule {
    const environment =
      options.placeEnvironment ??
      (options.placeProvider !== undefined ? createTestPlaceEnvironment() : loadPlaceEnvironment());
    const provider = options.placeProvider
      ? { provide: PLACE_PROVIDER, useValue: options.placeProvider }
      : {
          provide: PLACE_PROVIDER,
          inject: [PLACE_ENVIRONMENT],
          useFactory: (placeEnvironment: PlaceEnvironment): PlaceProvider =>
            new AmapPlaceProvider(placeEnvironment),
        };
    const repository = options.placeRepository
      ? { provide: PLACE_REPOSITORY, useValue: options.placeRepository }
      : { provide: PLACE_REPOSITORY, useClass: DrizzlePlaceRepository };

    return {
      module: PlaceModule,
      imports: options.placeRepository
        ? [AuthModule]
        : [
            AuthModule,
            DatabaseModule.register(options.databaseEnvironment ?? loadDatabaseEnvironment()),
          ],
      controllers: [PlacesController],
      providers: [
        { provide: PLACE_ENVIRONMENT, useValue: environment },
        provider,
        repository,
        { provide: PLACE_CLOCK, useValue: options.placeClock ?? systemPlaceClock },
        PlaceService,
      ],
      exports: [PlaceService, PLACE_PROVIDER, PLACE_REPOSITORY],
    };
  }
}

export { PLACE_ENVIRONMENT } from './config/tokens';
export {
  PLACE_CLOCK,
  PLACE_PROVIDER,
  PLACE_PROVIDER_TOKEN,
  PLACE_REPOSITORY,
  PLACE_REPOSITORY_TOKEN,
} from './place.tokens';
export { PlaceException, PLACE_ERROR_CODES, type PlaceErrorCode } from './place.errors';
export { PlaceService } from './place.service';
export type { PlaceClock } from './place.clock';
export type { PlaceRepository } from './repositories/place.repository';
export type {
  NormalizedPlaceSearch,
  PlaceProviderInput,
  PlaceProvider,
  PlaceProviderResult,
  ProviderPlace,
} from './providers/place.provider';
export { ProviderPlaceSchema } from './providers/place.provider';
export { createPlaceCacheKey } from './place-cache-key';
