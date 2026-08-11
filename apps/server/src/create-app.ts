import 'reflect-metadata';

import { Logger, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import type { AppModuleOptions } from './app.module';
import { loadEnvironment, type EnvironmentConfig } from './config/environment';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { registerRequestContext } from './http/request-context';
import type { TripRepository } from './modules/trips/repositories/trip.repository';
import type {
  ClimateReferenceProvider,
  WeatherCacheRepository,
  WeatherClock,
  WeatherProvider,
} from './modules/weather';
import type { WeatherEnvironment } from './modules/weather/config/weather-environment';
import type { PlaceEnvironment } from './modules/places/config/place-environment';
import type { PlaceProvider } from './modules/places/providers/place.provider';
import type { PlaceRepository } from './modules/places/repositories/place.repository';
import type { PlaceClock } from './modules/places/place.clock';
import type { RouteEnvironment } from './modules/routes/config/route-environment';
import type { RouteProvider } from './modules/routes/providers/route.provider';
import type { RouteFetch } from './modules/routes/providers/amap-route.provider';
import type { RouteCacheRepository } from './modules/routes/repositories/route-cache.repository';
import type { RouteClock } from './modules/routes/route.clock';

export interface CreateAppOptions {
  extraControllers?: Type<object>[];
  authEnvironment?: AppModuleOptions['authEnvironment'];
  wechatProvider?: AppModuleOptions['wechatProvider'];
  userRepository?: AppModuleOptions['userRepository'];
  tripRepository?: TripRepository;
  databaseEnvironment?: AppModuleOptions['databaseEnvironment'];
  weatherEnvironment?: WeatherEnvironment;
  weatherProvider?: WeatherProvider;
  climateReferenceProvider?: ClimateReferenceProvider;
  weatherCacheRepository?: WeatherCacheRepository;
  weatherClock?: WeatherClock;
  placeEnvironment?: PlaceEnvironment;
  placeProvider?: PlaceProvider;
  placeRepository?: PlaceRepository;
  placeClock?: PlaceClock;
  routeEnvironment?: RouteEnvironment;
  routeProvider?: RouteProvider;
  routeCacheRepository?: RouteCacheRepository;
  routeClock?: RouteClock;
  routeFetch?: RouteFetch;
}

export async function createApp(
  environment: EnvironmentConfig = loadEnvironment(),
  options: CreateAppOptions = {},
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(environment, options.extraControllers, {
      authEnvironment: options.authEnvironment,
      wechatProvider: options.wechatProvider,
      userRepository: options.userRepository,
      tripRepository: options.tripRepository,
      databaseEnvironment: options.databaseEnvironment,
      weatherEnvironment: options.weatherEnvironment,
      weatherProvider: options.weatherProvider,
      climateReferenceProvider: options.climateReferenceProvider,
      weatherCacheRepository: options.weatherCacheRepository,
      weatherClock: options.weatherClock,
      placeEnvironment: options.placeEnvironment,
      placeProvider: options.placeProvider,
      placeRepository: options.placeRepository,
      placeClock: options.placeClock,
      routeEnvironment: options.routeEnvironment,
      routeProvider: options.routeProvider,
      routeCacheRepository: options.routeCacheRepository,
      routeClock: options.routeClock,
      routeFetch: options.routeFetch,
    }),
    new FastifyAdapter(),
    { logger: ['error', 'warn', 'log'] },
  );

  registerRequestContext(app.getHttpAdapter().getInstance(), new Logger('HttpRequest'));
  app.useGlobalFilters(new ApiExceptionFilter());

  return app;
}
