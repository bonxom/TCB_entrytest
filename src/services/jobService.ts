import { randomUUID } from 'node:crypto';
import {
  ProviderFailure,
  validUsage,
  type SummarizationProvider,
} from '../ai/provider.js';
import { AppError } from '../error/AppError.js';
import { JOB_ERROR } from '../error/definition/job.js';
import { PROVIDER_ERROR } from '../error/definition/provider.js';
import {
  validateSubmitJobInput,
  validateJobId,
} from '../validations/jobValidation.js';
import type {
  JobSubmissionRepository,
  SubmitJobInput,
  JobQueryRepository,
  JobOutcome,
  JobProcessingRepository,
  SummaryResult,
  Usage,
} from '../types/job.js';

interface SubmissionOptions {
  now?: () => number;
  newId?: () => string;
}

export function createSubmissionService(
  repository: JobSubmissionRepository,
  { now = Date.now, newId = randomUUID }: SubmissionOptions = {},
) {
  return {
    submit(input: SubmitJobInput): { id: string } {
      validateSubmitJobInput(input);
      const id = newId();
      const timestamp = now();

      repository.insert({
        id,
        text: input.text,
        callbackUrl: input.callbackUrl ?? null,
        status: 'queued',
        attempts: 0,
        summary: null,
        errorCode: null,
        errorMessage: null,
        inputTokens: 0,
        outputTokens: 0,
        costMicrousd: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return { id };
    },
  };
}
export type SubmissionService = ReturnType<typeof createSubmissionService>;

export function createQueryService(repository: JobQueryRepository) {
  return {
    getById(id: string) {
      validateJobId(id);
      const row = repository.findById(id);
      if (!row) {
        throw new AppError(JOB_ERROR.NOT_FOUND);
      }

      return {
        id: row.id,
        status: row.status,
        summary: row.summary,
        error:
          row.errorCode === null
            ? null
            : { code: row.errorCode, message: row.errorMessage },
        attempts: row.attempts,
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        cost: row.costMicrousd / 1_000_000,
        cost_basis: 'assessment_rate' as const,
      };
    },
  };
}
export type QueryService = ReturnType<typeof createQueryService>;
export type JobView = ReturnType<QueryService['getById']>;

export type ProcessStep =
  { kind: 'idle' } | { kind: 'processed' } | { kind: 'halt'; error: AppError };
function calculateCostMicrousd(usage: Usage): number {
  return 3 * usage.inputTokens + 15 * usage.outputTokens;
}

function createSuccessOutcome(result: SummaryResult): JobOutcome {
  if (
    !result ||
    typeof result.summary !== 'string' ||
    !result.summary.trim() ||
    !result.usage ||
    !validUsage(result.usage)
  ) {
    throw new ProviderFailure(PROVIDER_ERROR.INVALID_RESPONSE, {
      kind: 'invalid_response',
    });
  }

  return {
    status: 'succeeded',
    summary: result.summary,
    errorCode: null,
    errorMessage: null,
    usage: result.usage,
    costMicrousd: calculateCostMicrousd(result.usage),
  };
}

function normalizeProviderFailure(error: unknown): ProviderFailure {
  if (error instanceof ProviderFailure) {
    return error;
  }

  return new ProviderFailure(PROVIDER_ERROR.UNEXPECTED, { kind: 'unexpected' });
}

function createFailureOutcome(failure: ProviderFailure): JobOutcome {
  const usage =
    failure.usage && validUsage(failure.usage)
      ? failure.usage
      : { inputTokens: 0, outputTokens: 0 };

  return {
    status: failure.kind === 'input' ? 'failed' : 'dead',
    summary: null,
    errorCode: failure.code,
    errorMessage: failure.message,
    usage,
    costMicrousd: calculateCostMicrousd(usage),
  };
}

export function createProcessingService(
  repository: JobProcessingRepository,
  provider: SummarizationProvider,
  now: () => number = Date.now,
) {
  async function processNext(): Promise<ProcessStep> {
    const job = repository.claimNext(now());
    if (!job) {
      return { kind: 'idle' };
    }

    let outcome: JobOutcome;
    let configurationFailure: ProviderFailure | undefined;

    try {
      const result = await provider.summarize(job.text);
      outcome = createSuccessOutcome(result);
    } catch (error) {
      const failure = normalizeProviderFailure(error);
      outcome = createFailureOutcome(failure);

      if (failure.kind === 'configuration') {
        configurationFailure = failure;
      }
    }

    // A failed DB write must stop the worker, not become a provider failure.
    repository.finish(job.id, job.attempts, outcome, now());

    if (configurationFailure) {
      return { kind: 'halt', error: configurationFailure };
    }
    return { kind: 'processed' };
  }

  return { processNext };
}
