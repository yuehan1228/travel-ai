import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestLlmEnvironment } from '../src/modules/trip-plan/config/llm-environment';
import {
  OpenAICompatibleLLMProvider,
  type LLMFetch,
} from '../src/modules/trip-plan/providers/openai-compatible.provider';
import {
  LLMProviderError,
  LLMStructuredOutputError,
} from '../src/modules/trip-plan/providers/llm.provider';

const outputSchema = z.object({ answer: z.string().min(1) }).strict();

const response = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 502,
  json: async () => body,
});

describe('OpenAICompatibleLLMProvider', () => {
  it('posts a bounded structured request and validates JSON output', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchImpl: LLMFetch = async (url, init) => {
      requestUrl = url;
      requestInit = init;
      return response({ choices: [{ message: { content: '{"answer":"ok"}' } }] });
    };
    const provider = new OpenAICompatibleLLMProvider(createTestLlmEnvironment(), fetchImpl);

    await expect(
      provider.generateStructured({
        systemPrompt: 'system',
        userPrompt: 'user',
        schemaName: 'test_schema',
        schema: outputSchema,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual({ answer: 'ok' });
    expect(requestUrl).toBe('http://127.0.0.1:4016/v1/chat/completions');
    expect(requestInit?.method).toBe('POST');
    expect(String(requestInit?.headers)).not.toContain('test-llm-key');
  });

  it('maps HTTP and malformed structured responses without exposing raw data', async () => {
    const failedProvider = new OpenAICompatibleLLMProvider(createTestLlmEnvironment(), async () =>
      response({ error: { message: 'secret provider details' } }, false),
    );
    await expect(
      failedProvider.generateStructured({
        systemPrompt: 'system',
        userPrompt: 'private user text',
        schemaName: 'test_schema',
        schema: outputSchema,
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(LLMProviderError);

    const invalidProvider = new OpenAICompatibleLLMProvider(createTestLlmEnvironment(), async () =>
      response({ choices: [{ message: { content: '{"answer":1}' } }] }),
    );
    await expect(
      invalidProvider.generateStructured({
        systemPrompt: 'system',
        userPrompt: 'private user text',
        schemaName: 'test_schema',
        schema: outputSchema,
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(LLMStructuredOutputError);
  });

  it('aborts a timed-out request and maps it to LLMProviderError', async () => {
    let observedSignal: AbortSignal | undefined;
    const timeoutProvider = new OpenAICompatibleLLMProvider(
      createTestLlmEnvironment(),
      async (_url, init) => {
        observedSignal = init?.signal ?? undefined;
        return await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
    );

    await expect(
      timeoutProvider.generateStructured({
        systemPrompt: 'system',
        userPrompt: 'user',
        schemaName: 'test_schema',
        schema: outputSchema,
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(LLMProviderError);
    expect(observedSignal?.aborted).toBe(true);
  });
});
