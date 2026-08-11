import type { ZodType, ZodTypeDef } from 'zod';

export interface LLMStructuredInput<T> {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly schemaName: string;
  readonly schema: ZodType<T, ZodTypeDef, unknown>;
  readonly timeoutMs: number;
}

export interface LLMProvider {
  readonly name: string;
  generateStructured<T>(input: LLMStructuredInput<T>): Promise<T>;
}

export class LLMProviderError extends Error {
  public constructor(message = 'LLM provider request failed') {
    super(message);
    this.name = 'LLMProviderError';
  }
}

export class LLMStructuredOutputError extends Error {
  public constructor() {
    super('LLM structured output was invalid');
    this.name = 'LLMStructuredOutputError';
  }
}
