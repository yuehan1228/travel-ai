/** Origin of the weather data returned to callers. */
export type WeatherDataSource = 'forecast' | 'climate_reference' | 'unavailable';

export const WEATHER_DATA_SOURCES = ['forecast', 'climate_reference', 'unavailable'] as const;

export type WeatherCondition =
  'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog' | 'wind' | 'unknown';

export const WEATHER_CONDITIONS = [
  'clear',
  'cloudy',
  'rain',
  'snow',
  'storm',
  'fog',
  'wind',
  'unknown',
] as const;

export interface WeatherLocationInput {
  cityName: string;
  cityCode?: string;
}

export interface GetWeatherInput {
  destination: WeatherLocationInput;
  startDate: string;
  endDate: string;
}

export interface DailyWeather {
  date: string;
  condition: WeatherCondition;
  conditionText: string;
  minTemperatureC?: number;
  maxTemperatureC?: number;
  precipitationProbability?: number;
  windScale?: string;
  humidityPercent?: number;
  source: WeatherDataSource;
  isReference: boolean;
}

export interface WeatherResult {
  destination: WeatherLocationInput;
  days: DailyWeather[];
  source: WeatherDataSource;
  notice?: string;
  fetchedAt?: string;
}
