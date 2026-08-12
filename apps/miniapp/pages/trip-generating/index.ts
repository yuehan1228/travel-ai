import type { TripPlanGenerationResult } from '@travel-guide/shared-types';

import { authService } from '../../services/auth.service';
import { tripPlanService } from '../../services/trip-plan.service';
import {
  createTripGeneratingState,
  createGenerationStageController,
  TRIP_GENERATION_PHASES,
  type GenerationStageController,
  type TripGeneratingState,
} from '../../utils/trip-generating';
import { runTripPlanGeneration } from '../../utils/trip-generation-workflow';
import {
  buildTripPlanUrl,
  getTripPlanUserMessage,
  parseTripPlanRouteParams,
} from '../../utils/trip-plan-view';

interface TripGeneratingRouteOptions {
  tripId?: string;
  [key: string]: unknown;
}

interface TripGeneratingPageData {
  tripId: string;
  status: TripGeneratingState['status'];
  phaseIndex: number;
  phaseMessage: string;
  isGenerating: boolean;
  errorMessage: string;
  authRequired: boolean;
}

const generationControllers = new WeakMap<
  PageInstance<TripGeneratingPageData>,
  GenerationStageController
>();

const applyState = (
  page: PageInstance<TripGeneratingPageData>,
  state: TripGeneratingState,
): void => {
  page.setData({
    status: state.status,
    phaseIndex: state.phaseIndex,
    phaseMessage: state.phaseMessage,
    isGenerating: state.status === 'generating',
    errorMessage: state.errorMessage,
    authRequired: state.status === 'auth-required',
  });
};

const navigateToPlan = (result: TripPlanGenerationResult): void => {
  if (result.status !== 'ready' || result.plan === undefined) {
    return;
  }
  wx.navigateTo({ url: buildTripPlanUrl(result.tripId, result.version) });
};

const generateForPage = async (page: PageInstance<TripGeneratingPageData>): Promise<void> => {
  const controller = generationControllers.get(page);
  if (controller === undefined || page.data.tripId.length === 0) {
    return;
  }

  await runTripPlanGeneration({
    controller,
    generate: () => tripPlanService.generateTripPlan(page.data.tripId, {}),
    onReady: (result) => {
      if (generationControllers.has(page)) {
        navigateToPlan(result);
      }
    },
    onAuthRequired: () => {
      if (generationControllers.has(page)) {
        setPageAuthRequired(page);
      }
    },
    getErrorMessage: getTripPlanUserMessage,
    isActive: () => generationControllers.has(page),
  });
};

const setPageAuthRequired = (page: PageInstance<TripGeneratingPageData>): void => {
  page.setData({ authRequired: true });
};

Page<TripGeneratingPageData>({
  data: {
    tripId: '',
    status: 'idle',
    phaseIndex: 0,
    phaseMessage: TRIP_GENERATION_PHASES[0],
    isGenerating: false,
    errorMessage: '',
    authRequired: false,
  },

  onLoad(this: PageInstance<TripGeneratingPageData>, options: TripGeneratingRouteOptions): void {
    try {
      const route = parseTripPlanRouteParams(options);
      const controller = createGenerationStageController(route.tripId, {
        onStateChange: (state) => {
          if (generationControllers.has(this)) {
            applyState(this, state);
          }
        },
      });
      generationControllers.set(this, controller);
      this.setData({ tripId: route.tripId, errorMessage: '', authRequired: false });
      void generateForPage(this);
    } catch {
      applyState(this, {
        ...createTripGeneratingState(''),
        status: 'failed',
        errorMessage: '页面参数无效，请返回重新开始。',
      });
    }
  },

  onRetry(this: PageInstance<TripGeneratingPageData>): void {
    if (this.data.isGenerating || this.data.tripId.length === 0) {
      return;
    }
    void generateForPage(this);
  },

  async onAuthAndRetry(this: PageInstance<TripGeneratingPageData>): Promise<void> {
    if (this.data.isGenerating || this.data.tripId.length === 0) {
      return;
    }

    try {
      await authService.login();
      if (!generationControllers.has(this)) {
        return;
      }
      this.setData({ authRequired: false, errorMessage: '' });
      await generateForPage(this);
    } catch (error: unknown) {
      generationControllers.get(this)?.fail(getTripPlanUserMessage(error));
    }
  },

  onUnload(this: PageInstance<TripGeneratingPageData>): void {
    const controller = generationControllers.get(this);
    controller?.clear();
    generationControllers.delete(this);
  },
});
