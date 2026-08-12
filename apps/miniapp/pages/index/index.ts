import type { HealthResponse } from '@travel-guide/shared-types';
import {
  BUDGET_LEVEL_OPTIONS,
  TRAVEL_PACE_OPTIONS,
  TRAVEL_PREFERENCE_OPTIONS,
  TRANSPORT_PREFERENCE_OPTIONS,
  type TripOption,
} from '../../utils/trip-options';
import {
  canSubmitTripForm,
  createDefaultTripFormState,
  isTripBudgetLevel,
  isTripBudgetMode,
  type TripFormErrors,
  type TripFormField,
  type TripFormState,
  type TripBudgetMode,
  TripFormValidationError,
} from '../../utils/trip-form';
import { createTripDraftStorage, type TripDraftStorage } from '../../services/trip-draft-storage';
import { getAuthUserMessage, getRequestUserMessage } from '../../services/request-error';
import { healthService } from '../../services/health.service';
import { authService } from '../../services/auth.service';
import { tripService } from '../../services/trip.service';
import { createTripSubmitController } from '../../utils/trip-submit';

interface MiniAppGlobalData {
  environment: string;
}

type HealthCheckState = 'idle' | 'loading' | 'success' | 'error';

interface ValueChangeEvent {
  detail: {
    value: string;
  };
}

interface ValuesChangeEvent {
  detail: {
    value: string[];
  };
}

interface SelectableOption<TValue extends string> extends TripOption<TValue> {
  checked: boolean;
}

interface IndexPageData {
  projectName: string;
  environment: string;
  status: HealthCheckState;
  isLoading: boolean;
  serviceStatus: string;
  errorMessage: string;
  form: TripFormState;
  fieldErrors: TripFormErrors;
  isSubmitting: boolean;
  submitMessage: string;
  submitError: string;
  isLoggedIn: boolean;
  isAuthLoading: boolean;
  authError: string;
  preferenceOptions: SelectableOption<string>[];
  paceOptions: TripOption<string>[];
  budgetOptions: TripOption<string>[];
  transportOptions: TripOption<string>[];
}

const app = getApp<MiniAppGlobalData>();
const draftStorage: TripDraftStorage = createTripDraftStorage();
const tripSubmitController = createTripSubmitController({
  getAccessToken: () => authService.getAccessToken(),
  login: () => authService.login(),
  saveDraft: (state) => draftStorage.save(state),
  createTrip: (input) => tripService.createTrip(input),
  navigate: (url) => wx.navigateTo({ url }),
});

const getSelectablePreferenceOptions = (
  selected: TripFormState['preferences'],
): SelectableOption<string>[] =>
  TRAVEL_PREFERENCE_OPTIONS.map((option) => ({
    ...option,
    checked: selected.some((value) => value === option.value),
  }));

const updateForm = (
  page: PageInstance<IndexPageData>,
  changes: Partial<TripFormState>,
  clearField?: TripFormField | readonly TripFormField[],
): void => {
  const form = { ...page.data.form, ...changes };
  const fieldErrors = { ...page.data.fieldErrors };
  const fieldsToClear =
    clearField === undefined ? [] : typeof clearField === 'string' ? [clearField] : clearField;
  for (const field of fieldsToClear) {
    delete fieldErrors[field];
  }

  page.setData({
    form,
    fieldErrors,
    preferenceOptions: getSelectablePreferenceOptions(form.preferences),
  });
};

const getDraftOrDefault = (): TripFormState => draftStorage.load();

Page<IndexPageData>({
  data: {
    projectName: 'AI 智能旅游攻略',
    environment: app.globalData.environment,
    status: 'idle',
    isLoading: false,
    serviceStatus: '',
    errorMessage: '',
    form: createDefaultTripFormState(),
    fieldErrors: {},
    isSubmitting: false,
    submitMessage: '',
    submitError: '',
    isLoggedIn: authService.getCurrentUser() !== undefined,
    isAuthLoading: false,
    authError: '',
    preferenceOptions: getSelectablePreferenceOptions([]),
    paceOptions: TRAVEL_PACE_OPTIONS,
    budgetOptions: BUDGET_LEVEL_OPTIONS,
    transportOptions: TRANSPORT_PREFERENCE_OPTIONS,
  },

  onLoad(this: PageInstance<IndexPageData>): void {
    const form = getDraftOrDefault();
    this.setData({
      form,
      preferenceOptions: getSelectablePreferenceOptions(form.preferences),
      isLoggedIn: authService.getCurrentUser() !== undefined,
    });
  },

  async onAuthAction(this: PageInstance<IndexPageData>): Promise<void> {
    if (this.data.isAuthLoading) {
      return;
    }

    if (this.data.isLoggedIn) {
      authService.logout();
      this.setData({ isLoggedIn: false, authError: '' });
      return;
    }

    this.setData({ isAuthLoading: true, authError: '' });
    try {
      await authService.login();
      this.setData({ isLoggedIn: true, isAuthLoading: false, authError: '' });
    } catch (error: unknown) {
      this.setData({
        isLoggedIn: false,
        isAuthLoading: false,
        authError: getAuthUserMessage(error),
      });
    }
  },

  onCityNameInput(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    updateForm(this, { cityName: event.detail.value }, 'cityName');
  },

  onCityCodeInput(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    updateForm(this, { cityCode: event.detail.value }, 'cityCode');
  },

  onOriginInput(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    updateForm(this, { origin: event.detail.value }, 'origin');
  },

  onStartDateChange(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    updateForm(this, { startDate: event.detail.value }, 'startDate');
  },

  onEndDateChange(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    updateForm(this, { endDate: event.detail.value }, 'endDate');
  },

  onTravelerDecrease(this: PageInstance<IndexPageData>): void {
    if (this.data.form.travelerCount <= 1) {
      return;
    }

    updateForm(this, { travelerCount: this.data.form.travelerCount - 1 }, 'travelerCount');
  },

  onTravelerIncrease(this: PageInstance<IndexPageData>): void {
    if (this.data.form.travelerCount >= 20) {
      return;
    }

    updateForm(this, { travelerCount: this.data.form.travelerCount + 1 }, 'travelerCount');
  },

  onPreferencesChange(this: PageInstance<IndexPageData>, event: ValuesChangeEvent): void {
    const preferences = event.detail.value.filter(
      (value): value is TripFormState['preferences'][number] =>
        TRAVEL_PREFERENCE_OPTIONS.some((option) => option.value === value),
    );
    updateForm(this, { preferences }, 'preferences');
  },

  onPaceChange(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    const pace = TRAVEL_PACE_OPTIONS.find((option) => option.value === event.detail.value)?.value;
    if (pace === undefined) {
      return;
    }

    updateForm(this, { pace }, 'pace');
  },

  onBudgetModeChange(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    if (!isTripBudgetMode(event.detail.value)) {
      return;
    }

    const budgetMode: TripBudgetMode = event.detail.value;
    updateForm(this, { budgetMode }, ['budget', 'customBudgetText']);
  },

  onBudgetLevelChange(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    if (!isTripBudgetLevel(event.detail.value)) {
      return;
    }

    updateForm(this, { budgetLevel: event.detail.value }, 'budget');
  },

  onCustomBudgetInput(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    updateForm(this, { customBudgetText: event.detail.value }, 'customBudgetText');
  },

  onTransportChange(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    const transportPreference = TRANSPORT_PREFERENCE_OPTIONS.find(
      (option) => option.value === event.detail.value,
    )?.value;
    if (transportPreference === undefined) {
      return;
    }

    updateForm(this, { transportPreference }, 'transportPreference');
  },

  onExtraRequirementsInput(this: PageInstance<IndexPageData>, event: ValueChangeEvent): void {
    updateForm(this, { extraRequirements: event.detail.value }, 'extraRequirements');
  },

  async onSubmitTrip(this: PageInstance<IndexPageData>): Promise<void> {
    if (!canSubmitTripForm(this.data.isSubmitting)) {
      return;
    }

    this.setData({
      isSubmitting: true,
      submitMessage: '',
      submitError: '',
      fieldErrors: {},
    });

    const authAttempted =
      authService.getAccessToken() === undefined || authService.getAccessToken()?.trim() === '';
    if (authAttempted) {
      this.setData({ isAuthLoading: true, authError: '' });
    }

    try {
      // Keep the local draft even when creation or generation fails so the user can retry.
      const submission = await tripSubmitController.submit(this.data.form);
      if (submission.status === 'ignored') {
        this.setData({ isSubmitting: false, isAuthLoading: false });
        return;
      }
      this.setData({
        isSubmitting: false,
        isAuthLoading: false,
        isLoggedIn: submission.authenticated,
        submitMessage: '',
        submitError: '',
      });
    } catch (error: unknown) {
      if (error instanceof TripFormValidationError) {
        this.setData({
          isSubmitting: false,
          isAuthLoading: false,
          fieldErrors: error.errors,
        });
        return;
      }

      if (authAttempted && authService.getAccessToken() === undefined) {
        this.setData({
          isSubmitting: false,
          isAuthLoading: false,
          authError: getAuthUserMessage(error),
        });
        return;
      }

      this.setData({
        isSubmitting: false,
        isAuthLoading: false,
        isLoggedIn: authService.getCurrentUser() !== undefined,
        submitError: '暂时无法保存旅行需求，请稍后重试',
      });
    }
  },

  onClearDraft(this: PageInstance<IndexPageData>): void {
    if (this.data.isSubmitting) {
      return;
    }

    try {
      draftStorage.clear();
      const form = createDefaultTripFormState();
      this.setData({
        form,
        fieldErrors: {},
        submitMessage: '本地草稿已清除',
        submitError: '',
        preferenceOptions: getSelectablePreferenceOptions(form.preferences),
      });
    } catch {
      this.setData({ submitError: '暂时无法清除草稿，请稍后重试' });
    }
  },

  async onCheckHealth(this: PageInstance<IndexPageData>): Promise<void> {
    if (this.data.isLoading) {
      return;
    }

    this.setData({
      status: 'loading',
      isLoading: true,
      serviceStatus: '',
      errorMessage: '',
    });

    try {
      const health: HealthResponse = await healthService.getHealth();
      this.setData({
        status: 'success',
        isLoading: false,
        serviceStatus: `服务正常（${health.environment}）`,
      });
    } catch (error: unknown) {
      this.setData({
        status: 'error',
        isLoading: false,
        errorMessage: getRequestUserMessage(error),
      });
    }
  },
});
