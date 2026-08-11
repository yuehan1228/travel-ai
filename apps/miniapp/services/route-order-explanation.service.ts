import { authService, AuthService } from './auth.service';
import { createHttpClient, type HttpClient } from './http-client';
import { RouteOrderService } from './route-order.service';

export type { RouteOrderAuthService } from './route-order.service';

/** Type-safe client for authenticated route-order explanation requests. */
export class RouteOrderExplanationService extends RouteOrderService {}

export const createRouteOrderExplanationService = (
  client: HttpClient = createHttpClient(),
  auth: Pick<AuthService, 'getAccessToken' | 'logout'> = authService,
): RouteOrderExplanationService => new RouteOrderExplanationService(client, auth);

export const routeOrderExplanationService = new RouteOrderExplanationService();
