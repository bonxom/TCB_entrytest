# Design: Async Summarization Service

## Architecture and trade-offs

- TypeScript + Express + SQLite as storage and queue: simple deployment, but synchronous DB work shares the API event loop.
- Layered HTTP flow; POST commits before 202. Provider interface supports the seeded stub and Responses adapter; their behavior differs.
- One sequential worker, polling every 250 ms; the stub's second slot is unused.
- SQLite sidecar enforces one local process owner. Provider calls hold no jobs DB transaction; Docker persistence is not a backup.

## Failures, recovery and shutdown

- Atomic claim increments attempts; conditional finish saves outcome and accounting. Success → `succeeded`, input rejection → `failed`, other provider failures → `dead`.
- Configuration errors stop claims (POST/health 503, GET available); persistence errors shut down the service.
- Acquire ownership and bind HTTP before recovery: interrupted `running` → `dead`; queued jobs resume, terminal jobs do not.
- Shutdown drains HTTP/worker before closing DB. SDK timeout: 30s; HTTP drain: 35s; Docker grace: 40s. Forced termination may interrupt work.

## Delivery guarantees

- **At most one application attempt per job:** no SDK retries; recovery marks interrupted jobs `dead` without replay.
- **Neither at-least-once delivery nor exactly-once execution is guaranteed:** crashes can prevent a provider call or lose its unpersisted result.
- Atomic claims and conditional finishes protect local state/accounting, not remote execution. Repeated POST requests create separate jobs.

## Poison jobs and fairness

- Failed/crashing jobs are not replayed automatically; manual resubmission can repeat the failure. Add diagnostics and controlled redrive later.
- No queue cap or tenant fairness. A 10,000-job burst delays later jobs (~5.6 hours at 2s per attempt, excluding overhead).
- Prioritize a global queue cap, then tenant quotas and fair scheduling if needed.

## Scaling and spend

- At 100x load, measure queue age, provider latency and DB contention; start with two bounded worker slots sharing one provider.
- Beyond one host: separate API/workers, use leased claims or a durable broker, and preserve global provider limits.
- Current spend limits: 10,000 input code units, one attempt, no SDK retries, 1,024 output tokens in Responses mode.
- Cost: reported usage × assessment rates, stored as integer micro-USD; not the model's invoice. Missing usage does not mean free execution.
- No global budget: add budget reservation, usage reconciliation and alerts before expanding retries/concurrency.

## Deferred work

- Persisted retries/backoff honoring Retry-After, submission idempotency and two-slot processing.
- Queue caps, metrics, retention, migrations and backups.
- Secure, durable callback delivery; callback URLs are currently stored only.

## Evidence and limitations

- Tests cover submit/poll, persistence, accounting, provider fakes, shutdown, recovery and ownership contention; not rerun for this documentation edit.
- Live gateway compatibility and statistical validation of stub randomness are not claimed.
