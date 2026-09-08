import type { ErrorDefinition } from '../ErrorDefinition.js';
export const JOB_ERROR = {
  INVALID_INPUT: {
    code: 'JOB_0001',
    message: 'Invalid job input',
    statusCode: 400,
  },
  INVALID_JSON: {
    code: 'JOB_0002',
    message: 'Invalid JSON body',
    statusCode: 400,
  },
  PAYLOAD_TOO_LARGE: {
    code: 'JOB_0003',
    message: 'Request body is too large',
    statusCode: 413,
  },
  UNSUPPORTED_MEDIA: {
    code: 'JOB_0004',
    message: 'Content-Type must be application/json',
    statusCode: 415,
  },
  NOT_FOUND: { code: 'JOB_0005', message: 'Job not found', statusCode: 404 },
  SERVICE_UNAVAILABLE: {
    code: 'JOB_0006',
    message: 'Job processing is not ready',
    statusCode: 503,
  },
} as const satisfies Record<string, ErrorDefinition>;
