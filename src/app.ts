import express, { Router } from 'express';
import { AppError } from './error/AppError.js';
import { COMMON_ERROR } from './error/definition/common.js';
import { errorHandler } from './error/error-handler.js';

export function createApp(routes: Router = Router()): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(routes);
  app.use((_req, _res, next) => next(new AppError(COMMON_ERROR.NOT_FOUND)));
  app.use(errorHandler);
  return app;
}
