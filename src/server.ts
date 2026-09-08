import { handleFatalError } from './error/error-handling.js';
import { startServer } from './startup.js';
async function main(): Promise<void> {
  const service = await startServer();
  const shutdown = (): void => {
    void service.stop().catch(handleFatalError);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
void main().catch(handleFatalError);
