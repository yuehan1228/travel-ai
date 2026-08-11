import { Inject, Injectable } from '@nestjs/common';

import { LLM_ENVIRONMENT, LLM_FETCH } from '../config/tokens';
import type { LlmEnvironment } from '../config/llm-environment';
import {
  LLMProviderError,
  LLMStructuredOutputError,
  type LLMProvider,
  type LLMStructuredInput,
} from './llm.provider';

export interface OpenAICompatibleResponse {
  readonly choices?: unknown;
}

export interface LLMFetchResponse {
  readonly ok: boolean;
  readonly status?: number;
  json(): Promise<unknown>;
}

export type LLMFetch = (input: string, init?: RequestInit) => Promise<LLMFetchResponse>;

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const contentFromChoice = (choice: unknown): string | undefined => {
  const choiceRecord = asRecord(choice);
  const message = asRecord(choiceRecord?.message);
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;

  const chunks: string[] = [];
  for (const part of content) {
    const partRecord = asRecord(part);
    if (typeof partRecord?.text === 'string') chunks.push(partRecord.text);
  }
  return chunks.length > 0 ? chunks.join('') : undefined;
};

const contentFromResponse = (value: unknown): string | undefined => {
  const response = asRecord(value);
  const choices = response?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  return contentFromChoice(choices[0]);
};

const stripJsonFence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  if (lines.length < 3 || !lines.at(-1)?.startsWith('```')) return trimmed;
  return lines.slice(1, -1).join('\n').trim();
};

@Injectable()
export class OpenAICompatibleLLMProvider implements LLMProvider {
  public readonly name = 'openai_compatible';

  public constructor(
    @Inject(LLM_ENVIRONMENT) private readonly environment: LlmEnvironment,
    @Inject(LLM_FETCH)
    private readonly fetchImpl: LLMFetch = (input, init) => fetch(input, init),
  ) {}

  public async generateStructured<T>(input: LLMStructuredInput<T>): Promise<T> {
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
      throw new LLMProviderError();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.environment.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.environment.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.environment.model,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userPrompt },
          ],
          max_tokens: this.environment.maxOutputTokens,
          response_format: { type: 'json_object' },
          metadata: { schema_name: input.schemaName },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new LLMProviderError();

      const body = await response.json();
      const content = contentFromResponse(body);
      if (content === undefined) throw new LLMProviderError();

      let decoded: unknown;
      try {
        decoded = JSON.parse(stripJsonFence(content));
      } catch {
        throw new LLMStructuredOutputError();
      }
      const parsed = input.schema.safeParse(decoded);
      if (!parsed.success) throw new LLMStructuredOutputError();
      return parsed.data;
    } catch (error: unknown) {
      if (error instanceof LLMProviderError || error instanceof LLMStructuredOutputError) {
        throw error;
      }
      throw new LLMProviderError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { OpenAICompatibleLLMProvider as OpenAICompatibleProvider };
