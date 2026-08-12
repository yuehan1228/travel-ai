import { EditTripPlanInputSchema, TripPlanSchema } from '@travel-guide/shared-schemas';
import type { EditTripPlanInput, TripPlan, TripPlanItemType } from '@travel-guide/shared-types';

/** Stable error thrown by the pure edit materialiser. */
export class TripPlanEditValidationError extends Error {
  public constructor(
    public readonly code: 'TRIP_PLAN_VALIDATION_ERROR' | 'TRIP_PLAN_ENTITY_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'TripPlanEditError';
  }
}

/** Backwards-compatible descriptive alias used by service adapters. */
export class TripPlanEditError extends TripPlanEditValidationError {}

const budgetCategoryForItem: Record<
  TripPlanItemType,
  'accommodationCny' | 'transportationCny' | 'foodCny' | 'attractionsCny' | 'otherCny'
> = {
  attraction: 'attractionsCny',
  food: 'foodCny',
  transport: 'transportationCny',
  hotel: 'accommodationCny',
  rest: 'otherCny',
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
};

const contentWithoutGeneratedAt = (plan: TripPlan): unknown => {
  const { generatedAt: _generatedAt, ...content } = plan;
  void _generatedAt;
  return content;
};

const sameContent = (left: TripPlan, right: TripPlan): boolean =>
  JSON.stringify(canonicalize(contentWithoutGeneratedAt(left))) ===
  JSON.stringify(canonicalize(contentWithoutGeneratedAt(right)));

const cents = (value: number): number => Math.round(value * 100);

const recomputeDerivedCosts = (plan: TripPlan): TripPlan => {
  const categoryCents = {
    accommodationCny: 0,
    transportationCny: 0,
    foodCny: 0,
    attractionsCny: 0,
    otherCny: 0,
  };
  const days = plan.days.map((day) => {
    const dayCents = day.items.reduce((total, item) => total + cents(item.estimatedCostCny), 0);
    day.items.forEach((item) => {
      categoryCents[budgetCategoryForItem[item.type]] += cents(item.estimatedCostCny);
    });
    return { ...day, estimatedCostCny: dayCents / 100 };
  });
  const totalCents = Object.values(categoryCents).reduce((total, amount) => total + amount, 0);
  return {
    ...plan,
    days,
    budget: {
      currency: 'CNY',
      totalCny: totalCents / 100,
      accommodationCny: categoryCents.accommodationCny / 100,
      transportationCny: categoryCents.transportationCny / 100,
      foodCny: categoryCents.foodCny / 100,
      attractionsCny: categoryCents.attractionsCny / 100,
      otherCny: categoryCents.otherCny / 100,
    },
  };
};

/**
 * Apply only the shared edit whitelist to a validated immutable snapshot.
 * The source object and all of its nested arrays are left untouched.
 */
export const applyTripPlanEdits = (
  sourcePlan: TripPlan,
  input: EditTripPlanInput,
  generatedAt = new Date().toISOString(),
): TripPlan => {
  const parsedInput = EditTripPlanInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new TripPlanEditError('TRIP_PLAN_VALIDATION_ERROR', 'The TripPlan edit is invalid');
  }
  const parsedSource = TripPlanSchema.safeParse(sourcePlan);
  if (!parsedSource.success) {
    throw new TripPlanEditError('TRIP_PLAN_VALIDATION_ERROR', 'The source TripPlan is invalid');
  }

  const source = parsedSource.data;
  const dayEdits = parsedInput.data.dayEdits ?? [];
  const itemEdits = parsedInput.data.itemEdits ?? [];
  const editedDays = new Set(dayEdits.map((edit) => edit.dayNumber));
  const days = source.days.map((day) => {
    const edit = dayEdits.find((candidate) => candidate.dayNumber === day.dayNumber);
    if (edit === undefined) return day;
    return {
      ...day,
      ...(edit.summary === undefined ? {} : { summary: edit.summary }),
      ...(edit.warnings === undefined
        ? {}
        : { warnings: edit.warnings.map((warning) => ({ ...warning })) }),
    };
  });

  for (const dayNumber of editedDays) {
    if (!source.days.some((day) => day.dayNumber === dayNumber)) {
      throw new TripPlanEditError(
        'TRIP_PLAN_ENTITY_MISMATCH',
        'The requested TripPlan day was not found',
      );
    }
  }

  for (const edit of itemEdits) {
    const dayIndex = days.findIndex((day) => day.dayNumber === edit.dayNumber);
    if (dayIndex < 0) {
      throw new TripPlanEditError(
        'TRIP_PLAN_ENTITY_MISMATCH',
        'The requested TripPlan day was not found',
      );
    }
    const itemIndex = days[dayIndex]!.items.findIndex((item) => item.id === edit.itemId);
    if (itemIndex < 0) {
      throw new TripPlanEditError(
        'TRIP_PLAN_ENTITY_MISMATCH',
        'The requested TripPlan item was not found',
      );
    }
    const day = days[dayIndex]!;
    const item = day.items[itemIndex]!;
    const nextItem = {
      ...item,
      ...(edit.description === undefined ? {} : { description: edit.description }),
      ...(edit.recommendationReason === undefined
        ? {}
        : { recommendationReason: edit.recommendationReason }),
      ...(edit.tips === undefined ? {} : { tips: [...edit.tips] }),
      ...(edit.estimatedCostCny === undefined ? {} : { estimatedCostCny: edit.estimatedCostCny }),
    };
    days[dayIndex] = {
      ...day,
      items: day.items.map((candidate, index) => (index === itemIndex ? nextItem : candidate)),
    };
  }

  const editedPlan = recomputeDerivedCosts({
    ...source,
    ...(parsedInput.data.summary === undefined ? {} : { summary: parsedInput.data.summary }),
    days,
    generatedAt,
  });
  const validated = TripPlanSchema.safeParse(editedPlan);
  if (!validated.success) {
    throw new TripPlanEditError('TRIP_PLAN_VALIDATION_ERROR', 'The edited TripPlan is invalid');
  }
  if (sameContent(source, validated.data)) {
    throw new TripPlanEditError(
      'TRIP_PLAN_VALIDATION_ERROR',
      'The TripPlan edit does not change any content',
    );
  }
  return validated.data;
};
