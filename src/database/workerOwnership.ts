import { realpathSync } from 'node:fs';
import Database from 'better-sqlite3';
import { AppError } from '../error/AppError.js';
import { COMMON_ERROR } from '../error/definition/common.js';
export function acquireWorkerOwnership(databasePath: string): {
  release(): void;
} {
  let lock: Database.Database | undefined;
  try {
    lock = new Database(`${realpathSync(databasePath)}.worker-lock.sqlite`, {
      timeout: 0,
    });
    lock.exec('BEGIN IMMEDIATE');
  } catch (cause) {
    if (lock?.open) lock.close();
    const busy =
      cause &&
      typeof cause === 'object' &&
      'code' in cause &&
      (cause.code === 'SQLITE_BUSY' || cause.code === 'SQLITE_LOCKED');
    throw new AppError(
      busy
        ? COMMON_ERROR.INSTANCE_ALREADY_RUNNING
        : COMMON_ERROR.DATABASE_ERROR,
      { cause },
    );
  }
  const owned = lock;
  return {
    release() {
      if (owned.open) {
        try {
          owned.exec('ROLLBACK');
        } finally {
          owned.close();
        }
      }
    },
  };
}
