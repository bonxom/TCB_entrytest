import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Router } from 'express';
import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { AppError } from '../src/error/AppError.js';
import { COMMON_ERROR } from '../src/error/definition/common.js';
import * as connection from '../src/database/connection.js';
import { initializeDatabase } from '../src/database/initialize.js';
import { startServer } from '../src/startup.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test('HTTP errors use a consistent envelope and hide unexpected details', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const router = Router();
  router.get('/validation', (_req, _res, next) =>
    next(new AppError(COMMON_ERROR.VALIDATION_ERROR)),
  );
  router.get('/database', (_req, _res, next) =>
    next(
      new AppError(COMMON_ERROR.DATABASE_ERROR, {
        cause: new Error('secret SQL'),
      }),
    ),
  );
  router.get('/unexpected', () => {
    throw new Error('secret stack and SQL');
  });
  const server = createServer(createApp(router)).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [path, status, code, message] of [
      ['/validation', 400, 'COMMON_0002', 'Invalid request input'],
      ['/missing', 404, 'COMMON_0003', 'Resource not found'],
      ['/database', 500, 'COMMON_0006', 'Database operation failed'],
      ['/unexpected', 500, 'COMMON_0001', 'Internal server error'],
    ] as const) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code, message } });
    }
    expect(log).toHaveBeenCalledTimes(2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('database adapters throw AppError and retain the internal cause', () => {
  vi.stubEnv('DATABASE_PATH', '/dev/null/jobs.sqlite');
  expect(() => connection.openDatabase()).toThrow(AppError);
  const db = new Database(':memory:');
  db.close();
  try {
    initializeDatabase(db);
    expect.unreachable('Expected initialization to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject(COMMON_ERROR.DATABASE_ERROR);
    expect((error as AppError).cause).toBeInstanceOf(Error);
  }
});

test('invalid port rejects with AppError (CONFIGURATION_ERROR) before opening the database', async () => {
  vi.stubEnv('PORT', 'invalid');
  const open = vi.spyOn(connection, 'openDatabase');
  await expect(startServer()).rejects.toMatchObject(
    COMMON_ERROR.CONFIGURATION_ERROR,
  );
  expect(open).not.toHaveBeenCalled();
});

test('HTTP bind failure rejects with AppError (SERVER_STARTUP_ERROR) and closes the database', async () => {
  const occupied = createServer().listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const directory = mkdtempSync(join(tmpdir(), 'startup-test-'));
  const db = new Database(join(directory, 'jobs.sqlite'));
  vi.stubEnv('AI_PROVIDER', 'stub');
  vi.spyOn(connection, 'openDatabase').mockReturnValue(db);
  vi.stubEnv('HOST', '127.0.0.1');
  vi.stubEnv('PORT', String((occupied.address() as AddressInfo).port));
  try {
    await expect(startServer()).rejects.toMatchObject(
      COMMON_ERROR.SERVER_STARTUP_ERROR,
    );
    expect(db.open).toBe(false);
  } finally {
    if (db.open) db.close();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('schema failure rejects with AppError (DATABASE_ERROR) and closes the connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'schema-test-'));
  const db = new Database(join(directory, 'jobs.sqlite'));
  vi.stubEnv('AI_PROVIDER', 'stub');
  db.exec('CREATE TABLE jobs (id TEXT)');
  vi.spyOn(connection, 'openDatabase').mockReturnValue(db);
  vi.stubEnv('PORT', '3000');
  await expect(startServer()).rejects.toMatchObject(
    COMMON_ERROR.DATABASE_ERROR,
  );
  expect(db.open).toBe(false);
  rmSync(directory, { recursive: true, force: true });
});
