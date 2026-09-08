import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { AppError } from '../error/AppError.js';
import { COMMON_ERROR } from '../error/definition/common.js';

export function openDatabase(databasePath?: string): Database.Database {
  const filename = resolve(
    databasePath ?? process.env['DATABASE_PATH'] ?? './data/jobs.sqlite',
  );

  try {
    mkdirSync(dirname(filename), { recursive: true });
    return new Database(filename);
  } catch (cause) {
    throw new AppError(COMMON_ERROR.DATABASE_ERROR, { cause });
  }
}
