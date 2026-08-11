import { describe, expect, it } from 'vitest';

import { TripPlanSchema } from '@travel-guide/shared-schemas';
import type { CreateTripInput, Place, TripPlan, TripPlanItem } from '@travel-guide/shared-types';

import {
  createTestLlmEnvironment,
  FakeLLMProvider,
  TripPlanException,
  TripPlanGenerationService,
  MAX_MODEL_CANDIDATE_PLACES,
} from '../src/modules/trip-plan';
import type { TripPlanGenerationContext } from '../src/modules/trip-plan';

const UUID = (index: number): string =>
  `123e4567-e89b-12d3-a456-42661417${String(index).padStart(4, '0')}`;

const place = (index: number): Place => ({
  id: UUID(index),
  provider: 'fake-map',
  providerPlaceId: `place-${index}`,
  name: `候选地点 ${index}`,
  category: 'attraction',
  categoryText: '景点',
  address: '杭州市西湖区',
  location: { longitude: 120.15 + index / 10_000, latitude: 30.25 + index / 10_000 },
  rating: 4.5,
  openingHours: '08:00-18:00',
  verifiedAt: '2026-08-11T00:00:00.000Z',
  dataSource: 'cache',
});

const weather = (date: string) => ({
  date,
  condition: 'clear' as const,
  conditionText: '晴',
  minTemperatureC: 20,
  maxTemperatureC: 30,
  precipitationProbability: 10,
  source: 'forecast' as const,
  isReference: false,
});

const climateWeather = (date: string) => ({
  date,
  condition: 'clear' as const,
  conditionText: '历史晴天参考',
  minTemperatureC: 20,
  maxTemperatureC: 30,
  precipitationProbability: 10,
  source: 'climate_reference' as const,
  isReference: true,
});

const input: CreateTripInput = {
  destination: { cityName: '杭州' },
  startDate: '2026-08-12',
  endDate: '2026-08-14',
  travelerCount: 2,
  preferences: ['nature'],
  pace: 'relaxed' as const,
  transportPreference: 'walk_and_public_transport' as const,
};

const context = (): TripPlanGenerationContext => ({
  tripId: UUID(900),
  input,
  weather: [weather('2026-08-12'), weather('2026-08-13'), weather('2026-08-14')],
  candidatePlaces: Array.from({ length: 31 }, (_, index) => place(index + 1)),
  routeEstimates: [],
  generatedAt: '2026-08-11T00:00:00.000Z',
});

const validPlan = (generationContext: TripPlanGenerationContext): TripPlan => {
  const selectedPlace = generationContext.candidatePlaces[0]!;
  const item = {
    id: UUID(950),
    type: 'attraction' as const,
    startTime: '09:00',
    endTime: '10:00',
    name: selectedPlace.name,
    description: '一段由 AI 生成的说明。',
    recommendationReason: '符合偏好。',
    place: selectedPlace,
    estimatedCostCny: 100,
    tips: ['提前查看开放信息'],
    dataSources: ['map_provider', 'ai_generated'] as TripPlanItem['dataSources'],
  };
  const emptyItem = {
    id: UUID(951),
    type: 'rest' as const,
    startTime: '09:00',
    endTime: '10:00',
    name: '自由活动',
    description: '适度休息。',
    recommendationReason: '保持轻松节奏。',
    estimatedCostCny: 0,
    tips: [],
    dataSources: ['ai_generated'] as TripPlanItem['dataSources'],
  };
  return {
    schemaVersion: '1.0',
    tripId: generationContext.tripId,
    cityName: generationContext.input.destination.cityName,
    startDate: generationContext.input.startDate,
    endDate: generationContext.input.endDate,
    travelerCount: generationContext.input.travelerCount,
    summary: '轻松安排。',
    days: [
      {
        dayNumber: 1,
        date: '2026-08-12',
        summary: '第一天',
        weather: generationContext.weather[0]!,
        items: [item],
        estimatedCostCny: 100,
        warnings: [],
      },
      {
        dayNumber: 2,
        date: '2026-08-13',
        summary: '第二天',
        weather: generationContext.weather[1]!,
        items: [emptyItem],
        estimatedCostCny: 0,
        warnings: [],
      },
      {
        dayNumber: 3,
        date: '2026-08-14',
        summary: '第三天',
        weather: generationContext.weather[2]!,
        items: [],
        estimatedCostCny: 0,
        warnings: [],
      },
    ],
    hotelRecommendations: [],
    foodRecommendations: [],
    budget: {
      currency: 'CNY',
      totalCny: 100,
      accommodationCny: 0,
      transportationCny: 0,
      foodCny: 0,
      attractionsCny: 100,
      otherCny: 0,
    },
    transportationTips: [],
    generalTips: ['预留休息时间'],
    generatedAt: generationContext.generatedAt,
  };
};

describe('TripPlanGenerationService', () => {
  it('calls a fake provider once and truncates candidate POIs deterministically', async () => {
    const generationContext = context();
    const plan = validPlan(generationContext);
    const provider = new FakeLLMProvider(() => plan);
    const service = new TripPlanGenerationService(provider, createTestLlmEnvironment());

    await expect(service.generate(generationContext)).resolves.toEqual(plan);
    expect(provider.calls).toBe(1);
    expect(provider.lastInput?.userPrompt).toContain('候选地点 1');
    expect(provider.lastInput?.userPrompt).not.toContain('候选地点 31');
    expect(provider.lastInput?.userPrompt).toContain(`"place-${MAX_MODEL_CANDIDATE_PLACES}"`);
  });

  it('rejects an empty verified POI allowlist without calling the provider', async () => {
    const generationContext = { ...context(), candidatePlaces: [] };
    const provider = new FakeLLMProvider(() => validPlan(context()));
    const service = new TripPlanGenerationService(provider, createTestLlmEnvironment());

    await expect(service.generate(generationContext)).rejects.toMatchObject({
      code: 'TRIP_PLAN_UNAVAILABLE',
    });
    expect(provider.calls).toBe(0);
  });

  it('rejects a context with a missing weather date before calling the provider', async () => {
    const generationContext = {
      ...context(),
      weather: [weather('2026-08-12'), weather('2026-08-13')],
    };
    const provider = new FakeLLMProvider(() => validPlan(context()));
    const service = new TripPlanGenerationService(provider, createTestLlmEnvironment());

    await expect(service.generate(generationContext)).rejects.toMatchObject({
      code: 'TRIP_PLAN_VALIDATION_ERROR',
    });
    expect(provider.calls).toBe(0);
  });

  it('keeps arbitrary point ids but drops route orders that reference a truncated POI', async () => {
    const selected = context().candidatePlaces[0]!;
    const second = context().candidatePlaces[1]!;
    const truncated = context().candidatePlaces[30]!;
    const routeEstimate = {
      origin: { location: selected.location, placeId: selected.id },
      destination: { location: second.location, placeId: second.id },
      mode: 'walking' as const,
      dataSource: 'map_provider' as const,
      provider: 'fake-route',
      fetchedAt: '2026-08-11T00:00:00.000Z',
      distanceMeters: 900,
      durationSeconds: 500,
    };
    const allowedRouteOrder = {
      orderedPointIds: ['a', 'b'],
      legs: [
        {
          originId: 'a',
          destinationId: 'b',
          estimate: routeEstimate,
        },
      ],
      totalDistanceMeters: 900,
      totalDurationSeconds: 500,
      mode: 'walking' as const,
      algorithm: 'nearest_neighbor' as const,
      isOptimal: false as const,
      generatedAt: '2026-08-11T00:00:00.000Z',
      warnings: [],
    };
    const truncatedRouteOrder = {
      orderedPointIds: ['a', 'c'],
      legs: [
        {
          originId: 'a',
          destinationId: 'c',
          estimate: {
            origin: { location: selected.location, placeId: selected.id },
            destination: { location: truncated.location, placeId: truncated.id },
            mode: 'walking' as const,
            dataSource: 'map_provider' as const,
            provider: 'fake-route',
            fetchedAt: '2026-08-11T00:00:00.000Z',
            distanceMeters: 1_000,
            durationSeconds: 600,
          },
        },
      ],
      totalDistanceMeters: 1_000,
      totalDurationSeconds: 600,
      mode: 'walking' as const,
      algorithm: 'nearest_neighbor' as const,
      isOptimal: false as const,
      generatedAt: '2026-08-11T00:00:00.000Z',
      warnings: [],
    };
    const generationContext = {
      ...context(),
      routeEstimates: [routeEstimate, truncatedRouteOrder.legs[0]!.estimate],
      routeOrders: [allowedRouteOrder, truncatedRouteOrder],
    };
    const provider = new FakeLLMProvider(() => validPlan(generationContext));
    const service = new TripPlanGenerationService(provider, createTestLlmEnvironment());

    await expect(service.generate(generationContext)).resolves.toBeDefined();
    expect(provider.lastInput?.userPrompt).toContain('"a"');
    expect(provider.lastInput?.userPrompt).toContain('"b"');
    expect(provider.lastInput?.userPrompt).not.toContain('place-31');
    expect(provider.lastInput?.userPrompt).not.toContain(truncated.id);
  });

  it('rejects a changed real Place field as an entity mismatch', async () => {
    const generationContext = context();
    const plan = validPlan(generationContext);
    const canonicalPlace = generationContext.candidatePlaces[0]!;
    const changed = {
      ...plan,
      days: [
        {
          ...plan.days[0]!,
          items: [
            {
              ...plan.days[0]!.items[0]!,
              place: {
                ...canonicalPlace,
                address: '伪造地址',
                location: {
                  longitude: canonicalPlace.location.longitude + 0.1,
                  latitude: canonicalPlace.location.latitude,
                },
                rating: 1,
                openingHours: '00:00-00:01',
              },
            },
          ],
        },
        ...plan.days.slice(1),
      ],
    };
    const provider = new FakeLLMProvider(() => changed);
    const service = new TripPlanGenerationService(provider, createTestLlmEnvironment());

    await expect(service.generate(generationContext)).rejects.toMatchObject({
      code: 'TRIP_PLAN_ENTITY_MISMATCH',
    });
  });

  it('rejects changed weather and route facts, including unavailable route output', async () => {
    const generationContext = context();
    const route = {
      origin: {
        location: generationContext.candidatePlaces[0]!.location,
        placeId: generationContext.candidatePlaces[0]!.id,
      },
      destination: {
        location: generationContext.candidatePlaces[1]!.location,
        placeId: generationContext.candidatePlaces[1]!.id,
      },
      mode: 'walking' as const,
      dataSource: 'map_provider' as const,
      provider: 'fake-route',
      fetchedAt: '2026-08-11T00:00:00.000Z',
      distanceMeters: 1_000,
      durationSeconds: 600,
    };
    const withRouteContext = { ...generationContext, routeEstimates: [route] };
    const routePlan = validPlan(withRouteContext);
    routePlan.days[0]!.items[0]!.route = route;
    routePlan.days[0]!.items[0]!.dataSources = ['route_provider', 'map_provider', 'ai_generated'];
    const changedRoute = {
      ...routePlan,
      days: [
        {
          ...routePlan.days[0]!,
          items: [
            {
              ...routePlan.days[0]!.items[0]!,
              route: { ...route, durationSeconds: 601 },
            },
          ],
        },
        ...routePlan.days.slice(1),
      ],
    };
    const changedWeather = {
      ...validPlan(generationContext),
      days: [
        {
          ...validPlan(generationContext).days[0]!,
          weather: { ...generationContext.weather[0]!, condition: 'rain' as const },
        },
        ...validPlan(generationContext).days.slice(1),
      ],
    };

    await expect(
      new TripPlanGenerationService(
        new FakeLLMProvider(() => changedRoute),
        createTestLlmEnvironment(),
      ).generate(withRouteContext),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_ENTITY_MISMATCH' });
    await expect(
      new TripPlanGenerationService(
        new FakeLLMProvider(() => routePlan),
        createTestLlmEnvironment(),
      ).generate(generationContext),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_ENTITY_MISMATCH' });
    await expect(
      new TripPlanGenerationService(
        new FakeLLMProvider(() => changedWeather),
        createTestLlmEnvironment(),
      ).generate(generationContext),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_ENTITY_MISMATCH' });

    const unavailableRoute = {
      ...route,
      dataSource: 'unavailable' as const,
      distanceMeters: undefined,
      durationSeconds: undefined,
    };
    const unavailablePlan = {
      ...validPlan(generationContext),
      days: [
        {
          ...validPlan(generationContext).days[0]!,
          items: [
            {
              ...validPlan(generationContext).days[0]!.items[0]!,
              type: 'transport' as const,
              name: '交通',
              place: undefined,
              route: unavailableRoute,
              dataSources: ['ai_generated'],
            },
          ],
        },
        ...validPlan(generationContext).days.slice(1),
      ],
    };
    await expect(
      new TripPlanGenerationService(
        new FakeLLMProvider(() => unavailablePlan),
        createTestLlmEnvironment(),
      ).generate(generationContext),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_OUTPUT_INVALID' });

    const unavailableWeatherContext = {
      ...generationContext,
      weather: [
        {
          ...generationContext.weather[0]!,
          source: 'unavailable' as const,
          condition: 'unknown' as const,
          minTemperatureC: 1,
        },
        ...generationContext.weather.slice(1),
      ],
    };
    const unavailableWeatherProvider = new FakeLLMProvider(() => validPlan(generationContext));
    await expect(
      new TripPlanGenerationService(
        unavailableWeatherProvider,
        createTestLlmEnvironment(),
      ).generate(unavailableWeatherContext),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_VALIDATION_ERROR' });
    expect(unavailableWeatherProvider.calls).toBe(0);
  });

  it('preserves climate reference weather only with an explicit warning', async () => {
    const generationContext = {
      ...context(),
      weather: [
        climateWeather('2026-08-12'),
        climateWeather('2026-08-13'),
        climateWeather('2026-08-14'),
      ],
    };
    const plan = validPlan(generationContext);
    plan.days[0]!.warnings = [
      {
        code: 'WEATHER_CLIMATE_REFERENCE',
        severity: 'warning',
        message: '天气为历史气候参考，不是准确预报。',
        dayNumber: 1,
      },
    ];
    await expect(
      new TripPlanGenerationService(
        new FakeLLMProvider(() => plan),
        createTestLlmEnvironment(),
      ).generate(generationContext),
    ).resolves.toEqual(plan);

    const withoutWarning = {
      ...plan,
      days: [{ ...plan.days[0]!, warnings: [] }, ...plan.days.slice(1)],
    };
    await expect(
      new TripPlanGenerationService(
        new FakeLLMProvider(() => withoutWarning),
        createTestLlmEnvironment(),
      ).generate(generationContext),
    ).rejects.toMatchObject({ code: 'TRIP_PLAN_OUTPUT_INVALID' });
  });

  it('maps invalid structured output and context validation to stable errors', async () => {
    const generationContext = context();
    const invalidOutput = { ...validPlan(generationContext), unknown: true };
    const provider = new FakeLLMProvider(() => invalidOutput);
    const service = new TripPlanGenerationService(provider, createTestLlmEnvironment());

    await expect(service.generate(generationContext)).rejects.toMatchObject({
      code: 'TRIP_PLAN_OUTPUT_INVALID',
    });
    await expect(service.generate({ ...generationContext, tripId: 'not-a-uuid' })).rejects.toThrow(
      TripPlanException,
    );
  });

  it('keeps the final result under the shared strict schema', async () => {
    const generationContext = context();
    const plan = validPlan(generationContext);
    const provider = new FakeLLMProvider(() => plan);
    const service = new TripPlanGenerationService(provider, createTestLlmEnvironment());

    const result = await service.generateTripPlan(generationContext);
    expect(TripPlanSchema.safeParse(result).success).toBe(true);
  });
});
