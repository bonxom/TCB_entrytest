import { createApp } from './app.js';

const host = process.env['HOST'] ?? '127.0.0.1';
const port = Number(process.env['PORT'] ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

const server = createApp().listen(port, host, () => {
  console.log(`Development scaffold listening at http://${host}:${port}`);
});

server.on('error', (error) => {
  console.error('Could not start server:', error.message);
  process.exitCode = 1;
});
