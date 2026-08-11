export interface WeatherClock {
  now(): Date;
}

export const systemWeatherClock: WeatherClock = {
  now: () => new Date(),
};
