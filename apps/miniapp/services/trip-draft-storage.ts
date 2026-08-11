import { IsoDateSchema } from '@travel-guide/shared-schemas';
import {
  BUDGET_LEVELS,
  TRAVEL_PACES,
  TRAVEL_PREFERENCES,
  TRANSPORT_PREFERENCES,
} from '@travel-guide/shared-types';
import { z } from 'zod';

import { createDefaultTripFormState, type TripFormState } from '../utils/trip-form';

export const TRIP_DRAFT_STORAGE_KEY = 'travel-guide:trip-draft:v1';
const TRIP_DRAFT_VERSION = 1;

export interface StorageAdapter {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const wxStorageAdapter: StorageAdapter = {
  get: (key: string): string | undefined => {
    try {
      const value = wx.getStorageSync(key);
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  },
  set: (key: string, value: string): void => {
    wx.setStorageSync(key, value);
  },
  remove: (key: string): void => {
    wx.removeStorageSync(key);
  },
};

const emptyOrIsoDateSchema = z.union([z.literal(''), IsoDateSchema]);
export const TripFormStateSchema = z
  .object({
    cityName: z.string().max(100),
    cityCode: z.string().max(20),
    origin: z.string().max(100),
    startDate: emptyOrIsoDateSchema,
    endDate: emptyOrIsoDateSchema,
    travelerCount: z.number().finite().int().min(1).max(20),
    preferences: z
      .array(z.enum(TRAVEL_PREFERENCES))
      .max(TRAVEL_PREFERENCES.length)
      .refine((preferences) => new Set(preferences).size === preferences.length),
    pace: z.union([z.literal(''), z.enum(TRAVEL_PACES)]),
    budgetMode: z.enum(['none', 'level', 'custom']),
    budgetLevel: z.union([z.literal(''), z.enum(BUDGET_LEVELS)]),
    customBudgetText: z.string().max(100),
    transportPreference: z.union([z.literal(''), z.enum(TRANSPORT_PREFERENCES)]),
    extraRequirements: z.string().max(1000),
  })
  .strict();

const tripDraftEnvelopeSchema = z
  .object({
    version: z.literal(TRIP_DRAFT_VERSION),
    state: TripFormStateSchema,
  })
  .strict();

export interface TripDraftStorage {
  save(state: TripFormState): void;
  load(): TripFormState;
  clear(): void;
}

export const createTripDraftStorage = (
  adapter: StorageAdapter = wxStorageAdapter,
  defaultState: () => TripFormState = createDefaultTripFormState,
): TripDraftStorage => ({
  save: (state: TripFormState): void => {
    const parsedState = TripFormStateSchema.safeParse(state);
    if (!parsedState.success) {
      throw new Error('Invalid trip draft');
    }

    adapter.set(
      TRIP_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: TRIP_DRAFT_VERSION, state: parsedState.data }),
    );
  },

  load: (): TripFormState => {
    let serializedDraft: string | undefined;
    try {
      serializedDraft = adapter.get(TRIP_DRAFT_STORAGE_KEY);
    } catch {
      return defaultState();
    }
    if (serializedDraft === undefined) {
      return defaultState();
    }

    try {
      const parsedJson: unknown = JSON.parse(serializedDraft);
      const parsedDraft = tripDraftEnvelopeSchema.safeParse(parsedJson);
      return parsedDraft.success ? parsedDraft.data.state : defaultState();
    } catch {
      return defaultState();
    }
  },

  clear: (): void => {
    adapter.remove(TRIP_DRAFT_STORAGE_KEY);
  },
});

export const saveTripDraft = (
  state: TripFormState,
  adapter: StorageAdapter = wxStorageAdapter,
): void => {
  createTripDraftStorage(adapter).save(state);
};

export const loadTripDraft = (
  adapter: StorageAdapter = wxStorageAdapter,
  defaultState: () => TripFormState = createDefaultTripFormState,
): TripFormState => createTripDraftStorage(adapter, defaultState).load();

export const clearTripDraft = (adapter: StorageAdapter = wxStorageAdapter): void => {
  createTripDraftStorage(adapter).clear();
};
