import type { ErrorDefinition } from '../ErrorDefinition.js';
export const PROVIDER_ERROR = {
  INVALID_INPUT: {
    code: 'PROVIDER_0001',
    message: 'Provider rejected the input',
    statusCode: 400,
  },
  TEMPORARY_FAILURE: {
    code: 'PROVIDER_0002',
    message: 'Provider temporarily unavailable',
    statusCode: 503,
  },
  CONFIGURATION: {
    code: 'PROVIDER_0003',
    message: 'Provider configuration is invalid',
    statusCode: 500,
  },
  INVALID_RESPONSE: {
    code: 'PROVIDER_0004',
    message: 'Provider returned an invalid response',
    statusCode: 502,
  },
  INTERRUPTED: {
    code: 'PROVIDER_0005',
    message: 'Processing was interrupted',
    statusCode: 503,
  },
  UNEXPECTED: {
    code: 'PROVIDER_0006',
    message: 'Unexpected provider failure',
    statusCode: 500,
  },
} as const satisfies Record<string, ErrorDefinition>;
