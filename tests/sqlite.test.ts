import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';
import { openDatabase } from '../src/database/connection.js';
import { initializeDatabase } from '../src/database/initialize.js';

test('initializes a nested database path and preserves jobs after reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'summarization-sqlite-'));
  vi.stubEnv('DATABASE_PATH', join(directory, 'nested', 'jobs.sqlite'));
  let db: Database.Database | undefined;
  try {
    db = openDatabase();
    initializeDatabase(db);
    db.prepare(
      'INSERT INTO jobs (id, text, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('job-1', 'Hello', 1, 1);
    db.close();
    db = openDatabase();
    initializeDatabase(db);
    expect(
      db.prepare('SELECT id, status, attempts, cost_microusd FROM jobs').get(),
    ).toEqual({ id: 'job-1', status: 'queued', attempts: 0, cost_microusd: 0 });
  } finally {
    if (db?.open) db.close();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('schema rejects null IDs, unknown states, and negative accounting', () => {
  const db = new Database(':memory:');
  try {
    initializeDatabase(db);
    expect(() =>
      db
        .prepare(
          'INSERT INTO jobs (id, text, created_at, updated_at) VALUES (NULL, ?, 1, 1)',
        )
        .run('Hello'),
    ).toThrow(/NOT NULL/);
    db.prepare(
      'INSERT INTO jobs (id, text, created_at, updated_at) VALUES (?, ?, 1, 1)',
    ).run('job-1', 'Hello');
    expect(() =>
      db.prepare('UPDATE jobs SET status = ?').run('unknown'),
    ).toThrow(/CHECK/);
    expect(() =>
      db.prepare('UPDATE jobs SET cost_microusd = ?').run(-1),
    ).toThrow(/CHECK/);
  } finally {
    db.close();
  }
});
