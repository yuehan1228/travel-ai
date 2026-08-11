export interface PlaceClock {
  now(): Date;
}

export const systemPlaceClock: PlaceClock = {
  now: () => new Date(),
};
