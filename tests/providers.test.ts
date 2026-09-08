import { expect, test, vi } from 'vitest';
import { createStubProvider } from '../src/ai/stub-provider.js';
import { createOpenAIClient } from '../src/ai/openai-client.js';
import {
  createOpenAIProvider,
  parseRetryAfter,
} from '../src/ai/openai-provider.js';
import { readAiConfig } from '../src/config/aiConfig.js';
import { logError } from '../src/error/error-handling.js';
import { AppError } from '../src/error/AppError.js';
import { COMMON_ERROR } from '../src/error/definition/common.js';

const config = {
  provider: 'openai' as const,
  apiKey: 'test-secret-key',
  baseUrl: 'https://test.invalid/v1',
  model: 'test-model',
};
function transport(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
  );
  return {
    fetcher,
    provider: createOpenAIProvider(
      createOpenAIClient(config, fetcher),
      config.model,
    ),
  };
}
function response(overrides: Record<string, unknown> = {}) {
  return {
    id: 'resp_test',
    object: 'response',
    status: 'completed',
    output: [
      {
        type: 'message',
        id: 'msg_test',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'A summary', annotations: [] }],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    ...overrides,
  };
}
test('Responses wrapper sends the exact request and uses reported usage', async () => {
  const { fetcher, provider } = transport(response());
  expect(await provider.summarize('private text')).toEqual({
    summary: 'A summary',
    usage: { inputTokens: 100, outputTokens: 20 },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe('https://test.invalid/v1/responses');
  expect(JSON.parse(String(init?.body))).toMatchObject({
    model: 'test-model',
    input: 'private text',
    store: false,
    max_output_tokens: 1024,
  });
  expect(createOpenAIClient(config).maxRetries).toBe(0);
  expect(createOpenAIClient(config).timeout).toBe(30000);
});
test.each([
  [400, 'invalid_input', null, 'input'],
  [400, 'invalid_input', 'model', 'configuration'],
  [400, 'unsupported_parameter', 'temperature', 'configuration'],
  [400, 'unsupported_model', null, 'configuration'],
  [400, 'unknown', null, 'invalid_response'],
  [401, 'invalid_api_key', null, 'configuration'],
  [403, 'forbidden', null, 'configuration'],
  [404, 'not_found', null, 'configuration'],
  [408, null, null, 'transient'],
  [409, null, null, 'transient'],
  [429, null, null, 'transient'],
  [500, null, null, 'transient'],
])(
  'provider HTTP %s / %s is classified safely',
  async (status, code, param, kind) => {
    const { fetcher, provider } = transport(
      { error: { message: 'secret provider detail', code, param } },
      Number(status),
      { 'retry-after': '2' },
    );
    await expect(provider.summarize('secret prompt')).rejects.toMatchObject({
      kind,
      retryAfterMs: 2000,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
test.each([
  { usage: null },
  { usage: { input_tokens: 0.5, output_tokens: 1 } },
  { usage: { input_tokens: -1, output_tokens: 1 } },
  { output: [] },
  { status: 'incomplete' },
  { status: 'failed' },
])('invalid response cannot succeed: %j', async (overrides) => {
  await expect(
    transport(response(overrides)).provider.summarize('hello'),
  ).rejects.toMatchObject({ kind: 'invalid_response' });
});
test('refusal retains reported usage and network failure is transient', async () => {
  await expect(
    transport(
      response({
        output: [
          { type: 'message', content: [{ type: 'refusal', refusal: 'no' }] },
        ],
      }),
    ).provider.summarize('hello'),
  ).rejects.toMatchObject({
    kind: 'input',
    usage: { inputTokens: 100, outputTokens: 20 },
  });
  const fetcher = vi.fn<typeof fetch>(async () => {
    throw new TypeError('network secret');
  });
  await expect(
    createOpenAIProvider(
      createOpenAIClient(config, fetcher),
      config.model,
    ).summarize('hello'),
  ).rejects.toMatchObject({ kind: 'transient' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    parseRetryAfter(
      'Tue, 08 Sep 2026 00:00:02 GMT',
      Date.parse('2026-09-08T00:00:00Z'),
    ),
  ).toBe(2000);
  expect(parseRetryAfter('garbage')).toBeUndefined();
});
test('configuration validation and safe logging never print secrets', () => {
  expect(readAiConfig({ AI_PROVIDER: 'stub' })).toEqual({
    provider: 'stub',
    seed: 42,
  });
  expect(
    readAiConfig({
      API_KEY: 'k',
      BASE_URL: 'https://example.com/v1',
      MODEL: 'm',
    }),
  ).toMatchObject({ provider: 'openai', model: 'm' });
  for (const env of [
    {},
    { API_KEY: 'x' },
    { API_KEY: 'x', BASE_URL: 'file:///tmp', MODEL: 'm' },
    { API_KEY: 'x', BASE_URL: 'https://u:p@example.com', MODEL: 'm' },
    { AI_PROVIDER: 'bad' },
    { AI_PROVIDER: 'stub', SEED: 'oops' },
  ])
    expect(() => readAiConfig(env)).toThrow(AppError);
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    logError(
      new AppError(COMMON_ERROR.DATABASE_ERROR, {
        cause: new Error('test-secret-key private text'),
      }),
    );
    logError(new Error('test-secret-key'));
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(
      /test-secret-key|private text/,
    );
  } finally {
    spy.mockRestore();
  }
});
test('stub enforces two slots and releases slots, with controlled latency and accounting', async () => {
  const resolvers: (() => void)[] = [];
  const delays: number[] = [];
  const provider = createStubProvider({
    seed: 42,
    random: () => 0.5,
    sleep: (ms) => {
      delays.push(ms);
      return new Promise((resolve) => resolvers.push(resolve));
    },
  });
  const a = provider.summarize('x'.repeat(400)),
    b = provider.summarize('hello');
  await expect(provider.summarize('third')).rejects.toMatchObject({
    kind: 'transient',
    retryAfterMs: 2000,
  });
  expect(delays).toEqual([2000, 2000]);
  resolvers.splice(0).forEach((resolve) => resolve());
  expect(await a).toMatchObject({
    usage: { inputTokens: 100, outputTokens: 20 },
  });
  await b;
  const c = provider.summarize('again');
  resolvers.splice(0).forEach((resolve) => resolve());
  await c;
  await expect(provider.summarize('')).rejects.toMatchObject({ kind: 'input' });
  await expect(provider.summarize('x'.repeat(10001))).rejects.toMatchObject({
    kind: 'input',
  });
});
test('stub seeded runs reproduce and synthetic 500 releases capacity', async () => {
  async function run() {
    const delays: number[] = [];
    const p = createStubProvider({
      seed: 42,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    const outcomes = [];
    for (let i = 0; i < 30; i++) {
      try {
        await p.summarize('hi');
        outcomes.push('ok');
      } catch {
        outcomes.push('error');
      }
    }
    return { delays, outcomes };
  }
  const a = await run();
  expect(a).toEqual(await run());
  expect(a.delays.every((ms) => ms >= 1000 && ms <= 3000)).toBe(true);
  expect(a.outcomes).toContain('error');
  const p = createStubProvider({
    seed: 1,
    random: () => 0,
    sleep: async () => {},
  });
  for (let i = 0; i < 3; i++)
    await expect(p.summarize('hi')).rejects.toMatchObject({
      kind: 'transient',
      retryAfterMs: undefined,
    });
});
