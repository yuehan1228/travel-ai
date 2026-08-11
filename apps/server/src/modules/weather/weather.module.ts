import { DynamicModule, Module } from '@nestjs/common';

import {
  loadDatabaseEnvironment,
  type DatabaseEnvironment,
} from '../../database/config/database-environment';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { loadWeatherEnvironment, type WeatherEnvironment } from './config/weather-environment';
import { WEATHER_ENVIRONMENT } from './config/tokens';
import { AmapWeatherProvider, UnavailableClimateReferenceProvider } from './providers';
import type { ClimateReferenceProvider, WeatherProvider } from './providers/weather.provider';
import {
  DrizzleWeatherCacheRepository,
  type WeatherCacheRepository,
} from './repositories/weather-cache.repository';
import {
  CLIMATE_REFERENCE_PROVIDER,
  WEATHER_CACHE_REPOSITORY,
  WEATHER_CLOCK,
  WEATHER_PROVIDER,
} from './weather.tokens';
import { systemWeatherClock, type WeatherClock } from './weather.clock';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';

export interface WeatherModuleOptions {
  readonly weatherEnvironment?: WeatherEnvironment;
  readonly weatherProvider?: WeatherProvider;
  readonly climateReferenceProvider?: ClimateReferenceProvider;
  readonly weatherCacheRepository?: WeatherCacheRepository;
  readonly weatherClock?: WeatherClock;
  readonly databaseEnvironment?: DatabaseEnvironment;
}

@Module({})
export class WeatherModule {
  public static register(options: WeatherModuleOptions = {}): DynamicModule {
    const environment = options.weatherEnvironment ?? loadWeatherEnvironment();
    const provider = options.weatherProvider
      ? { provide: WEATHER_PROVIDER, useValue: options.weatherProvider }
      : {
          provide: WEATHER_PROVIDER,
          inject: [WEATHER_ENVIRONMENT],
          useFactory: (weatherEnvironment: WeatherEnvironment): WeatherProvider =>
            new AmapWeatherProvider(weatherEnvironment),
        };
    const climateProvider = options.climateReferenceProvider
      ? { provide: CLIMATE_REFERENCE_PROVIDER, useValue: options.climateReferenceProvider }
      : { provide: CLIMATE_REFERENCE_PROVIDER, useClass: UnavailableClimateReferenceProvider };
    const cacheRepository = options.weatherCacheRepository
      ? { provide: WEATHER_CACHE_REPOSITORY, useValue: options.weatherCacheRepository }
      : { provide: WEATHER_CACHE_REPOSITORY, useClass: DrizzleWeatherCacheRepository };

    return {
      module: WeatherModule,
      imports: options.weatherCacheRepository
        ? [AuthModule]
        : [
            AuthModule,
            DatabaseModule.register(options.databaseEnvironment ?? loadDatabaseEnvironment()),
          ],
      controllers: [WeatherController],
      providers: [
        { provide: WEATHER_ENVIRONMENT, useValue: environment },
        provider,
        climateProvider,
        cacheRepository,
        { provide: WEATHER_CLOCK, useValue: options.weatherClock ?? systemWeatherClock },
        WeatherService,
      ],
      exports: [WeatherService, WEATHER_PROVIDER, CLIMATE_REFERENCE_PROVIDER],
    };
  }
}

export { WEATHER_ENVIRONMENT } from './config/tokens';
export {
  CLIMATE_REFERENCE_PROVIDER,
  WEATHER_CACHE_REPOSITORY,
  WEATHER_CLOCK,
  WEATHER_PROVIDER,
} from './weather.tokens';
export { WeatherService } from './weather.service';
export { WeatherException, WEATHER_ERROR_CODES, type WeatherErrorCode } from './weather.errors';
export type {
  ClimateReferenceProvider,
  WeatherProvider,
  WeatherProviderInput,
  WeatherProviderResult,
} from './providers/weather.provider';
export type {
  WeatherCacheRepository,
  WeatherCacheRecordInput,
} from './repositories/weather-cache.repository';
