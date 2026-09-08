import type { ErrorDefinition } from '../ErrorDefinition.js';

export const COMMON_ERROR = {
  UNCATEGORIZED_EXCEPTION: {
    code: 'COMMON_0001',
    message: 'Internal server error',
    statusCode: 500,
  },
  VALIDATION_ERROR: {
    code: 'COMMON_0002',
    message: 'Invalid request input',
    statusCode: 400,
  },
  NOT_FOUND: {
    code: 'COMMON_0003',
    message: 'Resource not found',
    statusCode: 404,
  },
  CONFIGURATION_ERROR: {
    code: 'COMMON_0004',
    message: 'Invalid service configuration',
    statusCode: 500,
  },
  SERVER_STARTUP_ERROR: {
    code: 'COMMON_0005',
    message: 'Could not start HTTP server',
    statusCode: 500,
  },
  DATABASE_ERROR: {
    code: 'COMMON_0006',
    message: 'Database operation failed',
    statusCode: 500,
  },
} as const satisfies Record<string, ErrorDefinition>;
