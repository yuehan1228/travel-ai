export const SUPPORTED_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type EnvironmentName = (typeof SUPPORTED_ENVIRONMENTS)[number];

export const DEFAULT_ENVIRONMENT: EnvironmentName = 'development';
export const DEFAULT_SERVER_PORT = 3000;
