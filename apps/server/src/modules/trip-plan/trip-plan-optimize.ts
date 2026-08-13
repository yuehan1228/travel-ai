import { OptimizeTripPlanDayInputSchema, TripPlanSchema } from '@travel-guide/shared-schemas';
import type { TripPlan } from '@travel-guide/shared-types';

/** Stable error thrown by the provider-free optimization materialiser. */
export class TripPlanOptimizeError extends Error {
  public constructor(
    public readonly code: 'TRIP_PLAN_VALIDATION_ERROR' | 'TRIP_PLAN_ENTITY_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'TripPlanOptimizeError';
  }
}

/**
 * Materialise only a validated deterministic item permutation.
 * Route estimates, times and provider facts are intentionally left to the service.
 */
export const optimizeTripPlanDayItems = (
  sourcePlan: TripPlan,
  orderedItemIds: readonly string[],
  dayNumber: number,
): TripPlan => {
  const parsedSource = TripPlanSchema.safeParse(sourcePlan);
  if (!parsedSource.success) {
    throw new TripPlanOptimizeError('TRIP_PLAN_VALIDATION_ERROR', 'The source TripPlan is invalid');
  }
  const parsedInput = OptimizeTripPlanDayInputSchema.safeParse({
    sourceVersion: 1,
    dayNumber,
  });
  if (!parsedInput.success || !Array.isArray(orderedItemIds)) {
    throw new TripPlanOptimizeError(
      'TRIP_PLAN_VALIDATION_ERROR',
      'The optimization input is invalid',
    );
  }

  const source = parsedSource.data;
  const dayIndex = source.days.findIndex((day) => day.dayNumber === dayNumber);
  if (dayIndex < 0) {
    throw new TripPlanOptimizeError(
      'TRIP_PLAN_ENTITY_MISMATCH',
      'The requested TripPlan day was not found',
    );
  }

  const sourceDay = source.days[dayIndex]!;
  const sourceIds = sourceDay.items.map((item) => item.id);
  const requestedIds = [...orderedItemIds];
  if (
    sourceIds.length !== requestedIds.length ||
    new Set(requestedIds).size !== requestedIds.length ||
    sourceIds.some((itemId) => !requestedIds.includes(itemId))
  ) {
    throw new TripPlanOptimizeError(
      'TRIP_PLAN_ENTITY_MISMATCH',
      'orderedItemIds must contain every item in the requested day exactly once',
    );
  }
  if (sourceIds.every((itemId, index) => itemId === requestedIds[index])) {
    throw new TripPlanOptimizeError(
      'TRIP_PLAN_VALIDATION_ERROR',
      'The TripPlan optimization does not change any content',
    );
  }

  const itemById = new Map(sourceDay.items.map((item) => [item.id, item]));
  const items = requestedIds.map((itemId) => {
    const item = itemById.get(itemId);
    if (item === undefined) {
      throw new TripPlanOptimizeError(
        'TRIP_PLAN_ENTITY_MISMATCH',
        'The requested item was not found',
      );
    }
    return { ...item, tips: [...item.tips], dataSources: [...item.dataSources] };
  });

  return {
    ...source,
    days: source.days.map((day, index) =>
      index === dayIndex
        ? { ...day, items }
        : { ...day, items: day.items.map((item) => ({ ...item })) },
    ),
  };
};
