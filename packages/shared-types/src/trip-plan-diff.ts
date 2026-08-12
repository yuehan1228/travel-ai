import type { TripPlan, TripPlanDay } from './trip-plan';

/** Request parameters accepted by the authenticated version-diff endpoint. */
export interface TripPlanVersionDiffInput {
  readonly fromVersion: number;
  readonly toVersion: number;
}

export const TRIP_PLAN_ITEM_CHANGE_TYPES = ['added', 'removed', 'modified'] as const;
export type TripPlanItemChangeType = (typeof TRIP_PLAN_ITEM_CHANGE_TYPES)[number];

/** Fields that can be reported for a day. `items` covers the item set and item values. */
export const TRIP_PLAN_DAY_CHANGE_FIELDS = [
  'date',
  'summary',
  'weather',
  'items',
  'estimatedCostCny',
  'warnings',
] as const;
export type TripPlanDayChangeField = (typeof TRIP_PLAN_DAY_CHANGE_FIELDS)[number];

/** Fields that can be reported for a matched timeline item. `id` is the match key. */
export const TRIP_PLAN_ITEM_CHANGE_FIELDS = [
  'type',
  'startTime',
  'endTime',
  'name',
  'description',
  'recommendationReason',
  'place',
  'route',
  'estimatedCostCny',
  'tips',
  'dataSources',
] as const;
export type TripPlanItemChangeField = (typeof TRIP_PLAN_ITEM_CHANGE_FIELDS)[number];

/** Top-level business fields. `generatedAt` intentionally is not included. */
export const TRIP_PLAN_ROOT_CHANGE_FIELDS = [
  'schemaVersion',
  'tripId',
  'cityName',
  'startDate',
  'endDate',
  'travelerCount',
  'summary',
  'hotelRecommendations',
  'foodRecommendations',
  'transportationTips',
  'generalTips',
] as const;
export type TripPlanRootChangeField = (typeof TRIP_PLAN_ROOT_CHANGE_FIELDS)[number];

export const TRIP_PLAN_BUDGET_CHANGE_FIELDS = [
  'totalCny',
  'accommodationCny',
  'transportationCny',
  'foodCny',
  'attractionsCny',
  'otherCny',
] as const;
export type TripPlanBudgetChangeField = (typeof TRIP_PLAN_BUDGET_CHANGE_FIELDS)[number];

export type TripPlanChangedField =
  | TripPlanDayChangeField
  | TripPlanItemChangeField
  | TripPlanRootChangeField
  | TripPlanBudgetChangeField;

export interface TripPlanItemChange {
  readonly dayNumber: number;
  readonly itemId: string;
  readonly changeType: TripPlanItemChangeType;
  readonly changedFields: TripPlanItemChangeField[];
}

export interface TripPlanDayChange {
  /** Zero is reserved for plan-level changes; itinerary days are one-based. */
  readonly dayNumber: number;
  readonly changedFields: Array<TripPlanDayChangeField | TripPlanRootChangeField>;
  readonly itemChanges: TripPlanItemChange[];
}

export interface TripPlanBudgetDiff {
  readonly beforeTotalCny: number;
  readonly afterTotalCny: number;
  readonly changedFields: TripPlanBudgetChangeField[];
}

export interface TripPlanVersionDiffResult {
  readonly tripId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly dayChanges: TripPlanDayChange[];
  readonly budgetDiff?: TripPlanBudgetDiff;
  readonly hasChanges: boolean;
}

/** The restore endpoint intentionally accepts no caller-controlled plan data. */
export type RestoreTripPlanVersionInput = Record<string, never>;

export interface RestoreTripPlanVersionResult {
  readonly tripId: string;
  readonly sourceVersion: number;
  readonly version: number;
  readonly status: 'ready';
  readonly plan: TripPlan;
  readonly summary: import('./trip-plan').TripPlanVersionSummary;
}

/** Stable error used when a diff cannot be represented within the shared limits. */
export class TripPlanDiffValidationError extends Error {
  public readonly code = 'TRIP_PLAN_DIFF_VALIDATION_ERROR' as const;

  public constructor(message = 'TripPlan diff exceeds the supported limit') {
    super(message);
    this.name = 'TripPlanDiffValidationError';
  }
}

export const MAX_TRIP_PLAN_DIFF_DAY_CHANGES = 100;
export const MAX_TRIP_PLAN_DIFF_ITEM_CHANGES = 1_000;
export const MAX_TRIP_PLAN_DIFF_FIELDS = 32;

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Canonical JSON-like serialization used only for deterministic value equality.
 * Object keys are sorted, while array order remains meaningful.
 */
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      compareStrings(left, right),
    );
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
};

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

const sortedFields = <T extends string>(fields: readonly T[]): T[] =>
  [...new Set(fields)].sort(compareStrings);

const itemChangesForDays = (
  fromDay: TripPlanDay | undefined,
  toDay: TripPlanDay | undefined,
  dayNumber: number,
): TripPlanItemChange[] => {
  const fromItems = new Map((fromDay?.items ?? []).map((item) => [item.id, item]));
  const toItems = new Map((toDay?.items ?? []).map((item) => [item.id, item]));
  const ids = [...new Set([...fromItems.keys(), ...toItems.keys()])].sort(compareStrings);
  const changes: TripPlanItemChange[] = [];

  for (const itemId of ids) {
    const fromItem = fromItems.get(itemId);
    const toItem = toItems.get(itemId);
    if (fromItem === undefined) {
      changes.push({ dayNumber, itemId, changeType: 'added', changedFields: [] });
      continue;
    }
    if (toItem === undefined) {
      changes.push({ dayNumber, itemId, changeType: 'removed', changedFields: [] });
      continue;
    }

    const changedFields = sortedFields(
      TRIP_PLAN_ITEM_CHANGE_FIELDS.filter((field) => !sameValue(fromItem[field], toItem[field])),
    );
    if (changedFields.length > 0) {
      changes.push({ dayNumber, itemId, changeType: 'modified', changedFields });
    }
  }

  if (changes.length > MAX_TRIP_PLAN_DIFF_ITEM_CHANGES) {
    throw new TripPlanDiffValidationError('TripPlan item diff exceeds the supported limit');
  }
  return changes;
};

const dayChangesForPlans = (fromPlan: TripPlan, toPlan: TripPlan): TripPlanDayChange[] => {
  const fromDays = new Map(fromPlan.days.map((day) => [day.dayNumber, day]));
  const toDays = new Map(toPlan.days.map((day) => [day.dayNumber, day]));
  const dayNumbers = [...new Set([...fromDays.keys(), ...toDays.keys()])].sort(
    (left, right) => left - right,
  );
  const changes: TripPlanDayChange[] = [];

  for (const dayNumber of dayNumbers) {
    const fromDay = fromDays.get(dayNumber);
    const toDay = toDays.get(dayNumber);
    const itemChanges = itemChangesForDays(fromDay, toDay, dayNumber);
    const changedFields =
      fromDay === undefined || toDay === undefined
        ? [...TRIP_PLAN_DAY_CHANGE_FIELDS]
        : sortedFields(
            TRIP_PLAN_DAY_CHANGE_FIELDS.filter((field) => {
              if (field === 'items') return itemChanges.length > 0;
              return !sameValue(fromDay[field], toDay[field]);
            }),
          );
    if (changedFields.length > 0 || itemChanges.length > 0) {
      changes.push({ dayNumber, changedFields, itemChanges });
    }
  }
  return changes;
};

/**
 * Compare two validated immutable TripPlan snapshots without mutating either one.
 * `generatedAt` is metadata and deliberately excluded from all business changes.
 */
export const compareTripPlanVersions = (
  fromPlan: TripPlan,
  toPlan: TripPlan,
  fromVersion = 1,
  toVersion = 2,
): TripPlanVersionDiffResult => {
  if (
    !Number.isSafeInteger(fromVersion) ||
    !Number.isSafeInteger(toVersion) ||
    fromVersion < 1 ||
    toVersion < 1 ||
    fromVersion > 2_147_483_647 ||
    toVersion > 2_147_483_647 ||
    fromVersion === toVersion
  ) {
    throw new TripPlanDiffValidationError('TripPlan diff versions are invalid');
  }
  if (fromPlan.tripId !== toPlan.tripId) {
    throw new TripPlanDiffValidationError('TripPlan snapshots must belong to the same trip');
  }

  const dayChanges = dayChangesForPlans(fromPlan, toPlan);
  const rootChangedFields = sortedFields(
    TRIP_PLAN_ROOT_CHANGE_FIELDS.filter((field) => !sameValue(fromPlan[field], toPlan[field])),
  );
  if (rootChangedFields.length > 0) {
    // The shared result has dayChanges as its structured change list.  Day zero is
    // reserved for plan-level fields so global tips/recommendations are not lost.
    dayChanges.push({ dayNumber: 0, changedFields: rootChangedFields, itemChanges: [] });
    dayChanges.sort((left, right) => left.dayNumber - right.dayNumber);
  }

  const budgetChangedFields = sortedFields(
    TRIP_PLAN_BUDGET_CHANGE_FIELDS.filter(
      (field) => !sameValue(fromPlan.budget[field], toPlan.budget[field]),
    ),
  );
  const budgetDiff =
    budgetChangedFields.length === 0
      ? undefined
      : {
          beforeTotalCny: fromPlan.budget.totalCny,
          afterTotalCny: toPlan.budget.totalCny,
          changedFields: budgetChangedFields,
        };

  let itemChangeCount = 0;
  for (const day of dayChanges) itemChangeCount += day.itemChanges.length;
  if (
    dayChanges.length > MAX_TRIP_PLAN_DIFF_DAY_CHANGES ||
    itemChangeCount > MAX_TRIP_PLAN_DIFF_ITEM_CHANGES
  ) {
    throw new TripPlanDiffValidationError();
  }
  if (dayChanges.some((day) => day.changedFields.length > MAX_TRIP_PLAN_DIFF_FIELDS)) {
    throw new TripPlanDiffValidationError('TripPlan changed fields exceed the supported limit');
  }

  return {
    tripId: fromPlan.tripId,
    fromVersion,
    toVersion,
    dayChanges,
    ...(budgetDiff === undefined ? {} : { budgetDiff }),
    hasChanges: dayChanges.length > 0 || budgetDiff !== undefined,
  };
};

/** Attach API version numbers without allowing callers to mutate the comparison logic. */
export const withTripPlanVersionDiffVersions = (
  diff: TripPlanVersionDiffResult,
  input: TripPlanVersionDiffInput,
): TripPlanVersionDiffResult => ({
  ...diff,
  fromVersion: input.fromVersion,
  toVersion: input.toVersion,
});
