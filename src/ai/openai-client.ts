import OpenAI from 'openai';
import type { AiConfig } from '../config/aiConfig.js';
export function createOpenAIClient(
  config: Extract<AiConfig, { provider: 'openai' }>,
  fetchOverride?: typeof fetch,
): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    maxRetries: 0,
    timeout: 30000,
    ...(fetchOverride ? { fetch: fetchOverride } : {}),
  });
}
