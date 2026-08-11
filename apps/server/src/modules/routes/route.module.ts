import { DynamicModule, Module } from '@nestjs/common';

import {
  loadDatabaseEnvironment,
  type DatabaseEnvironment,
} from '../../database/config/database-environment';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import {
  loadRouteEnvironment,
  type RouteEnvironment,
  createTestRouteEnvironment,
} from './config/route-environment';
import { ROUTE_ENVIRONMENT, ROUTE_FETCH } from './config/tokens';
import { AmapRouteProvider, type RouteFetch } from './providers/amap-route.provider';
import type { RouteProvider } from './providers/route.provider';
import {
  DrizzleRouteCacheRepository,
  type RouteCacheRepository,
} from './repositories/route-cache.repository';
import { ROUTE_CACHE_REPOSITORY, ROUTE_CLOCK, ROUTE_PROVIDER } from './route.tokens';
import { systemRouteClock, type RouteClock } from './route.clock';
import { RouteService } from './route.service';
import { RouteMatrixService } from './route-matrix.service';
import { RoutesController } from './routes.controller';

export interface RouteModuleOptions {
  readonly routeEnvironment?: RouteEnvironment;
  readonly routeProvider?: RouteProvider;
  readonly routeCacheRepository?: RouteCacheRepository;
  readonly routeClock?: RouteClock;
  readonly routeFetch?: RouteFetch;
  readonly databaseEnvironment?: DatabaseEnvironment;
}

@Module({})
export class RouteModule {
  public static register(options: RouteModuleOptions = {}): DynamicModule {
    const environment =
      options.routeEnvironment ??
      (options.routeProvider !== undefined ? createTestRouteEnvironment() : loadRouteEnvironment());
    const provider = options.routeProvider
      ? { provide: ROUTE_PROVIDER, useValue: options.routeProvider }
      : {
          provide: ROUTE_PROVIDER,
          inject: [ROUTE_ENVIRONMENT, ROUTE_FETCH],
          useFactory: (routeEnvironment: RouteEnvironment, routeFetch: RouteFetch): RouteProvider =>
            new AmapRouteProvider(routeEnvironment, routeFetch),
        };
    const repository = options.routeCacheRepository
      ? { provide: ROUTE_CACHE_REPOSITORY, useValue: options.routeCacheRepository }
      : { provide: ROUTE_CACHE_REPOSITORY, useClass: DrizzleRouteCacheRepository };

    return {
      module: RouteModule,
      imports: options.routeCacheRepository
        ? [AuthModule]
        : [
            AuthModule,
            DatabaseModule.register(options.databaseEnvironment ?? loadDatabaseEnvironment()),
          ],
      controllers: [RoutesController],
      providers: [
        { provide: ROUTE_ENVIRONMENT, useValue: environment },
        {
          provide: ROUTE_FETCH,
          useValue:
            options.routeFetch ?? ((input: string, init?: RequestInit) => fetch(input, init)),
        },
        provider,
        repository,
        { provide: ROUTE_CLOCK, useValue: options.routeClock ?? systemRouteClock },
        RouteService,
        RouteMatrixService,
      ],
      exports: [RouteService, RouteMatrixService, ROUTE_PROVIDER, ROUTE_CACHE_REPOSITORY],
    };
  }
}

export { ROUTE_ENVIRONMENT, ROUTE_FETCH } from './config/tokens';
export {
  ROUTE_CACHE_REPOSITORY,
  ROUTE_CACHE_REPOSITORY_TOKEN,
  ROUTE_CLOCK,
  ROUTE_PROVIDER,
  ROUTE_PROVIDER_TOKEN,
} from './route.tokens';
export {
  RouteException,
  ROUTE_ERROR_CODES,
  type RouteErrorCode,
  RouteMatrixException,
  ROUTE_MATRIX_ERROR_CODES,
  type RouteMatrixErrorCode,
} from './route.errors';
export { RouteService } from './route.service';
export { RouteMatrixService, ROUTE_MATRIX_MAX_CONCURRENCY } from './route-matrix.service';
export type { RouteClock } from './route.clock';
export type { RouteProvider, RouteProviderResult } from './providers/route.provider';
export { RouteProviderResultSchema } from './providers/route.provider';
export type {
  RouteCacheRepository,
  RouteCacheRecordInput,
} from './repositories/route-cache.repository';
