import { z } from 'zod';

import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_SERVER_PORT,
  SUPPORTED_ENVIRONMENTS,
  type EnvironmentName,
} from '@travel-guide/config';

const environmentSchema = z.object({
  NODE_ENV: z.enum(SUPPORTED_ENVIRONMENTS).default(DEFAULT_ENVIRONMENT),
  PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_SERVER_PORT),
});

export interface EnvironmentConfig {
  nodeEnv: EnvironmentName;
  port: number;
}

export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentConfig {
  const result = environmentSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
  };
}
