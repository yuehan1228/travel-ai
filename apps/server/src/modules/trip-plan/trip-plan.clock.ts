export interface TripPlanClock {
  now(): Date;
}

export const systemTripPlanClock: TripPlanClock = {
  now: () => new Date(),
};
