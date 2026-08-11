import {
  LLMProviderError,
  LLMStructuredOutputError,
  type LLMProvider,
  type LLMStructuredInput,
} from './llm.provider';

/** Deterministic test double. It never performs network I/O. */
export class FakeLLMProvider implements LLMProvider {
  public readonly name = 'fake';
  public calls = 0;
  public lastInput: LLMStructuredInput<unknown> | undefined;

  public constructor(
    private readonly responseFactory: (
      input: LLMStructuredInput<unknown>,
    ) => unknown | Promise<unknown> = () => {
      throw new LLMProviderError();
    },
  ) {}

  public async generateStructured<T>(input: LLMStructuredInput<T>): Promise<T> {
    this.calls += 1;
    const recordedInput: LLMStructuredInput<unknown> = {
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      schemaName: input.schemaName,
      schema: input.schema,
      timeoutMs: input.timeoutMs,
    };
    this.lastInput = recordedInput;
    const response = await this.responseFactory(recordedInput);
    const parsed = input.schema.safeParse(response);
    if (!parsed.success) throw new LLMStructuredOutputError();
    return parsed.data;
  }
}
