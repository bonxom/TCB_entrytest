import { startServer } from '../../src/startup.js';
void startServer({
  databasePath: process.argv[2]!,
  port: Number(process.argv[3]),
  provider: { summarize: () => new Promise(() => {}) },
})
  .then((service) => {
    process.send?.({
      ready: true,
      port: (service.server.address() as { port: number }).port,
    });
  })
  .catch((error) => {
    process.send?.({ code: error.code });
    process.exitCode = 1;
    process.disconnect?.();
  });
