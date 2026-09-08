import type Database from 'better-sqlite3';
import { AppError } from '../error/AppError.js';
import { HEALTH_ERROR } from '../error/definition/health.js';

export function checkDatabaseReadiness(db: Database.Database): void {
  let previous: number | undefined;
  try {
    previous = db.pragma('busy_timeout', { simple: true }) as number;
    db.pragma('busy_timeout = 100');
    db.transaction(() => {
      db.prepare('SELECT id FROM jobs LIMIT 1').get();
      // Validate write access without creating or modifying any job.
      db.prepare('UPDATE jobs SET updated_at = updated_at WHERE 0').run();
    }).immediate();
  } catch (cause) {
    throw new AppError(HEALTH_ERROR.STORAGE_UNAVAILABLE, { cause });
  } finally {
    if (db.open && previous !== undefined)
      db.pragma(`busy_timeout = ${previous}`);
  }
}
