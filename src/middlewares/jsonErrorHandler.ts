import type { ErrorRequestHandler } from 'express';
import { AppError } from '../error/AppError.js';
import { JOB_ERROR } from '../error/definition/job.js';
export const jsonErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  _res,
  next,
) => {
  if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    'status' in error
  ) {
    if (error.type === 'entity.parse.failed' && error.status === 400) {
      next(new AppError(JOB_ERROR.INVALID_JSON));
      return;
    }
    if (error.type === 'entity.too.large' && error.status === 413) {
      next(new AppError(JOB_ERROR.PAYLOAD_TOO_LARGE));
      return;
    }
  }
  next(error);
};
