import { AppError } from '../error/AppError.js';
import { JOB_ERROR } from '../error/definition/job.js';
import type { SubmitJobInput } from '../types/job.js';
export function validateSubmitJobInput(input: SubmitJobInput): void {
  if (
    !input ||
    typeof input.text !== 'string' ||
    !input.text.trim() ||
    input.text.length > 10000
  )
    throw new AppError(JOB_ERROR.INVALID_INPUT);
  if (input.callbackUrl !== undefined) {
    if (
      typeof input.callbackUrl !== 'string' ||
      input.callbackUrl.length > 2048
    )
      throw new AppError(JOB_ERROR.INVALID_INPUT);
    let url: URL;
    try {
      url = new URL(input.callbackUrl);
    } catch {
      throw new AppError(JOB_ERROR.INVALID_INPUT);
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      input.callbackUrl.includes('#')
    )
      throw new AppError(JOB_ERROR.INVALID_INPUT);
  }
}
export function validateJobId(id: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new AppError(JOB_ERROR.INVALID_INPUT);
}

export function parseSubmitJobBody(body: unknown): SubmitJobInput {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== 'text' && key !== 'callback_url')
  )
    throw new AppError(JOB_ERROR.INVALID_INPUT);
  const wire = body as Record<string, unknown>;
  const input = {
    text: wire['text'],
    ...('callback_url' in wire ? { callbackUrl: wire['callback_url'] } : {}),
  } as SubmitJobInput;
  validateSubmitJobInput(input);
  if (input.callbackUrl !== undefined)
    input.callbackUrl = new URL(input.callbackUrl).href;
  validateSubmitJobInput(input);
  return input;
}
