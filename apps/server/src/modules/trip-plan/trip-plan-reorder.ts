import { ReorderTripPlanItemsInputSchema, TripPlanSchema } from '@travel-guide/shared-schemas';
import type { ReorderTripPlanItemsInput, TripPlan } from '@travel-guide/shared-types';

/** Stable error thrown by the provider-free reorder materialiser. */
export class TripPlanReorderError extends Error {
  public constructor(
    public readonly code:
      'TRIP_PLAN_VALIDATION_ERROR' | 'TRIP_PLAN_ENTITY_MISMATCH' | 'TRIP_PLAN_REORDER_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'TripPlanReorderError';
  }
}

/**
 * Materialise only the requested item permutation without mutating the source snapshot.
 * Route and time facts are deliberately recomputed by the authenticated service boundary.
 */
export const reorderTripPlanDayItems = (
  sourcePlan: TripPlan,
  input: ReorderTripPlanItemsInput,
  generatedAt = sourcePlan.generatedAt,
): TripPlan => {
  const parsedInput = ReorderTripPlanItemsInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new TripPlanReorderError('TRIP_PLAN_VALIDATION_ERROR', 'The TripPlan reorder is invalid');
  }
  const parsedSource = TripPlanSchema.safeParse(sourcePlan);
  if (!parsedSource.success) {
    throw new TripPlanReorderError('TRIP_PLAN_VALIDATION_ERROR', 'The source TripPlan is invalid');
  }
  const source = parsedSource.data;
  const dayIndex = source.days.findIndex((day) => day.dayNumber === parsedInput.data.dayNumber);
  if (dayIndex < 0) {
    throw new TripPlanReorderError(
      'TRIP_PLAN_ENTITY_MISMATCH',
      'The requested TripPlan day was not found',
    );
  }
  const sourceDay = source.days[dayIndex]!;
  const sourceIds = sourceDay.items.map((item) => item.id);
  const requestedIds = parsedInput.data.orderedItemIds;
  if (
    sourceIds.length !== requestedIds.length ||
    new Set(sourceIds).size !== sourceIds.length ||
    requestedIds.some((itemId) => !sourceIds.includes(itemId))
  ) {
    throw new TripPlanReorderError(
      'TRIP_PLAN_ENTITY_MISMATCH',
      'orderedItemIds must contain every item in the requested day exactly once',
    );
  }
  if (sourceIds.every((itemId, index) => itemId === requestedIds[index])) {
    throw new TripPlanReorderError(
      'TRIP_PLAN_VALIDATION_ERROR',
      'The TripPlan reorder does not change any content',
    );
  }

  const itemById = new Map(sourceDay.items.map((item) => [item.id, item]));
  const items = requestedIds.map((itemId) => ({ ...itemById.get(itemId)! }));

  const nextPlan: TripPlan = {
    ...source,
    generatedAt,
    days: source.days.map((day, index) =>
      index === dayIndex
        ? { ...day, items }
        : { ...day, items: day.items.map((item) => ({ ...item })) },
    ),
  };
  // The intermediate item order intentionally retains source times; the service
  // recomputes times/routes before the final TripPlanSchema validation.
  return nextPlan;
};
