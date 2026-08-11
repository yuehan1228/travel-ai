import { describe, expect, it } from 'vitest';

import {
  createTestLlmEnvironment,
  loadLlmEnvironment,
} from '../src/modules/trip-plan/config/llm-environment';

const validEnvironment = {
  NODE_ENV: 'test',
  LLM_PROVIDER: 'openai_compatible',
  LLM_BASE_URL: 'https://llm.example.invalid/v1',
  LLM_API_KEY: 'secret-key-that-must-not-appear-in-errors',
  LLM_MODEL: 'test-model',
  LLM_REQUEST_TIMEOUT_MS: '1000',
  LLM_MAX_OUTPUT_TOKENS: '512',
};

describe('LLM environment', () => {
  it('parses server-only compatible provider settings', () => {
    expect(loadLlmEnvironment(validEnvironment)).toMatchObject({
      provider: 'openai_compatible',
      baseUrl: 'https://llm.example.invalid/v1',
      model: 'test-model',
      requestTimeoutMs: 1000,
      maxOutputTokens: 512,
    });
  });

  it('requires HTTPS except for explicitly allowed local development endpoints', () => {
    expect(() =>
      loadLlmEnvironment({ ...validEnvironment, LLM_BASE_URL: 'http://llm.example.invalid/v1' }),
    ).toThrow(/HTTPS/);
    expect(
      loadLlmEnvironment({
        ...validEnvironment,
        LLM_BASE_URL: 'http://127.0.0.1:4016/v1',
        LLM_ALLOW_INSECURE_LOCALHOST: 'true',
      }).allowInsecureLocalhost,
    ).toBe(true);
  });

  it('does not expose an API key in configuration errors and has a test fixture', () => {
    const key = validEnvironment.LLM_API_KEY;
    try {
      loadLlmEnvironment({ ...validEnvironment, LLM_API_KEY: '' });
      throw new Error('expected invalid configuration');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(key);
    }
    expect(createTestLlmEnvironment().apiKey).toBe('test-llm-key');
  });
});
