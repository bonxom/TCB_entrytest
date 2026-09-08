import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';
import { startServer, type RunningService } from '../src/startup.js';
import { initializeDatabase } from '../src/database/initialize.js';
import { checkDatabaseReadiness } from '../src/database/health.js';
import { createSubmissionService } from '../src/services/jobService.js';
import {
  createSubmissionRepository,
  createQueryRepository,
} from '../src/repositories/jobRepository.js';
import { ProviderFailure } from '../src/ai/provider.js';
import { PROVIDER_ERROR } from '../src/error/definition/provider.js';
import { startWorker } from '../src/workers/jobWorker.js';
import type { SummaryResult } from '../src/types/job.js';
const dirs: string[] = [];
function path() {
  const dir = mkdtempSync(join(tmpdir(), 'lifecycle-'));
  dirs.push(dir);
  return join(dir, 'jobs.sqlite');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const success = {
  summary: 'done',
  usage: { inputTokens: 100, outputTokens: 20 },
};
const base = (service: RunningService) =>
  `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
const post = async (url: string) => {
  const res = await fetch(`${url}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hello' }),
  });
  expect(res.status).toBe(202);
  return ((await res.json()) as { id: string }).id;
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
test('submit returns before provider; shutdown drains worker, is idempotent, and persists result', async () => {
  const pending = deferred<SummaryResult>(),
    entered = deferred<void>();
  const filename = path();
  const service = await startServer({
    port: 0,
    databasePath: filename,
    provider: {
      summarize: () => {
        entered.resolve();
        return pending.promise;
      },
    },
  });
  try {
    const url = base(service),
      id = await post(url);
    await entered.promise;
    expect(await (await fetch(`${url}/jobs/${id}`)).json()).toMatchObject({
      status: 'running',
      attempts: 1,
    });
    const stop = service.stop();
    expect(service.stop()).toBe(stop);
    let stopped = false;
    void stop.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    pending.resolve(success);
    await stop;
    const db = new Database(filename);
    try {
      expect(createQueryRepository(db).findById(id)).toMatchObject({
        status: 'succeeded',
        costMicrousd: 600,
      });
    } finally {
      db.close();
    }
  } finally {
    pending.resolve(success);
    await service.stop();
  }
});
test('configuration failure stops claims, GET stays available; restart resumes queued only', async () => {
  const filename = path(),
    pending = deferred<SummaryResult>(),
    entered = deferred<void>();
  const summarize = vi.fn(() => {
    entered.resolve();
    return pending.promise;
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const service = await startServer({
    port: 0,
    databasePath: filename,
    provider: { summarize },
  });
  let queued = '';
  let failed = '';
  try {
    const url = base(service);
    failed = await post(url);
    await entered.promise;
    queued = await post(url);
    pending.reject(
      new ProviderFailure(PROVIDER_ERROR.CONFIGURATION, {
        kind: 'configuration',
      }),
    );
    await vi.waitFor(async () =>
      expect((await fetch(`${url}/healthz`)).status).toBe(503),
    );
    expect(await (await fetch(`${url}/jobs/${failed}`)).json()).toMatchObject({
      status: 'dead',
      error: { code: 'PROVIDER_0003' },
    });
    expect(await (await fetch(`${url}/jobs/${queued}`)).json()).toMatchObject({
      status: 'queued',
      attempts: 0,
    });
    expect(
      (
        await fetch(`${url}/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"text":"hello"}',
        })
      ).status,
    ).toBe(503);
    expect(summarize).toHaveBeenCalledTimes(1);
  } finally {
    pending.resolve(success);
    await service.stop();
  }
  const resumed = await startServer({
    port: 0,
    databasePath: filename,
    provider: { summarize: async () => success },
  });
  try {
    await vi.waitFor(async () =>
      expect(
        await (await fetch(`${base(resumed)}/jobs/${queued}`)).json(),
      ).toMatchObject({ status: 'succeeded', attempts: 1 }),
    );
    expect(
      await (await fetch(`${base(resumed)}/jobs/${failed}`)).json(),
    ).toMatchObject({ status: 'dead', attempts: 1 });
  } finally {
    await resumed.stop();
  }
});
test('persistence failure exits worker and coordinator without self-await deadlock', async () => {
  const filename = path(),
    pending = deferred<SummaryResult>(),
    entered = deferred<void>(),
    fatal = deferred<unknown>();
  const service = await startServer({
    port: 0,
    databasePath: filename,
    provider: {
      summarize: () => {
        entered.resolve();
        return pending.promise;
      },
    },
    onFatal: (error) => fatal.resolve(error),
  });
  try {
    const id = await post(base(service));
    await entered.promise;
    const db = new Database(filename);
    db.exec(
      "CREATE TRIGGER fail_finish BEFORE UPDATE ON jobs WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'test persistence failure'); END;",
    );
    pending.resolve(success);
    await expect(fatal.promise).resolves.toMatchObject({ code: 'COMMON_0006' });
    await service.stop();
    try {
      expect(createQueryRepository(db).findById(id)?.status).toBe('running');
    } finally {
      db.close();
    }
  } finally {
    pending.resolve(success);
    await service.stop();
  }
});
test('idle worker stops promptly and catches persistence rejections', async () => {
  const idle = startWorker(async () => ({ kind: 'idle' }));
  await Promise.resolve();
  idle.requestStop();
  await expect(idle.done).resolves.toEqual({ reason: 'stopped' });
  const broken = startWorker(async () => {
    throw new Error('db');
  });
  await expect(broken.done).resolves.toMatchObject({ reason: 'persistence' });
});
test('bind failure cannot recover running jobs and releases ownership', async () => {
  const filename = path(),
    db = new Database(filename);
  initializeDatabase(db);
  const id = createSubmissionService(createSubmissionRepository(db)).submit({
    text: 'hello',
  }).id;
  db.prepare("UPDATE jobs SET status='running',attempts=1").run();
  const occupied = createServer().listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  try {
    await expect(
      startServer({
        port: (occupied.address() as AddressInfo).port,
        databasePath: filename,
        provider: { summarize: async () => success },
      }),
    ).rejects.toMatchObject({ code: 'COMMON_0005' });
    expect(createQueryRepository(db).findById(id)?.status).toBe('running');
    const restarted = await startServer({
      port: 0,
      databasePath: filename,
      provider: { summarize: async () => success },
    });
    try {
      expect(createQueryRepository(db).findById(id)).toMatchObject({
        status: 'dead',
        attempts: 1,
        errorCode: 'PROVIDER_0005',
      });
    } finally {
      await restarted.stop();
    }
  } finally {
    db.close();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});
test('health lock contention is bounded and original busy timeout restored', () => {
  const filename = path(),
    db = new Database(filename),
    other = new Database(filename);
  initializeDatabase(db);
  db.pragma('busy_timeout=4321');
  other.exec('BEGIN IMMEDIATE');
  try {
    const start = Date.now();
    expect(() => checkDatabaseReadiness(db)).toThrow();
    expect(Date.now() - start).toBeLessThan(1000);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(4321);
  } finally {
    other.exec('ROLLBACK');
    other.close();
    db.close();
  }
});
function child(filename: string, port: number) {
  const process = fork(
    new URL('./fixtures/owner.ts', import.meta.url),
    [filename, String(port)],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  const message = once(process, 'message').then(
    ([value]) => value as { ready?: boolean; port?: number; code?: string },
  );
  return { process, message };
}
async function kill(process: ChildProcess) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exit = once(process, 'exit');
  process.kill('SIGKILL');
  await exit;
}
test('two processes on same or different ports cannot steal ownership; crash releases lock', async () => {
  const filename = path(),
    db = new Database(filename);
  initializeDatabase(db);
  const id = createSubmissionService(createSubmissionRepository(db)).submit({
    text: 'hello',
  }).id;
  const owner = child(filename, 0);
  const children = [owner.process];
  try {
    const ready = await owner.message;
    expect(ready.ready).toBe(true);
    expect(createQueryRepository(db).findById(id)?.status).toBe('running');
    for (const port of [ready.port!, 0]) {
      const contender = child(filename, port);
      children.push(contender.process);
      expect(await contender.message).toEqual({ code: 'COMMON_0007' });
      expect(createQueryRepository(db).findById(id)?.status).toBe('running');
    }
    await kill(owner.process);
    expect(existsSync(`${filename}.worker-lock.sqlite`)).toBe(true);
    const successor = child(filename, 0);
    children.push(successor.process);
    expect((await successor.message).ready).toBe(true);
    expect(createQueryRepository(db).findById(id)).toMatchObject({
      status: 'dead',
      attempts: 1,
      errorCode: 'PROVIDER_0005',
    });
  } finally {
    for (const process of children) await kill(process);
    db.close();
  }
}, 10000);
