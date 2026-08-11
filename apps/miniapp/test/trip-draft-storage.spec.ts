import { describe, expect, it } from 'vitest';

import { createDefaultTripFormState, type TripFormState } from '../utils/trip-form';
import {
  createTripDraftStorage,
  TRIP_DRAFT_STORAGE_KEY,
  type StorageAdapter,
} from '../services/trip-draft-storage';

class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>();

  public get(key: string): string | undefined {
    return this.values.get(key);
  }

  public set(key: string, value: string): void {
    this.values.set(key, value);
  }

  public remove(key: string): void {
    this.values.delete(key);
  }

  public put(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const createState = (): TripFormState => ({
  ...createDefaultTripFormState(),
  cityName: '上海',
  startDate: '2026-03-01',
  endDate: '2026-03-03',
  preferences: ['food'],
});

describe('trip draft storage', () => {
  it('saves and restores a draft through an injected memory adapter', () => {
    const adapter = new MemoryStorageAdapter();
    const storage = createTripDraftStorage(adapter);
    const state = createState();

    storage.save(state);

    expect(adapter.get(TRIP_DRAFT_STORAGE_KEY)).toContain('"version":1');
    expect(storage.load()).toEqual(state);
  });

  it('clears a saved draft', () => {
    const adapter = new MemoryStorageAdapter();
    const storage = createTripDraftStorage(adapter);
    storage.save(createState());

    storage.clear();

    expect(adapter.get(TRIP_DRAFT_STORAGE_KEY)).toBeUndefined();
    expect(storage.load()).toEqual(createDefaultTripFormState());
  });

  it.each([
    'not-json',
    JSON.stringify({ version: 2, state: createState() }),
    JSON.stringify({ version: 1, state: { cityName: 123 } }),
    JSON.stringify({ version: 1, state: createState(), extra: true }),
  ])('falls back to the default state for a damaged draft', (value) => {
    const adapter = new MemoryStorageAdapter();
    adapter.put(TRIP_DRAFT_STORAGE_KEY, value);

    expect(createTripDraftStorage(adapter).load()).toEqual(createDefaultTripFormState());
  });
});
