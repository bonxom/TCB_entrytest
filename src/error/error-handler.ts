import type { ErrorRequestHandler } from 'express';
import { COMMON_ERROR } from './definition/common.js';
import { AppError } from './AppError.js';
import { logError } from './error-handling.js';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (!(error instanceof AppError) || error.statusCode >= 500) logError(error);

  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  const { code, message, statusCode } = COMMON_ERROR.UNCATEGORIZED_EXCEPTION;
  res.status(statusCode).json({ error: { code, message } });
};
