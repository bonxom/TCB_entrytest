import type { RequestHandler } from 'express';
import { AppError } from '../error/AppError.js';
import { JOB_ERROR } from '../error/definition/job.js';
import {
  parseSubmitJobBody,
  validateJobId,
} from '../validations/jobValidation.js';
import type { SubmitJobInput } from '../types/job.js';
export type JobLocals = { jobInput: SubmitJobInput };
export const validateSubmitJob: RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, string>,
  JobLocals
> = (req, res, next) => {
  try {
    if (!req.is('application/json'))
      throw new AppError(JOB_ERROR.UNSUPPORTED_MEDIA);
    res.locals.jobInput = parseSubmitJobBody(req.body);
    next();
  } catch (error) {
    next(error);
  }
};
export const validateJobParameter: RequestHandler = (req, _res, next) => {
  try {
    validateJobId(String(req.params['id']));
    next();
  } catch (error) {
    next(error);
  }
};
