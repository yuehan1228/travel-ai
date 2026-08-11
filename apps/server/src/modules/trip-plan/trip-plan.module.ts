import { DynamicModule, Module } from '@nestjs/common';

import {
  createTestLlmEnvironment,
  loadLlmEnvironment,
  type LlmEnvironment,
} from './config/llm-environment';
import { LLM_ENVIRONMENT, LLM_FETCH } from './config/tokens';
import { OpenAICompatibleLLMProvider, type LLMFetch, type LLMProvider } from './providers';
import { TripPlanGenerationService } from './trip-plan-generation.service';
import { TRIP_PLAN_LLM_PROVIDER } from './trip-plan.tokens';

export interface TripPlanModuleOptions {
  readonly llmEnvironment?: LlmEnvironment;
  readonly llmProvider?: LLMProvider;
  readonly llmFetch?: LLMFetch;
}

@Module({})
export class TripPlanModule {
  public static register(options: TripPlanModuleOptions = {}): DynamicModule {
    const environment =
      options.llmEnvironment ??
      (options.llmProvider === undefined ? loadLlmEnvironment() : createTestLlmEnvironment());
    const provider = options.llmProvider
      ? { provide: TRIP_PLAN_LLM_PROVIDER, useValue: options.llmProvider }
      : {
          provide: TRIP_PLAN_LLM_PROVIDER,
          inject: [LLM_ENVIRONMENT, LLM_FETCH],
          useFactory: (llmEnvironment: LlmEnvironment, llmFetch: LLMFetch): LLMProvider =>
            new OpenAICompatibleLLMProvider(llmEnvironment, llmFetch),
        };

    return {
      module: TripPlanModule,
      providers: [
        { provide: LLM_ENVIRONMENT, useValue: environment },
        {
          provide: LLM_FETCH,
          useValue: options.llmFetch ?? ((input: string, init?: RequestInit) => fetch(input, init)),
        },
        provider,
        TripPlanGenerationService,
      ],
      exports: [TripPlanGenerationService, TRIP_PLAN_LLM_PROVIDER],
    };
  }
}
