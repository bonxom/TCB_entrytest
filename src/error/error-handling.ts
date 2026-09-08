import { COMMON_ERROR } from './definition/common.js';
import { AppError } from './AppError.js';

export function logError(error: unknown): void {
  console.error(
    error instanceof AppError
      ? error.code
      : COMMON_ERROR.UNCATEGORIZED_EXCEPTION.code,
    error,
  );
}

// Process boundary: startup errors cannot be sent through HTTP middleware.
export function handleFatalError(error: unknown): void {
  logError(error);
  process.exitCode = 1;
}
