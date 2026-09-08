import type Database from 'better-sqlite3';
import { AppError } from '../error/AppError.js';
import { COMMON_ERROR } from '../error/definition/common.js';

export function initializeDatabase(db: Database.Database): void {
  try {
    db.transaction(() => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY NOT NULL,
        text TEXT NOT NULL,
        callback_url TEXT,

        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (
            status IN ('queued', 'running', 'succeeded', 'failed', 'dead')
          ),

        attempts INTEGER NOT NULL DEFAULT 0
          CHECK (attempts >= 0),

        summary TEXT,
        error_code TEXT,
        error_message TEXT,

        input_tokens INTEGER NOT NULL DEFAULT 0
          CHECK (input_tokens >= 0),

        output_tokens INTEGER NOT NULL DEFAULT 0
          CHECK (output_tokens >= 0),

        cost_microusd INTEGER NOT NULL DEFAULT 0
          CHECK (cost_microusd >= 0),

        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at
      ON jobs(status, created_at);
    `);
    })();
  } catch (cause) {
    throw new AppError(COMMON_ERROR.DATABASE_ERROR, { cause });
  }
}
