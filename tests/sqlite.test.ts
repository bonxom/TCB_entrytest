import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

test('SQLite persists data after closing and reopening a file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'summarization-sqlite-'));
  const filename = join(directory, 'smoke.sqlite');
  let database: Database.Database | undefined;
  try {
    database = new Database(filename);
    database.exec('CREATE TABLE smoke (value TEXT NOT NULL)');
    database.prepare('INSERT INTO smoke (value) VALUES (?)').run('persisted');
    database.close();
    database = new Database(filename);
    expect(database.prepare('SELECT value FROM smoke').get()).toEqual({
      value: 'persisted',
    });
  } finally {
    if (database?.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
