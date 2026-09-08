import type Database from 'better-sqlite3';
import { AppError } from '../error/AppError.js';
import { HEALTH_ERROR } from '../error/definition/health.js';

export function checkDatabaseReadiness(db: Database.Database): void {
  try {
    db.transaction(() => {
      db.prepare('SELECT id FROM jobs LIMIT 1').get();
      // Validate write access without creating or modifying any job.
      db.prepare('UPDATE jobs SET updated_at = updated_at WHERE 0').run();
    }).immediate();
  } catch (cause) {
    throw new AppError(HEALTH_ERROR.STORAGE_UNAVAILABLE, { cause });
  }
}
