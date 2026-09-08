import type { ErrorDefinition } from '../ErrorDefinition.js';

export const HEALTH_ERROR = {
  WORKER_UNAVAILABLE: {
    code: 'HEALTH_0002',
    message: 'Job worker is not ready',
    statusCode: 503,
  },
  STORAGE_UNAVAILABLE: {
    code: 'HEALTH_0001',
    message: 'SQLite storage is not ready',
    statusCode: 503,
  },
} as const satisfies Record<string, ErrorDefinition>;
