import type { AppError } from '../error/AppError.js';
import type { ProcessStep } from '../services/jobService.js';
export type WorkerExit =
  | { reason: 'stopped' }
  | { reason: 'configuration'; error: AppError }
  | { reason: 'persistence'; error: unknown };
export interface WorkerHandle {
  done: Promise<WorkerExit>;
  requestStop(): void;
}
export function startWorker(
  processNext: () => Promise<ProcessStep>,
): WorkerHandle {
  let stopping = false;
  let wake: (() => void) | undefined;
  async function run(): Promise<WorkerExit> {
    try {
      while (!stopping) {
        const step = await processNext();
        if (step.kind === 'halt')
          return { reason: 'configuration', error: step.error };
        if (step.kind === 'idle' && !stopping)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              wake = undefined;
              resolve();
            }, 250);
            wake = () => {
              clearTimeout(timer);
              wake = undefined;
              resolve();
            };
          });
      }
      return { reason: 'stopped' };
    } catch (error) {
      return { reason: 'persistence', error };
    }
  }
  return {
    done: run(),
    requestStop() {
      stopping = true;
      wake?.();
    },
  };
}
