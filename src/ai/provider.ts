import { AppError } from '../error/AppError.js';
import type { ErrorDefinition } from '../error/ErrorDefinition.js';
import type { Usage, SummaryResult } from '../types/job.js';
export interface SummarizationProvider {
  summarize(text: string): Promise<SummaryResult>;
}
export type FailureKind =
  'input' | 'transient' | 'configuration' | 'invalid_response' | 'unexpected';
export class ProviderFailure extends AppError {
  readonly kind: FailureKind;
  readonly usage: Usage | undefined;
  readonly retryAfterMs: number | undefined;
  constructor(
    definition: ErrorDefinition,
    metadata: {
      kind: FailureKind;
      usage?: Usage;
      retryAfterMs?: number;
      cause?: unknown;
    },
  ) {
    super(definition, { cause: metadata.cause });
    this.kind = metadata.kind;
    this.usage = metadata.usage;
    this.retryAfterMs = metadata.retryAfterMs;
  }
}
export function validUsage(usage: Usage): boolean {
  return [
    usage.inputTokens,
    usage.outputTokens,
    3 * usage.inputTokens + 15 * usage.outputTokens,
  ].every((value) => Number.isSafeInteger(value) && value >= 0);
}
