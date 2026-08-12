import { describe, expect, it } from 'vitest';

import type { CreateTripInput } from '@travel-guide/shared-types';

import type { TripFormState } from '../utils/trip-form';
import { createTripSubmitController } from '../utils/trip-submit';

const tripId = '123e4567-e89b-12d3-a456-426614174000';

const form: TripFormState = {
  cityName: '杭州',
  cityCode: '',
  origin: '',
  startDate: '2026-08-12',
  endDate: '2026-08-14',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'moderate',
  budgetMode: 'none',
  budgetLevel: '',
  customBudgetText: '',
  transportPreference: 'public_transport',
  extraRequirements: '',
};

describe('home trip submission controller', () => {
  it('validates, creates and navigates without starting generation itself', async () => {
    const saved: TripFormState[] = [];
    const created: CreateTripInput[] = [];
    const navigated: string[] = [];
    let token: string | undefined;
    let loginCalls = 0;
    const controller = createTripSubmitController({
      getAccessToken: () => token,
      login: async () => {
        loginCalls += 1;
        token = 'token';
      },
      saveDraft: (state) => saved.push(state),
      createTrip: async (input) => {
        created.push(input);
        return { id: tripId };
      },
      navigate: (url) => navigated.push(url),
    });

    await expect(controller.submit(form)).resolves.toEqual({
      status: 'navigated',
      tripId,
      authenticated: true,
    });
    expect(saved).toEqual([form]);
    expect(created).toHaveLength(1);
    expect(navigated).toEqual([`/pages/trip-generating/index?tripId=${tripId}`]);
    expect(loginCalls).toBe(1);
  });

  it('does not navigate when createTrip fails and leaves the draft saved', async () => {
    const saved: TripFormState[] = [];
    const navigated: string[] = [];
    const controller = createTripSubmitController({
      getAccessToken: () => 'token',
      login: async () => undefined,
      saveDraft: (state) => saved.push(state),
      createTrip: async () => {
        throw new Error('create failed');
      },
      navigate: (url) => navigated.push(url),
    });

    await expect(controller.submit(form)).rejects.toThrow('create failed');
    expect(saved).toHaveLength(1);
    expect(navigated).toEqual([]);
    expect(controller.isSubmitting()).toBe(false);
  });

  it('ignores a duplicate submit while the first request is in flight', async () => {
    let releaseCreate: ((value: { id: string }) => void) | undefined;
    let createCalls = 0;
    const controller = createTripSubmitController({
      getAccessToken: () => 'token',
      login: async () => undefined,
      saveDraft: () => undefined,
      createTrip: () => {
        createCalls += 1;
        return new Promise((resolve) => {
          releaseCreate = resolve;
        });
      },
      navigate: () => undefined,
    });

    const first = controller.submit(form);
    await expect(controller.submit(form)).resolves.toEqual({
      status: 'ignored',
      authenticated: false,
    });
    expect(controller.isSubmitting()).toBe(true);
    releaseCreate?.({ id: tripId });
    await expect(first).resolves.toMatchObject({ status: 'navigated' });
    expect(createCalls).toBe(1);
  });
});
