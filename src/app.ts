import express from 'express';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  return app;
}
