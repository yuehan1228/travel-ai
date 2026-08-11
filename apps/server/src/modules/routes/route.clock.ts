export interface RouteClock {
  now(): Date;
}

export const systemRouteClock: RouteClock = {
  now: () => new Date(),
};
