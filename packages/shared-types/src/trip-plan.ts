import type { DailyWeather } from './weather';
import type { Place } from './place';
import type { RouteEstimate, RouteMode, RouteOrderDecisionReason } from './route';
import type { PaginationMeta } from './api';

/** Kinds of entries that may appear in a generated itinerary. */
export const TRIP_PLAN_ITEM_TYPES = ['attraction', 'food', 'transport', 'hotel', 'rest'] as const;

export type TripPlanItemType = (typeof TRIP_PLAN_ITEM_TYPES)[number];

/** Data origins are intentionally coarser than provider-specific responses. */
export const TRIP_PLAN_DATA_SOURCES = [
  'map_provider',
  'weather_provider',
  'route_provider',
  'user_input',
  'ai_generated',
] as const;

export type TripPlanDataSource = (typeof TRIP_PLAN_DATA_SOURCES)[number];

export const TRIP_PLAN_WARNING_SEVERITIES = ['info', 'warning'] as const;

export type TripPlanWarningSeverity = (typeof TRIP_PLAN_WARNING_SEVERITIES)[number];

/** A stable, user-visible warning attached to a day or to the whole plan. */
export interface TripPlanWarning {
  code: string;
  severity: TripPlanWarningSeverity;
  message: string;
  dayNumber?: number;
}

/** A single timed itinerary entry. */
export interface TripPlanItem {
  id: string;
  type: TripPlanItemType;
  startTime: string;
  endTime: string;
  name: string;
  description: string;
  recommendationReason: string;
  place?: Place;
  route?: RouteEstimate;
  estimatedCostCny: number;
  tips: string[];
  dataSources: TripPlanDataSource[];
}

export interface TripPlanDay {
  dayNumber: number;
  date: string;
  summary: string;
  weather: DailyWeather;
  items: TripPlanItem[];
  estimatedCostCny: number;
  warnings: TripPlanWarning[];
}

/** A recommendation for an area to use as a base; it is not a hotel quote. */
export interface HotelAreaRecommendation {
  id: string;
  areaName: string;
  description: string;
  recommendationReason: string;
  place?: Place;
  tips: string[];
  dataSources: TripPlanDataSource[];
}

/** A food recommendation may be generic or tied to a verified Place. */
export interface FoodRecommendation {
  id: string;
  name: string;
  description: string;
  recommendationReason: string;
  cuisine?: string;
  place?: Place;
  tips: string[];
  dataSources: TripPlanDataSource[];
}

/** Category totals are derived from the item costs, not supplier quotations. */
export interface TripBudgetEstimate {
  currency: 'CNY';
  totalCny: number;
  accommodationCny: number;
  transportationCny: number;
  foodCny: number;
  attractionsCny: number;
  otherCny: number;
}

export interface TripPlan {
  schemaVersion: '1.0';
  tripId: string;
  cityName: string;
  startDate: string;
  endDate: string;
  travelerCount: number;
  summary: string;
  days: TripPlanDay[];
  hotelRecommendations: HotelAreaRecommendation[];
  foodRecommendations: FoodRecommendation[];
  budget: TripBudgetEstimate;
  transportationTips: string[];
  generalTips: string[];
  generatedAt: string;
}

/** The generation endpoint intentionally accepts no caller-controlled data. */
export type GenerateTripPlanInput = Record<string, never>;

export const TRIP_PLAN_VERSION_STATUSES = ['generating', 'ready', 'failed'] as const;

export type TripPlanVersionStatus = (typeof TRIP_PLAN_VERSION_STATUSES)[number];

/** Metadata for one persisted, immutable TripPlan version. */
export interface TripPlanVersionSummary {
  id: string;
  tripId: string;
  version: number;
  schemaVersion: '1.0';
  status: TripPlanVersionStatus;
  generatedAt?: string;
  createdAt: string;
}

/** Version list returned by the latest-plan endpoint. */
export interface TripPlanVersionListResult {
  items: TripPlanVersionSummary[];
  latestVersion?: number;
  /** The latest ready plan, when one exists. */
  plan?: TripPlan;
}

/** Generation and version-read result. */
export interface TripPlanGenerationResult {
  version: number;
  status: TripPlanVersionStatus;
  plan?: TripPlan;
  summary: TripPlanVersionSummary;
  tripId: string;
}

/** Strict request for replacing exactly one day from an immutable ready version. */
export interface RegenerateTripPlanDayInput {
  readonly sourceVersion: number;
  readonly dayNumber: number;
  readonly instruction?: string;
}

/** Result of a day regeneration; the returned plan is the complete new snapshot. */
export interface RegenerateTripPlanDayResult extends TripPlanGenerationResult {
  readonly sourceVersion: number;
  readonly dayNumber: number;
}

/** A controlled, user-authored change request for one immutable ready snapshot. */
export interface EditTripPlanInput {
  readonly sourceVersion: number;
  readonly summary?: string;
  readonly dayEdits?: EditTripPlanDayInput[];
  readonly itemEdits?: EditTripPlanItemInput[];
}

/** Fields that may be changed on a plan day. All other day fields are derived or immutable. */
export interface EditTripPlanDayInput {
  readonly dayNumber: number;
  readonly summary?: string;
  readonly warnings?: TripPlanWarning[];
}

/** Fields that may be changed on a timeline item. Entity facts remain immutable. */
export interface EditTripPlanItemInput {
  readonly dayNumber: number;
  readonly itemId: string;
  readonly description?: string;
  readonly recommendationReason?: string;
  readonly tips?: string[];
  readonly estimatedCostCny?: number;
}

/** Result of materialising a controlled edit as a new immutable ready version. */
export interface EditTripPlanResult {
  readonly tripId: string;
  readonly sourceVersion: number;
  readonly version: number;
  readonly status: 'ready';
  readonly plan: TripPlan;
  readonly summary: TripPlanVersionSummary;
}

/** Strict request for listing verified places that can replace one itinerary item. */
export interface ListTripPlanItemReplacementCandidatesInput {
  readonly sourceVersion: number;
  readonly dayNumber: number;
  readonly itemId: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/** A verified POI that the server allows as a concrete item replacement. */
export interface TripPlanItemReplacementCandidate {
  readonly place: Place;
  readonly recommendationReason: string;
  readonly distanceMetersFromOriginal?: number;
}

/** Candidate list returned as a strict paginated collection. */
export interface TripPlanItemReplacementCandidateList {
  readonly items: TripPlanItemReplacementCandidate[];
  readonly pagination: PaginationMeta;
}

/** Backwards-compatible descriptive alias used by list endpoints. */
export type TripPlanItemReplacementCandidateListResult = TripPlanItemReplacementCandidateList;

/** Strict request for replacing one concrete itinerary item's verified POI. */
export interface ReplaceTripPlanItemInput {
  readonly sourceVersion: number;
  readonly dayNumber: number;
  readonly itemId: string;
  readonly replacementPlaceId: string;
}

/** Complete immutable ready version returned after a concrete POI replacement. */
export interface ReplaceTripPlanItemResult {
  readonly tripId: string;
  readonly sourceVersion: number;
  readonly dayNumber: number;
  readonly itemId: string;
  readonly version: number;
  readonly status: 'ready';
  readonly plan: TripPlan;
  readonly summary: TripPlanVersionSummary;
}

/** Strict request for reordering every timeline item in one immutable ready day. */
export interface ReorderTripPlanItemsInput {
  readonly sourceVersion: number;
  readonly dayNumber: number;
  /** Complete item-id permutation for the target day. */
  readonly orderedItemIds: string[];
}

/** Complete immutable ready version returned after a same-day reorder. */
export interface ReorderTripPlanItemsResult {
  readonly tripId: string;
  readonly sourceVersion: number;
  readonly dayNumber: number;
  readonly version: number;
  readonly status: 'ready';
  readonly plan: TripPlan;
  readonly summary: TripPlanVersionSummary;
}

/** Strict request for automatically optimizing one day's concrete-place timeline. */
export interface OptimizeTripPlanDayInput {
  readonly sourceVersion: number;
  readonly dayNumber: number;
  readonly startItemId?: string;
  readonly endItemId?: string;
}

/** Complete immutable ready version returned after same-day route optimization. */
export interface OptimizeTripPlanDayResult {
  readonly tripId: string;
  readonly sourceVersion: number;
  readonly version: number;
  readonly dayNumber: number;
  readonly status: 'ready';
  readonly plan: TripPlan;
  readonly summary: TripPlanVersionSummary;
}

/** Input for the read-only audit of one saved optimization result. */
export interface GetTripPlanOptimizationAuditInput {
  readonly dayNumber: number;
  /** Optional source version used to verify the audit provenance. */
  readonly sourceVersion?: number;
}

/** One candidate considered by the nearest-neighbor decision. */
export interface TripPlanOptimizationCandidate {
  readonly destinationItemId: string;
  readonly status: 'available' | 'unavailable';
  readonly durationSeconds?: number;
  readonly distanceMeters?: number;
  readonly rejectionReason?: string;
}

/** One deterministic nearest-neighbor decision, in final order. */
export interface TripPlanOptimizationDecision {
  readonly step: number;
  readonly originItemId: string;
  readonly selectedDestinationItemId: string;
  readonly reason: RouteOrderDecisionReason;
  readonly candidates: TripPlanOptimizationCandidate[];
}

/** A persisted timeline fact compared with the source snapshot. */
export interface TripPlanOptimizationTimelineChange {
  readonly itemId: string;
  readonly previousStartTime: string;
  readonly previousEndTime: string;
  readonly nextStartTime: string;
  readonly nextEndTime: string;
  readonly routeStatus: 'available' | 'unavailable' | 'not_applicable';
  readonly routeDurationSeconds?: number;
  readonly routeDistanceMeters?: number;
}

/** Read-only, explainable replay of an already persisted optimization. */
export interface TripPlanOptimizationAuditResult {
  readonly tripId: string;
  readonly version: number;
  /** Ready source snapshot used to prove the before-times and provenance. */
  readonly sourceVersion: number;
  readonly dayNumber: number;
  readonly mode: RouteMode;
  readonly algorithm: 'nearest_neighbor';
  readonly isOptimal: false;
  readonly orderedItemIds: string[];
  readonly fixedStartItemId?: string;
  readonly fixedEndItemId?: string;
  readonly decisions: TripPlanOptimizationDecision[];
  readonly timelineChanges: TripPlanOptimizationTimelineChange[];
  readonly warnings: string[];
  readonly generatedAt: string;
}

/** Public names for the edit whitelist; values are intentionally not user-extensible. */
export const TRIP_PLAN_EDITABLE_DAY_FIELDS = ['summary', 'warnings'] as const;

export const TRIP_PLAN_EDITABLE_ITEM_FIELDS = [
  'description',
  'recommendationReason',
  'tips',
  'estimatedCostCny',
] as const;
