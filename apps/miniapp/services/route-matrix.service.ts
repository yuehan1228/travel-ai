import { authService } from './auth.service';
import { type RouteAuthService, RouteService } from './route.service';
import { createHttpClient, type HttpClient } from './http-client';

/** Type-safe client for authenticated route matrix requests. */
export class RouteMatrixService extends RouteService {}

export const createRouteMatrixService = (
  client: HttpClient = createHttpClient(),
  auth: RouteAuthService = authService,
): RouteMatrixService => new RouteMatrixService(client, auth);

export const routeMatrixService = new RouteMatrixService();
