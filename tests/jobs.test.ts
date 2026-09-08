import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';
import { initializeDatabase } from '../src/database/initialize.js';
import {
  createSubmissionRepository,
  createQueryRepository,
  createProcessingRepository,
} from '../src/repositories/jobRepository.js';
import {
  createSubmissionService,
  createQueryService,
  createProcessingService,
} from '../src/services/jobService.js';

import { parseSubmitJobBody } from '../src/validations/jobValidation.js';
import { validateSubmitJobInput } from '../src/validations/jobValidation.js';
import { createJobsRouter } from '../src/routes/jobs.js';
import { createApp } from '../src/app.js';
import { AppError } from '../src/error/AppError.js';

import { ProviderFailure } from '../src/ai/provider.js';
import { PROVIDER_ERROR } from '../src/error/definition/provider.js';
import type { SummaryResult } from '../src/types/job.js';

const directories: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-'));
  directories.push(dir);
  const path = join(dir, 'jobs.sqlite');
  const db = new Database(path);
  initializeDatabase(db);
  const submit = createSubmissionService(createSubmissionRepository(db));
  const query = createQueryService(createQueryRepository(db));
  const repository = createProcessingRepository(db);
  return { db, path, submit, query, repository };
}
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
test('HTTP normalization is distinct from internal validation, including UTF-16 boundaries', () => {
  expect(
    parseSubmitJobBody({
      text: ' hello ',
      callback_url: 'https://EXAMPLE.com',
    }),
  ).toEqual({ text: ' hello ', callbackUrl: 'https://example.com/' });
  expect(() =>
    validateSubmitJobInput({
      text: 'hello',
      callbackUrl: 'https://example.com/callback',
    }),
  ).not.toThrow();
  expect(() =>
    parseSubmitJobBody({ text: 'hello', callbackUrl: 'https://example.com' }),
  ).toThrow(AppError);
  expect(() =>
    validateSubmitJobInput({ text: '😀'.repeat(5000) }),
  ).not.toThrow();
  for (const body of [
    null,
    [],
    {},
    { text: 1 },
    { text: '' },
    { text: ' \n ' },
    { text: 'x'.repeat(10001) },
    { text: '😀'.repeat(5001) },
    { text: 'hi', extra: true },
    ...[
      null,
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com/#',
      'https://example.com/' + 'x'.repeat(2048),
    ].map((callback_url) => ({ text: 'hi', callback_url })),
  ])
    expect(() => parseSubmitJobBody(body)).toThrow(AppError);
});
test('submission commits before return, preserves text and survives reopen', () => {
  const f = fixture();
  const { id } = f.submit.submit({
    text: ' hello ',
    callbackUrl: 'https://example.com/',
  });
  expect(f.query.getById(id)).toMatchObject({
    status: 'queued',
    attempts: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost: 0,
  });
  f.db.close();
  const reopened = new Database(f.path);
  try {
    expect(createQueryRepository(reopened).findById(id)).toMatchObject({
      text: ' hello ',
      callbackUrl: 'https://example.com/',
    });
  } finally {
    reopened.close();
  }
  expect(() => f.submit.submit({ text: 'hello' })).toThrow(AppError);
});
test('POST and GET HTTP acceptance, parser errors, missing ID and privacy', async () => {
  const f = fixture();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const server = createServer(
    createApp(createJobsRouter(f.submit, f.query)),
  ).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: string, media = 'application/json') =>
    fetch(`${base}/jobs`, {
      method: 'POST',
      headers: { 'content-type': media },
      body,
    });
  try {
    const response = await post(
      JSON.stringify({
        text: 'private input',
        callback_url: 'https://example.com/private',
      }),
    );
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    expect(response.headers.get('location')).toBe(`/jobs/${id}`);
    const get = await fetch(`${base}/jobs/${id}`);
    expect(get.status).toBe(200);
    expect(get.headers.get('cache-control')).toBe('no-store');
    expect(await get.json()).toEqual({
      id,
      status: 'queued',
      summary: null,
      error: null,
      attempts: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
      cost_basis: 'assessment_rate',
    });
    for (const [body, media, status, code] of [
      ['{', 'application/json', 400, 'JOB_0002'],
      ['{}', 'text/plain', 415, 'JOB_0004'],
      [
        JSON.stringify({ text: 'x'.repeat(140000) }),
        'application/json',
        413,
        'JOB_0003',
      ],
      ['{}', 'application/json', 400, 'JOB_0001'],
    ] as const) {
      const res = await post(body, media);
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ error: { code } });
    }
    expect(f.db.prepare('SELECT count(*) AS n FROM jobs').get()).toEqual({
      n: 1,
    });
    expect((await fetch(`${base}/jobs/not-uuid`)).status).toBe(400);
    expect((await fetch(`${base}/jobs/${randomUUID()}`)).status).toBe(404);
    f.db.close();
    expect((await post('{"text":"hello"}')).status).toBe(500);
    expect(log).toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (f.db.open) f.db.close();
  }
});
test('atomic claims across connections and conditional finish prevent double accounting', () => {
  const f = fixture(),
    other = new Database(f.path);
  try {
    const { id } = f.submit.submit({ text: 'hello' });
    const claimed = f.repository.claimNext(2)!;
    expect(claimed.id).toBe(id);
    expect(claimed.attempts).toBe(1);
    expect(createProcessingRepository(other).claimNext(3)).toBeUndefined();
    const outcome = {
      status: 'succeeded' as const,
      summary: 'hi',
      errorCode: null,
      errorMessage: null,
      usage: { inputTokens: 100, outputTokens: 20 },
      costMicrousd: 600,
    };
    f.repository.finish(id, 1, outcome, 4);
    expect(() => f.repository.finish(id, 1, outcome, 5)).toThrow(AppError);
    expect(f.query.getById(id)).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      cost: 0.0006,
      input_tokens: 100,
      output_tokens: 20,
    });
  } finally {
    other.close();
    f.db.close();
  }
});
test.each([
  ['input', PROVIDER_ERROR.INVALID_INPUT, 'failed'],
  ['transient', PROVIDER_ERROR.TEMPORARY_FAILURE, 'dead'],
  ['configuration', PROVIDER_ERROR.CONFIGURATION, 'dead'],
  ['invalid_response', PROVIDER_ERROR.INVALID_RESPONSE, 'dead'],
  ['unexpected', PROVIDER_ERROR.UNEXPECTED, 'dead'],
] as const)(
  'processing classifies %s and preserves reported usage',
  async (kind, definition, status) => {
    const f = fixture();
    try {
      const { id } = f.submit.submit({ text: 'hello' });
      const process = createProcessingService(f.repository, {
        summarize: async () => {
          throw new ProviderFailure(definition, {
            kind,
            usage: { inputTokens: 100, outputTokens: 20 },
          });
        },
      });
      expect((await process.processNext()).kind).toBe(
        kind === 'configuration' ? 'halt' : 'processed',
      );
      expect(f.query.getById(id)).toMatchObject({
        status,
        attempts: 1,
        error: { code: definition.code },
        cost: 0.0006,
      });
    } finally {
      f.db.close();
    }
  },
);
test('success, unknown failures, overflow and persistence failure remain separate', async () => {
  const f = fixture();
  try {
    const id = f.submit.submit({ text: 'hello' }).id;
    const summarize = vi.fn(async (): Promise<SummaryResult> => ({
      summary: 'summary',
      usage: { inputTokens: 100, outputTokens: 20 },
    }));
    const finish = vi.fn(() => {
      throw new AppError({ code: 'DB', message: 'DB failed', statusCode: 500 });
    });
    await expect(
      createProcessingService(
        { ...f.repository, finish },
        { summarize },
      ).processNext(),
    ).rejects.toThrow(AppError);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(f.query.getById(id).status).toBe('running');
    expect(f.repository.recoverInterrupted(4)).toBe(1);
    expect(f.query.getById(id)).toMatchObject({
      status: 'dead',
      attempts: 1,
      error: { code: 'PROVIDER_0005' },
    });
    const second = f.submit.submit({ text: 'again' }).id;
    await createProcessingService(f.repository, {
      summarize: async () => {
        throw new Error('secret');
      },
    }).processNext();
    expect(f.query.getById(second)).toMatchObject({
      status: 'dead',
      error: { code: 'PROVIDER_0006' },
      cost: 0,
    });
    const third = f.submit.submit({ text: 'overflow' }).id;
    await createProcessingService(f.repository, {
      summarize: async () => ({
        summary: 'x',
        usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 },
      }),
    }).processNext();
    expect(f.query.getById(third)).toMatchObject({
      status: 'dead',
      error: { code: 'PROVIDER_0004' },
    });
  } finally {
    f.db.close();
  }
});
