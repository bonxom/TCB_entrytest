import { Router } from 'express';
import { AppError } from '../error/AppError.js';
import { JOB_ERROR } from '../error/definition/job.js';
import { createJobsController } from '../controllers/jobController.js';
import type {
  SubmissionService,
  QueryService,
} from '../services/jobService.js';

import type { Readiness } from '../workers/workerReadiness.js';
import {
  validateSubmitJob,
  validateJobParameter,
} from '../middlewares/validateJob.js';
export function createJobsRouter(
  submission: SubmissionService,
  query: QueryService,
  readiness: Readiness = { ready: true, initialized: true },
): Router {
  const router = Router(),
    controller = createJobsController(submission, query);
  router.use('/jobs', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next(
      readiness.initialized
        ? undefined
        : new AppError(JOB_ERROR.SERVICE_UNAVAILABLE),
    );
  });
  router.post(
    '/jobs',
    (_req, _res, next) =>
      next(
        readiness.ready
          ? undefined
          : new AppError(JOB_ERROR.SERVICE_UNAVAILABLE),
      ),
    validateSubmitJob,
    controller.submit,
  );
  router.get('/jobs/:id', validateJobParameter, controller.get);
  return router;
}
