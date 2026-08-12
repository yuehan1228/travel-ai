import { CreateTripInputSchema } from '@travel-guide/shared-schemas';
import type { CreateTripInput, TripDetail } from '@travel-guide/shared-types';

import { buildTripGeneratingUrl } from './trip-plan-view';
import { toCreateTripInput, type TripFormState } from './trip-form';

export interface TripSubmitDependencies {
  getAccessToken(): string | undefined;
  login(): Promise<unknown>;
  saveDraft(state: TripFormState): void;
  createTrip(input: CreateTripInput): Promise<Pick<TripDetail, 'id'>>;
  navigate(url: string): void;
}

export interface TripSubmitResult {
  readonly status: 'navigated' | 'ignored';
  readonly tripId?: string;
  /** Whether a usable access token was present after the optional login step. */
  readonly authenticated: boolean;
}

export interface TripSubmitController {
  submit(form: TripFormState): Promise<TripSubmitResult>;
  isSubmitting(): boolean;
}

/**
 * Coordinates only the home-page create flow. Generation is intentionally not
 * a dependency: it starts on the dedicated generation page after navigation.
 */
export const createTripSubmitController = (
  dependencies: TripSubmitDependencies,
): TripSubmitController => {
  let submitting = false;

  return {
    isSubmitting: () => submitting,
    submit: async (form): Promise<TripSubmitResult> => {
      if (submitting) {
        return { status: 'ignored', authenticated: false };
      }

      submitting = true;
      try {
        const token = dependencies.getAccessToken();
        if (token === undefined || token.trim().length === 0) {
          await dependencies.login();
        }

        const input = CreateTripInputSchema.parse(toCreateTripInput(form));
        dependencies.saveDraft(form);
        const trip = await dependencies.createTrip(input);
        dependencies.navigate(buildTripGeneratingUrl(trip.id));
        const accessToken = dependencies.getAccessToken();
        return {
          status: 'navigated',
          tripId: trip.id,
          authenticated: accessToken !== undefined && accessToken.trim().length > 0,
        };
      } finally {
        submitting = false;
      }
    },
  };
};
