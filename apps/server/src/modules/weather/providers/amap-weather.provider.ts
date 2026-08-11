import { Inject, Injectable } from '@nestjs/common';

import { DailyWeatherSchema } from '@travel-guide/shared-schemas';

import type { WeatherEnvironment } from '../config/weather-environment';
import { WEATHER_ENVIRONMENT } from '../config/tokens';
import { WeatherProviderError } from '../weather.errors';
import type {
  WeatherProvider,
  WeatherProviderInput,
  WeatherProviderResult,
} from './weather.provider';

const AMAP_WEATHER_URL = 'https://restapi.amap.com/v3/weather/weatherInfo';

interface AmapForecast {
  readonly date?: unknown;
  readonly dayweather?: unknown;
  readonly nightweather?: unknown;
  readonly daytemp?: unknown;
  readonly nighttemp?: unknown;
  readonly daypower?: unknown;
  readonly daywind?: unknown;
  readonly dayhumidity?: unknown;
}

interface AmapResponse {
  readonly status?: unknown;
  readonly info?: unknown;
  readonly forecasts?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const asNumber = (value: unknown): number | undefined => {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
};

const mapCondition = (
  dayText: string,
): 'clear' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog' | 'wind' | 'unknown' => {
  const text = dayText.toLowerCase();
  if (text.includes('雷') || text.includes('storm') || text.includes('thunder')) return 'storm';
  if (text.includes('雪') || text.includes('snow')) return 'snow';
  if (text.includes('雨') || text.includes('rain') || text.includes('shower')) return 'rain';
  if (text.includes('雾') || text.includes('霾') || text.includes('fog') || text.includes('haze'))
    return 'fog';
  if (text.includes('风') || text.includes('wind')) return 'wind';
  if (text.includes('云') || text.includes('阴') || text.includes('cloud')) return 'cloudy';
  if (text.includes('晴') || text.includes('clear') || text.includes('sun')) return 'clear';
  return 'unknown';
};

const isWithinRange = (date: string, startDate: string, endDate: string): boolean =>
  date >= startDate && date <= endDate;

@Injectable()
export class AmapWeatherProvider implements WeatherProvider {
  public readonly name = 'amap';

  public constructor(
    @Inject(WEATHER_ENVIRONMENT) private readonly environment: WeatherEnvironment,
  ) {}

  public get forecastHorizonDays(): number {
    return this.environment.forecastHorizonDays;
  }

  public async getForecast(input: WeatherProviderInput): Promise<WeatherProviderResult> {
    if (
      this.environment.apiKey.trim().length === 0 ||
      this.environment.apiKey.startsWith('replace-')
    ) {
      throw new WeatherProviderError();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.environment.requestTimeoutMs);

    try {
      const params = new URLSearchParams({
        key: this.environment.apiKey,
        city: input.cityCode ?? input.cityName,
        extensions: 'all',
        output: 'JSON',
      });
      const response = await fetch(`${AMAP_WEATHER_URL}?${params.toString()}`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new WeatherProviderError();
      }

      const parsed: unknown = await response.json();
      const body = asRecord(parsed) as AmapResponse | undefined;
      if (body?.status !== '1' || body.info !== 'OK' || !Array.isArray(body.forecasts)) {
        throw new WeatherProviderError();
      }

      const cityForecast = asRecord(body.forecasts[0]);
      const casts = cityForecast?.casts;
      if (!Array.isArray(casts)) {
        throw new WeatherProviderError();
      }

      const days = casts.flatMap((rawCast: unknown) => {
        const cast = asRecord(rawCast) as AmapForecast | undefined;
        const date = asText(cast?.date);
        const dayWeather = asText(cast?.dayweather);
        if (
          date === undefined ||
          dayWeather === undefined ||
          !isWithinRange(date, input.startDate, input.endDate)
        ) {
          return [];
        }

        const minTemperatureC = asNumber(cast?.nighttemp);
        const maxTemperatureC = asNumber(cast?.daytemp);
        const daily = {
          date,
          condition: mapCondition(dayWeather),
          conditionText: dayWeather,
          ...(minTemperatureC === undefined ? {} : { minTemperatureC }),
          ...(maxTemperatureC === undefined ? {} : { maxTemperatureC }),
          ...(asText(cast?.daypower) === undefined ? {} : { windScale: asText(cast?.daypower) }),
          source: 'forecast' as const,
          isReference: false,
        };
        const result = DailyWeatherSchema.safeParse(daily);
        return result.success ? [result.data] : [];
      });

      if (days.length === 0) {
        throw new WeatherProviderError();
      }

      return { days, source: 'forecast', fetchedAt: new Date().toISOString() };
    } catch (error: unknown) {
      if (error instanceof WeatherProviderError) {
        throw error;
      }
      throw new WeatherProviderError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { AMAP_WEATHER_URL };
