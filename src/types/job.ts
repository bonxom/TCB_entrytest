export interface SubmitJobInput {
  text: string;
  callbackUrl?: string;
}
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
export interface SummaryResult {
  summary: string;
  usage: Usage;
}
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead';
export interface JobRow {
  id: string;
  text: string;
  callbackUrl: string | null;
  status: JobStatus;
  attempts: number;
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicrousd: number;
  createdAt: number;
  updatedAt: number;
}
export interface JobOutcome {
  status: 'succeeded' | 'failed' | 'dead';
  summary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  usage: Usage;
  costMicrousd: number;
}
export interface JobSubmissionRepository {
  insert(job: JobRow): void;
}
export interface JobQueryRepository {
  findById(id: string): JobRow | undefined;
}
export interface JobProcessingRepository {
  claimNext(now: number): JobRow | undefined;
  finish(id: string, attempt: number, outcome: JobOutcome, now: number): void;
  recoverInterrupted(now: number): number;
}
