import { HealthResponseSchema } from '@travel-guide/shared-schemas';
import type { HealthResponse } from '@travel-guide/shared-types';

import { createHttpClient, type HttpClient, type RequestOptions } from './http-client';

const healthRequest: RequestOptions<HealthResponse> = {
  method: 'GET',
  path: '/health',
  schema: HealthResponseSchema,
};

export class HealthService {
  public constructor(private readonly client: HttpClient = createHttpClient()) {}

  public getHealth(): Promise<HealthResponse> {
    return this.client.requestRaw(healthRequest);
  }
}

export const healthService = new HealthService();
