import type { ErrorDefinition } from './ErrorDefinition.js';

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(definition: ErrorDefinition, options?: ErrorOptions) {
    super(definition.message, options);
    this.name = 'AppError';
    this.code = definition.code;
    this.statusCode = definition.statusCode;
  }
}
