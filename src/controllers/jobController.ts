import type { NextFunction, Request, Response } from 'express';
import type {
  SubmissionService,
  QueryService,
} from '../services/jobService.js';
import type { JobLocals } from '../middlewares/validateJob.js';

export function createJobsController(
  submissionService: SubmissionService,
  queryService: QueryService,
) {
  function submitJob(
    _req: Request,
    res: Response<unknown, JobLocals>,
    next: NextFunction,
  ): void {
    try {
      const input = res.locals.jobInput;
      const job = submissionService.submit(input);

      res.location(`/jobs/${job.id}`).status(202).json(job);
    } catch (error) {
      next(error);
    }
  }

  function getJobById(req: Request, res: Response, next: NextFunction): void {
    try {
      const jobId = String(req.params['id']);
      const job = queryService.getById(jobId);

      res.json(job);
    } catch (error) {
      next(error);
    }
  }

  return { submit: submitJob, get: getJobById };
}
