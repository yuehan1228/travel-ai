import type { DailyWeather, WeatherDataSource } from '@travel-guide/shared-types';

export interface WeatherProviderInput {
  readonly cityName: string;
  readonly cityCode?: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface WeatherProviderResult {
  readonly days: DailyWeather[];
  readonly source: WeatherDataSource;
  readonly fetchedAt?: string;
}

export interface WeatherProvider {
  readonly name: string;
  readonly forecastHorizonDays: number;
  getForecast(input: WeatherProviderInput): Promise<WeatherProviderResult>;
}

export interface ClimateReferenceProvider {
  getClimateReference(input: WeatherProviderInput): Promise<WeatherProviderResult | undefined>;
}
