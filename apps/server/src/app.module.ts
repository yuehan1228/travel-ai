import { DynamicModule, Module, type Type } from '@nestjs/common';

import { HealthController } from './health.controller';
import type { EnvironmentConfig } from './config/environment';
import { ENVIRONMENT_CONFIG } from './config/tokens';
import {
  createTestAuthEnvironment,
  loadAuthEnvironment,
  type AuthEnvironment,
} from './modules/auth/config/auth-environment';
import { AuthModule, type AuthModuleOptions } from './modules/auth/auth.module';
import { TripModule } from './modules/trips/trip.module';
import type { TripRepository } from './modules/trips/repositories/trip.repository';
import { WeatherModule, type WeatherModuleOptions } from './modules/weather/weather.module';
import { PlaceModule, type PlaceModuleOptions } from './modules/places/place.module';
import {
  createTestPlaceEnvironment,
  loadPlaceEnvironment,
  type PlaceEnvironment,
} from './modules/places/config/place-environment';
import type { PlaceRepository } from './modules/places/repositories/place.repository';
import type { PlaceProvider } from './modules/places/providers/place.provider';
import type { PlaceClock } from './modules/places/place.clock';
import {
  createTestRouteEnvironment,
  loadRouteEnvironment,
  type RouteEnvironment,
} from './modules/routes/config/route-environment';
import type { RouteProvider } from './modules/routes/providers/route.provider';
import type { RouteCacheRepository } from './modules/routes/repositories/route-cache.repository';
import type { RouteClock } from './modules/routes/route.clock';
import { RouteModule, type RouteModuleOptions } from './modules/routes/route.module';
import {
  createTestLlmEnvironment,
  loadLlmEnvironment,
  type LlmEnvironment,
} from './modules/trip-plan/config/llm-environment';
import type { LLMFetch, LLMProvider } from './modules/trip-plan/providers';
import { TripPlanModule } from './modules/trip-plan/trip-plan.module';

export { ENVIRONMENT_CONFIG } from './config/tokens';

export interface AppModuleOptions
  extends
    AuthModuleOptions,
    Omit<WeatherModuleOptions, 'databaseEnvironment'>,
    Omit<PlaceModuleOptions, 'databaseEnvironment'> {
  readonly authEnvironment?: AuthEnvironment;
  readonly tripRepository?: TripRepository;
  readonly placeEnvironment?: PlaceEnvironment;
  readonly placeProvider?: PlaceProvider;
  readonly placeRepository?: PlaceRepository;
  readonly placeClock?: PlaceClock;
  readonly routeEnvironment?: RouteEnvironment;
  readonly routeProvider?: RouteProvider;
  readonly routeCacheRepository?: RouteCacheRepository;
  readonly routeClock?: RouteClock;
  readonly routeFetch?: RouteModuleOptions['routeFetch'];
  readonly llmEnvironment?: LlmEnvironment;
  readonly llmProvider?: LLMProvider;
  readonly llmFetch?: LLMFetch;
}

@Module({
  controllers: [HealthController],
})
export class AppModule {
  public static register(
    environment: EnvironmentConfig,
    extraControllers: Type<object>[] = [],
    options: AppModuleOptions = {},
  ): DynamicModule {
    const authEnvironment =
      options.authEnvironment ??
      (environment.nodeEnv === 'test' ? createTestAuthEnvironment() : loadAuthEnvironment());
    const placeEnvironment =
      options.placeEnvironment ??
      (environment.nodeEnv === 'test' ? createTestPlaceEnvironment() : loadPlaceEnvironment());
    const routeEnvironment =
      options.routeEnvironment ??
      (environment.nodeEnv === 'test' ? createTestRouteEnvironment() : loadRouteEnvironment());
    const llmEnvironment =
      options.llmEnvironment ??
      (environment.nodeEnv === 'test' ? createTestLlmEnvironment() : loadLlmEnvironment());

    return {
      module: AppModule,
      imports: [
        AuthModule.register(authEnvironment, options),
        TripModule.register({
          tripRepository: options.tripRepository,
          databaseEnvironment: options.databaseEnvironment,
        }),
        WeatherModule.register({
          weatherEnvironment: options.weatherEnvironment,
          weatherProvider: options.weatherProvider,
          climateReferenceProvider: options.climateReferenceProvider,
          weatherCacheRepository: options.weatherCacheRepository,
          weatherClock: options.weatherClock,
          databaseEnvironment: options.databaseEnvironment,
        }),
        PlaceModule.register({
          placeEnvironment,
          placeProvider: options.placeProvider,
          placeRepository: options.placeRepository,
          placeClock: options.placeClock,
          databaseEnvironment: options.databaseEnvironment,
        }),
        RouteModule.register({
          routeEnvironment,
          routeProvider: options.routeProvider,
          routeCacheRepository: options.routeCacheRepository,
          routeClock: options.routeClock,
          routeFetch: options.routeFetch,
          databaseEnvironment: options.databaseEnvironment,
        }),
        TripPlanModule.register({
          llmEnvironment,
          llmProvider: options.llmProvider,
          llmFetch: options.llmFetch,
        }),
      ],
      controllers: extraControllers,
      providers: [
        {
          provide: ENVIRONMENT_CONFIG,
          useValue: environment,
        },
      ],
      exports: [ENVIRONMENT_CONFIG],
    };
  }
}
