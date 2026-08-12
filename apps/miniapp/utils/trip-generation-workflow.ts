import type { TripPlanGenerationResult } from '@travel-guide/shared-types';

import { isTripGenerationAuthFailure, type GenerationStageController } from './trip-generating';

export interface TripPlanGenerationWorkflowOptions {
  readonly controller: GenerationStageController;
  readonly generate: () => Promise<TripPlanGenerationResult>;
  readonly onReady: (result: TripPlanGenerationResult) => void;
  readonly onAuthRequired: () => void;
  readonly getErrorMessage: (error: unknown) => string;
  /** Return false once the owning page has been unloaded or otherwise disposed. */
  readonly isActive?: () => boolean;
}

/**
 * Run one generation request. The controller's start gate is the single-flight
 * guard, so a second click while the first request is pending never calls the
 * generator a second time.
 */
export const runTripPlanGeneration = async (
  options: TripPlanGenerationWorkflowOptions,
): Promise<boolean> => {
  if (options.isActive?.() === false) {
    return false;
  }
  if (!options.controller.start()) {
    return false;
  }

  try {
    const result = await options.generate();
    if (options.isActive?.() === false) {
      return false;
    }
    const state = options.controller.finish(result);
    if (state.status === 'ready') {
      options.onReady(result);
    }
    return true;
  } catch (error: unknown) {
    if (options.isActive?.() === false) {
      return false;
    }
    if (isTripGenerationAuthFailure(error)) {
      options.controller.requireAuth();
      options.onAuthRequired();
      return true;
    }

    options.controller.fail(options.getErrorMessage(error));
    return true;
  }
};
