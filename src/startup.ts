import { createServer, type Server } from 'node:http';
import { Router } from 'express';
import { createApp } from './app.js';
import { checkDatabaseReadiness } from './database/health.js';
import { createHealthRouter } from './routes/health.js';
import { createJobsRouter } from './routes/jobs.js';
import { openDatabase } from './database/connection.js';
import { initializeDatabase } from './database/initialize.js';
import { AppError } from './error/AppError.js';
import { COMMON_ERROR } from './error/definition/common.js';
import { HEALTH_ERROR } from './error/definition/health.js';
import { handleFatalError, logError } from './error/error-handling.js';
import { acquireWorkerOwnership } from './database/workerOwnership.js';
import {
  createSubmissionRepository,
  createQueryRepository,
  createProcessingRepository,
} from './repositories/jobRepository.js';
import {
  createSubmissionService,
  createQueryService,
  createProcessingService,
} from './services/jobService.js';

import { startWorker, type WorkerHandle } from './workers/jobWorker.js';
import type { Readiness } from './workers/workerReadiness.js';
import type { SummarizationProvider } from './ai/provider.js';
import { readAiConfig } from './config/aiConfig.js';
import { createOpenAIClient } from './ai/openai-client.js';
import { createOpenAIProvider } from './ai/openai-provider.js';
import { createStubProvider } from './ai/stub-provider.js';

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (cause: Error): void => {
      server.removeListener('listening', onListening);
      reject(new AppError(COMMON_ERROR.SERVER_STARTUP_ERROR, { cause }));
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function drainHttp(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), 35000);
    timer.unref();
    server.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}
export interface RunningService {
  server: Server;
  stop(): Promise<void>;
}
export interface StartOptions {
  host?: string;
  port?: number;
  databasePath?: string;
  provider?: SummarizationProvider;
  onFatal?: (error: unknown) => void;
}
export async function startServer(
  options: StartOptions = {},
): Promise<RunningService> {
  const host = options.host ?? process.env['HOST'] ?? '127.0.0.1';
  const port = options.port ?? Number(process.env['PORT'] ?? 3000);
  if (
    !Number.isInteger(port) ||
    port < (options.port === 0 ? 0 : 1) ||
    port > 65535
  )
    throw new AppError(COMMON_ERROR.CONFIGURATION_ERROR);
  let provider = options.provider;
  if (!provider) {
    const config = readAiConfig(process.env);
    provider =
      config.provider === 'stub'
        ? createStubProvider({ seed: config.seed })
        : createOpenAIProvider(createOpenAIClient(config), config.model);
  }
  const db = openDatabase(options.databasePath);
  let ownership: ReturnType<typeof acquireWorkerOwnership> | undefined;
  let server: Server | undefined;
  let worker: WorkerHandle | undefined;
  const readiness: Readiness = { ready: false, initialized: false };
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (!stopping) {
      readiness.ready = false;
      worker?.requestStop();
      stopping = (async () => {
        try {
          const results = await Promise.allSettled([
            server ? drainHttp(server) : Promise.resolve(),
            worker?.done,
          ]);
          const failed = results.find((result) => result.status === 'rejected');
          if (failed?.status === 'rejected') throw failed.reason;
        } finally {
          try {
            if (db.open) db.close();
          } finally {
            ownership?.release();
          }
        }
      })();
    }
    return stopping;
  };
  try {
    ownership = acquireWorkerOwnership(db.name);
    initializeDatabase(db);
    const processingRepository = createProcessingRepository(db);
    const processing = createProcessingService(processingRepository, provider);
    const routes = Router();
    routes.use(
      createHealthRouter(() => {
        if (!readiness.ready)
          throw new AppError(HEALTH_ERROR.WORKER_UNAVAILABLE);
        checkDatabaseReadiness(db);
      }),
    );
    routes.use(
      createJobsRouter(
        createSubmissionService(createSubmissionRepository(db)),
        createQueryService(createQueryRepository(db)),
        readiness,
      ),
    );
    server = createServer(createApp(routes));
    await listen(server, host, port);
    processingRepository.recoverInterrupted(Date.now());
    readiness.initialized = true;
    readiness.ready = true;
    worker = startWorker(() => processing.processNext());
    void worker.done
      .then(async (exit) => {
        if (exit.reason === 'configuration') {
          readiness.ready = false;
          logError(exit.error);
        }
        if (exit.reason === 'persistence') {
          readiness.ready = false;
          await stop();
          (options.onFatal ?? handleFatalError)(exit.error);
        }
      })
      .catch(options.onFatal ?? handleFatalError);
    console.log(`SQLite initialized at ${db.name}`);
    console.log(
      `Service listening on ${host}:${(server.address() as { port: number }).port}`,
    );
    return { server, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
