import { createServer, type Server } from 'node:http';
import { createApp } from './app.js';
import { openDatabase } from './database/connection.js';
import { initializeDatabase } from './database/initialize.js';
import { AppError } from './error/AppError.js';
import { COMMON_ERROR } from './error/definition/common.js';

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

export async function startServer(): Promise<Server> {
  const host = process.env['HOST'] ?? '127.0.0.1';
  const port = Number(process.env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError(COMMON_ERROR.CONFIGURATION_ERROR, {
      cause: new Error('PORT must be an integer between 1 and 65535.'),
    });
  }

  const db = openDatabase();
  let started = false;
  try {
    initializeDatabase(db);
    const server = createServer(createApp());
    await listen(server, host, port);
    server.once('close', () => db.close());
    started = true;
    console.log(`SQLite initialized at ${db.name}`);
    console.log(`Development scaffold listening at http://${host}:${port}`);
    return server;
  } finally {
    // Preserve the original thrown error while releasing an opened connection.
    if (!started && db.open) db.close();
  }
}
