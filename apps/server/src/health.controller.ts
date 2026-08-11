import { Controller, Get, Inject } from '@nestjs/common';

import { HealthResponseSchema } from '@travel-guide/shared-schemas';
import type { HealthResponse } from '@travel-guide/shared-types';

import type { EnvironmentConfig } from './config/environment';
import { ENVIRONMENT_CONFIG } from './config/tokens';

@Controller('health')
export class HealthController {
  public constructor(@Inject(ENVIRONMENT_CONFIG) private readonly environment: EnvironmentConfig) {}

  @Get()
  public getHealth(): HealthResponse {
    return HealthResponseSchema.parse({
      status: 'ok',
      environment: this.environment.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  }
}
