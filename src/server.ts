import { handleFatalError } from './error/error-handling.js';
import { startServer } from './startup.js';

async function main(): Promise<void> {
  const server = await startServer();
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main().catch(handleFatalError);
