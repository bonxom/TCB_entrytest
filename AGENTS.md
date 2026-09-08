# Project instructions

## Source and scope

Build the Async Summarization Service described in `Tech%20Assessment%2001_%20Async%20Summarization%20Service.pdf`. Read that assessment when resolving requirements. Explicit user decisions take precedence over these instructions.

- Use TypeScript and SQLite. Use strict TypeScript settings.
- Complete the required core first. The assessment allows 4–5 hours and explicitly prefers a smaller working submission over unfinished extensions.
- Work on extensions only as time and user direction allow. Report omissions honestly; do not claim unimplemented or untested guarantees.
- Keep project instructions in this single root `AGENTS.md`; do not create nested instruction files.
- The current documentation task authorizes only this file. Do not scaffold or implement the application until requested.

## Workflow and API

1. `POST /jobs` accepts `{ "text": "...", "callback_url": "https://..." }`, with an optional callback URL. Persist the job before returning HTTP 202 with its ID. Do not wait for summarization in the request handler.
2. Background processing claims a queued job, records an attempt, calls the provider through an interface, and persists the outcome.
3. `GET /jobs/{id}` returns status, summary on success, error details on failure, attempt count, input tokens, output tokens, and accumulated job cost. Return a typed not-found error for an unknown job.
4. `GET /healthz` exposes service liveness/readiness. Document what it checks; readiness should account for usable SQLite storage.

The lifecycle is `queued -> running -> succeeded | failed | dead`:

- `succeeded`: the provider returned a summary.
- `failed`: a permanent rejection means retrying will not help, such as provider HTTP 400 `invalid_input`.
- `dead`: transient errors exhausted the configured retry budget.

If retries are implemented, document how running jobs become eligible for another attempt and how attempts and scheduling are persisted. Persist job state across process restarts and define recovery for interrupted running jobs so they do not remain stuck indefinitely.

## Preferred application architecture

Every API follows:

Use route -> validation -> controller -> service -> repository
for job-related flows where those layers add meaningful separation.

Avoid layers that only forward arguments without adding responsibility.
Simple endpoints such as health checks may remain lightweight.

- **Routes** register paths, HTTP methods, validation/middleware, and controller handlers. Do not put business logic or SQL here.
- **Middleware/validation** validates and normalizes HTTP parameters, query strings, headers, and bodies before the controller. Validate transport shape here; services enforce business invariants for all callers, including workers.
- **Controllers** translate validated HTTP input into service arguments and service results into HTTP responses. Forward failures with `next(error)`. Keep domain rules, provider calls, retry orchestration, and database queries out of controllers. Controllers must not call repositories directly.
- **Services** own business rules, job transitions, provider orchestration, retry classification/policy, and accounting. They use repositories for persistence and a provider interface for external calls. Keep services independent of HTTP request/response objects.
- **Repositories** own all SQLite queries, persistence mapping, and atomic database operations. Use parameterized queries. Keep HTTP handling and retry policy out of repositories.

Workers call services directly rather than going through HTTP controllers. Services may use provider adapters alongside repositories; those adapters own provider transport/stub behavior. Choose a framework compatible with the requested `next(error)` controller contract; Express is a reasonable default, not an assessment requirement.

## Typed errors and central error handling

- Define expected failure types in a shared `errors.ts`, rooted in `AppError`, with a stable error code, message, and an explicit HTTP mapping contract.
- Throw these typed errors for expected failures. Do not use arbitrary strings, generic errors, or ad hoc response objects for known application failures.
- Controllers forward caught failures to `next(error)`; do not map errors to HTTP responses individually.
- Register central error middleware after routes. It maps `AppError` instances to consistent HTTP status codes and JSON error responses.
- Unexpected errors produce a generic HTTP 500 response and are logged internally. Do not expose stack traces, SQL, or internal exception details to clients.
- Provider failures during asynchronous execution are classified by services and persisted as job outcomes or retry scheduling. They do not retroactively change the already returned HTTP 202 response. Workers must handle and record failures rather than allowing unhandled rejections.
- Distinguish HTTP submission validation errors from accepted jobs that later fail at the provider. Document where empty/oversized text is rejected and test that contract.

## Provider stub contract

Use a replaceable/fakeable provider interface. A local stub is sufficient; treat it as remote even if it runs in-process. A real LLM is unnecessary.

- Latency: uniformly random 1,000–3,000 ms per call.
- Transient failure: approximately 15% of calls return HTTP 500.
- Concurrency: at most two in-flight calls; excess calls return HTTP 429 with `Retry-After` of 1–3 seconds.
- Invalid input: empty text or text longer than 10,000 characters returns HTTP 400 with a code such as `invalid_input`.
- Success shape: `{ "summary": "...", "input_tokens": N, "output_tokens": M }`.
- Input tokens: `ceil(len(text) / 4)`.
- Output tokens: `ceil(input_tokens * 0.2)`.
- Cost in USD: `(input_tokens / 1000) * 0.003 + (output_tokens / 1000) * 0.015`.
- Randomness is seeded from `SEED` so a run is reproducible. Use controllable randomness/time in tests.
- Summary text may be a truncation or first two sentences; summary quality is not assessed.

Do not weaken the provider contract to make the client pass. Distinguish the provider's concurrency limit from optional client-side backpressure. If multiple workers are added, explain how they share the effective provider limit.

## SQLite and reliability

- Use a file-backed database for normal operation, with an explicit schema initialization or migration path. Reserve in-memory databases for suitable tests.
- Persist the fields needed for job status, attempts, results/errors, and usage/cost. Store additional retry, lease, or idempotency data only when implementing those features.
- Use transactions and conditional updates for atomic claims and related state changes. Keep provider/network calls outside database transactions.
- Let services define the required atomic business operation and repositories implement its database mechanics.
- Use a precise monetary representation, such as integer units small enough for the specified per-token prices, and document conversion to API currency values.
- Distinguish preventing concurrent claims from exactly-once provider execution. A crash after a provider call but before recording its result can cause a repeat call; do not claim exactly-once behavior without a mechanism that guarantees it.

## Priorities from the assessment

**Core, required:** all three endpoints work end to end; persisted state survives restart; README contains exact run/test commands; include meaningful tests.

**Extension A, optional:** worker runs separately from the API request path; retries use backoff and honor `Retry-After` on 429; `docker compose up` starts the whole system; tests exercise failure paths.

**Extension B, optional:** submission idempotency key; retryable/terminal classification and dead-lettering; safe multiple workers; backpressure or rate limiting; graceful shutdown; useful health and metrics; per-job and total token/cost accounting. Per-job accounting is already part of the specified GET response.

**Extension C, optional:** a 1–2 page `DESIGN.md` discussing selected trade-offs, crash behavior, delivery guarantees, poison jobs, tenant fairness, 100x scale, spend control, and future work.

No frontend, authentication/accounts, multi-tenancy plumbing, real LLM, cloud deployment, Terraform, or Kubernetes is required.

## Decisions to make explicit during implementation

The PDF leaves these details open. Use a documented, proportionate decision when implementation reaches them, and ask the user if the choice materially changes scope:

- Callback delivery: the input field is specified, but payload, delivery guarantees, timeout, retries, and security policy are not. Do not silently promise webhook delivery. If implementing outbound callbacks, validate destinations and prevent access to internal/private network resources, including through redirects.
- Billing failed attempts: the provider only specifies usage on success. A reasonable initial assumption is to accumulate reported usage only and document that failed-call billing is unknown; do not invent usage for errors.
- Retry limits, delay bounds, timeouts, and running-job recovery policy.
- Exact response/error schemas, character-counting semantics, and idempotency conflict behavior if that extension is implemented.

## Verification and handoff

- Test the end-to-end submit/poll flow, persistence/restart behavior, validation/not-found errors, and token/cost calculations.
- When implementing reliability features, test terminal rejection, transient retries, 429 delays, exhausted retries, and interrupted work. Test concurrent claiming and idempotency if those features are included.
- Favor deterministic provider fakes and controlled time over slow, probabilistic tests.
- Run the implemented typecheck and relevant tests before handoff. Report actual results and any checks that could not run.
- When application work is requested, create a README documenting exact setup/run/test commands, environment variables, error classification and rationale, assumptions, completed scope, and skipped work with reasons. Add `DESIGN.md` only if doing Extension C.
- Preserve existing work and honest commit history. Avoid unrelated changes or fabricated claims of completeness.
