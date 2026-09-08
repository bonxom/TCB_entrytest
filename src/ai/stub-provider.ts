import { setTimeout } from 'node:timers/promises';
import { ProviderFailure, type SummarizationProvider } from './provider.js';
import { PROVIDER_ERROR } from '../error/definition/provider.js';
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function createStubProvider({
  seed,
  random = seededRandom(seed),
  sleep = (ms) => setTimeout(ms),
}: {
  seed: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): SummarizationProvider {
  let active = 0;
  return {
    async summarize(text) {
      if (typeof text !== 'string' || text.length === 0 || text.length > 10000)
        throw new ProviderFailure(PROVIDER_ERROR.INVALID_INPUT, {
          kind: 'input',
        });
      if (active >= 2)
        throw new ProviderFailure(PROVIDER_ERROR.TEMPORARY_FAILURE, {
          kind: 'transient',
          retryAfterMs: 1000 * (1 + Math.floor(random() * 3)),
        });
      active++;
      try {
        const delay = 1000 + Math.floor(random() * 2001),
          fails = random() < 0.15;
        await sleep(delay);
        if (fails)
          throw new ProviderFailure(PROVIDER_ERROR.TEMPORARY_FAILURE, {
            kind: 'transient',
          });
        // token count
        const inputTokens = Math.ceil(text.length / 4);
        const outputTokens = Math.ceil(inputTokens * 0.2);
        return {
          summary: text.slice(0, 200),
          usage: { inputTokens, outputTokens },
        };
      } finally {
        active--;
      }
    },
  };
}
