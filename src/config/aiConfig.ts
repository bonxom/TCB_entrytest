import { AppError } from '../error/AppError.js';
import { COMMON_ERROR } from '../error/definition/common.js';
export type AiConfig =
  | { provider: 'stub'; seed: number }
  | { provider: 'openai'; apiKey: string; baseUrl: string; model: string };
export function readAiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const provider = env['AI_PROVIDER'] ?? 'openai';
  if (provider === 'stub') {
    const seed = Number(env['SEED'] ?? 42);
    if (!Number.isSafeInteger(seed))
      throw new AppError(COMMON_ERROR.CONFIGURATION_ERROR);
    return { provider, seed };
  }
  const apiKey = env['API_KEY'],
    baseUrl = env['BASE_URL'],
    model = env['MODEL'];
  if (
    provider !== 'openai' ||
    !apiKey?.trim() ||
    !baseUrl?.trim() ||
    !model?.trim()
  )
    throw new AppError(COMMON_ERROR.CONFIGURATION_ERROR);
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AppError(COMMON_ERROR.CONFIGURATION_ERROR);
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AppError(COMMON_ERROR.CONFIGURATION_ERROR);
  return { provider, apiKey, baseUrl, model };
}
