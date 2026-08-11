export const MINIAPP_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type MiniAppEnvironment = (typeof MINIAPP_ENVIRONMENTS)[number];

export interface MiniAppEnvironmentConfig {
  readonly name: MiniAppEnvironment;
  readonly baseUrl: string;
  readonly requestTimeout: number;
}

const environmentConfigs: Record<MiniAppEnvironment, MiniAppEnvironmentConfig> = {
  development: {
    name: 'development',
    baseUrl: 'http://localhost:3000',
    requestTimeout: 10_000,
  },
  test: {
    name: 'test',
    baseUrl: 'http://127.0.0.1:3000',
    requestTimeout: 5_000,
  },
  production: {
    name: 'production',
    baseUrl: 'https://api.example.invalid',
    requestTimeout: 10_000,
  },
};

export const CURRENT_MINIAPP_ENVIRONMENT: MiniAppEnvironment = 'development';

const BASE_URL_PATTERN = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[^\s?#]*)?$/;

const isMiniAppEnvironment = (environment: string): environment is MiniAppEnvironment =>
  MINIAPP_ENVIRONMENTS.some((candidate) => candidate === environment);

export const isValidBaseUrl = (baseUrl: string): boolean => {
  const normalizedBaseUrl = baseUrl.trim();

  if (!BASE_URL_PATTERN.test(normalizedBaseUrl)) {
    return false;
  }

  const host = normalizedBaseUrl.replace(/^https?:\/\//, '').split(/[/:]/, 1)[0];
  return host.length > 0 && !host.startsWith('.') && !host.endsWith('.') && !host.includes('..');
};

export const getEnvironmentConfig = (environment: string): MiniAppEnvironmentConfig => {
  if (!isMiniAppEnvironment(environment)) {
    throw new Error(`Unsupported miniapp environment: ${environment}`);
  }

  const config = environmentConfigs[environment];

  if (!isValidBaseUrl(config.baseUrl)) {
    throw new Error(`Invalid base URL for miniapp environment: ${environment}`);
  }

  return config;
};

export const CURRENT_MINIAPP_CONFIG = getEnvironmentConfig(CURRENT_MINIAPP_ENVIRONMENT);
