import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { initializeDatabase } from '../src/database/initialize.js';
import { checkDatabaseReadiness } from '../src/database/health.js';
import { createHealthRouter } from '../src/routes/health.js';

test.each(['ready', 'closed', 'missing schema', 'read only'] as const)(
  'GET /healthz with %s storage',
  async (state) => {
    const db = new Database(':memory:');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    if (state !== 'missing schema') {
      initializeDatabase(db);
      db.prepare(
        'INSERT INTO jobs (id, text, created_at, updated_at) VALUES (?, ?, 1, 1)',
      ).run('existing', 'Keep me');
    }
    if (state === 'closed') db.close();
    if (state === 'read only') db.pragma('query_only = ON');
    const server = createServer(
      createApp(createHealthRouter(() => checkDatabaseReadiness(db))),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`,
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
      if (state === 'ready') {
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          status: 'ok',
          checks: { sqlite: 'ok' },
        });
        expect(
          db.prepare('SELECT id, text, updated_at FROM jobs').all(),
        ).toEqual([{ id: 'existing', text: 'Keep me', updated_at: 1 }]);
        expect(log).not.toHaveBeenCalled();
      } else {
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({
          error: {
            code: 'HEALTH_0001',
            message: 'SQLite storage is not ready',
          },
        });
        expect(log).toHaveBeenCalledTimes(1);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (db.open) db.close();
      log.mockRestore();
    }
  },
);
