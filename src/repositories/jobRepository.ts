import type Database from 'better-sqlite3';
import { AppError } from '../error/AppError.js';
import { COMMON_ERROR } from '../error/definition/common.js';
import { PROVIDER_ERROR } from '../error/definition/provider.js';
import type {
  JobRow,
  JobOutcome,
  JobSubmissionRepository,
  JobQueryRepository,
  JobProcessingRepository,
} from '../types/job.js';

const JOB_COLUMNS = `
  id,
  text,
  callback_url AS callbackUrl,
  status,
  attempts,
  summary,
  error_code AS errorCode,
  error_message AS errorMessage,
  input_tokens AS inputTokens,
  output_tokens AS outputTokens,
  cost_microusd AS costMicrousd,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

function databaseOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (cause) {
    throw new AppError(COMMON_ERROR.DATABASE_ERROR, { cause });
  }
}

function validateAccountingTotals(job: JobRow, outcome: JobOutcome): void {
  const values = [
    outcome.usage.inputTokens,
    outcome.usage.outputTokens,
    outcome.costMicrousd,
    job.inputTokens + outcome.usage.inputTokens,
    job.outputTokens + outcome.usage.outputTokens,
    job.costMicrousd + outcome.costMicrousd,
  ];

  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new AppError(COMMON_ERROR.DATABASE_ERROR);
    }
  }
}

export function createSubmissionRepository(
  db: Database.Database,
): JobSubmissionRepository {
  return {
    insert(job) {
      databaseOperation(() => {
        const statement = db.prepare(`
          INSERT INTO jobs (
            id, text, callback_url, status, attempts, summary,
            error_code, error_message, input_tokens, output_tokens,
            cost_microusd, created_at, updated_at
          ) VALUES (
            @id, @text, @callbackUrl, @status, @attempts, @summary,
            @errorCode, @errorMessage, @inputTokens, @outputTokens,
            @costMicrousd, @createdAt, @updatedAt
          )
        `);

        statement.run(job);
      });
    },
  };
}

export function createQueryRepository(
  db: Database.Database,
): JobQueryRepository {
  return {
    findById(id) {
      return databaseOperation(() => {
        const statement = db.prepare(`
          SELECT ${JOB_COLUMNS}
          FROM jobs
          WHERE id = ?
        `);

        return statement.get(id) as JobRow | undefined;
      });
    },
  };
}

export function createProcessingRepository(
  db: Database.Database,
): JobProcessingRepository {
  function claimQueuedJob(now: number): JobRow | undefined {
    const job = db
      .prepare(
        `
      SELECT ${JOB_COLUMNS}
      FROM jobs
      WHERE status = 'queued'
      ORDER BY created_at, id
      LIMIT 1
    `,
      )
      .get() as JobRow | undefined;

    if (!job) {
      return undefined;
    }

    const result = db
      .prepare(
        `
      UPDATE jobs
      SET status = 'running', attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'queued'
    `,
      )
      .run(now, job.id);

    if (result.changes !== 1) {
      throw new AppError(COMMON_ERROR.DATABASE_ERROR);
    }

    return {
      ...job,
      status: 'running',
      attempts: job.attempts + 1,
      updatedAt: now,
    };
  }

  function finishRunningJob(
    id: string,
    attempt: number,
    outcome: JobOutcome,
    now: number,
  ): void {
    const job = db
      .prepare(
        `
      SELECT ${JOB_COLUMNS}
      FROM jobs
      WHERE id = ? AND status = 'running' AND attempts = ?
    `,
      )
      .get(id, attempt) as JobRow | undefined;

    if (!job) {
      throw new AppError(COMMON_ERROR.DATABASE_ERROR);
    }
    validateAccountingTotals(job, outcome);

    const result = db
      .prepare(
        `
      UPDATE jobs
      SET status = @status,
          summary = @summary,
          error_code = @errorCode,
          error_message = @errorMessage,
          input_tokens = input_tokens + @inputTokens,
          output_tokens = output_tokens + @outputTokens,
          cost_microusd = cost_microusd + @costMicrousd,
          updated_at = @now
      WHERE id = @id AND status = 'running' AND attempts = @attempt
    `,
      )
      .run({
        id,
        attempt,
        now,
        status: outcome.status,
        summary: outcome.summary,
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
        ...outcome.usage,
        costMicrousd: outcome.costMicrousd,
      });

    if (result.changes !== 1) {
      throw new AppError(COMMON_ERROR.DATABASE_ERROR);
    }
  }

  return {
    claimNext(now) {
      return databaseOperation(() =>
        db.transaction(claimQueuedJob).immediate(now),
      );
    },

    finish(id, attempt, outcome, now) {
      databaseOperation(() => {
        db.transaction(finishRunningJob).immediate(id, attempt, outcome, now);
      });
    },

    recoverInterrupted(now) {
      return databaseOperation(() => {
        const statement = db.prepare(`
          UPDATE jobs
          SET status = 'dead', error_code = ?, error_message = ?, updated_at = ?
          WHERE status = 'running'
        `);
        const result = statement.run(
          PROVIDER_ERROR.INTERRUPTED.code,
          PROVIDER_ERROR.INTERRUPTED.message,
          now,
        );

        return result.changes;
      });
    },
  };
}
