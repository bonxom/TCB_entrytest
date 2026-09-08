# Async Summarization Service

Node.js 22, strict TypeScript, Express 5 and embedded SQLite. Implements durable
`POST /jobs`, asynchronous processing, `GET /jobs/:id` polling and `GET /healthz`.
The real provider uses the official OpenAI SDK **Responses API**. A seeded local
stub implements the assessment provider contract for offline runs.

## Run with Docker

No local SQLite, Node or pnpm installation is needed.

```sh
# Only if you do not already have .env:
cp .env.example .env
# Set API_KEY, BASE_URL and MODEL in .env, then:
docker compose up --build
```

`BASE_URL` is the API base (for example `https://api.openai.com/v1`), not the full
`/responses` endpoint. Your gateway and selected model must support Responses;
there is no Chat Completions fallback. No live provider request is made at startup.

For an offline assessment run without credentials:

```sh
AI_PROVIDER=stub docker compose up --build
```

`AI_PROVIDER` is optional: the default is `openai`; `stub` selects the local
assessment simulator. You only need `API_KEY`, `BASE_URL`, and `MODEL` for real AI.
Tests inject fakes and never use your key.

```sh
docker compose run --rm --no-deps app pnpm run check
docker compose logs -f app
docker compose down
```

SQLite runs **inside the app process**, through `better-sqlite3`, not as a separate
server. The named `sqlite-data` volume holds `/app/data/jobs.sqlite` and its worker
ownership sidecar. `docker compose down` preserves data; adding `-v` deletes it.
Only one service process may own a database, even on different HTTP ports.

Compose injects settings as environment variables. `.env` is excluded from the
image; the optional local env-file loader may report it missing inside Docker,
which does not mean Compose variables are missing. Source/tests are mounted read-only
and `tsx watch` reloads source changes. Rebuild after dependency/configuration
changes. This is a development image. Host port binds to localhost; override with
`PORT=3001 docker compose up --build`.

## Local setup

```sh
nvm install
nvm use
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
# Only if .env does not exist:
cp .env.example .env
# Fill the AI settings, or select the stub:
AI_PROVIDER=stub pnpm run dev
```

Node 22.20+ (22.x) is required. SQLite needs no standalone installation; building
the native addon from source requires Python 3 and a C/C++ toolchain.

```sh
pnpm run check                 # typecheck, all tests, build, formatting
pnpm test
pnpm run test:watch
pnpm run build
pnpm start
```

## API

```sh
curl -i http://127.0.0.1:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"text":"A long article to summarize.","callback_url":"https://example.com/callback"}'
# HTTP 202, Location: /jobs/<id>, body: {"id":"<uuid>"}

curl http://127.0.0.1:3000/jobs/<id>
curl http://127.0.0.1:3000/healthz
```

POST validates and commits the row **before** returning 202. It does not call or
wait for AI. `text` must contain non-whitespace content and be at most 10,000
UTF-16 code units (JavaScript string length); original text is preserved.
`callback_url` is optional, HTTPS only, at most 2,048 characters, without credentials
or fragments. It is normalized and **stored only; no webhook is sent**. Unknown
fields are rejected. JSON body limit is 128 KiB; Content-Type must be application/json.

GET returns HTTP 200 for every existing job, including terminal failures:

```json
{
  "id": "00000000-0000-4000-8000-000000000001",
  "status": "succeeded",
  "summary": "A concise summary.",
  "error": null,
  "attempts": 1,
  "input_tokens": 100,
  "output_tokens": 20,
  "cost": 0.0006,
  "cost_basis": "assessment_rate"
}
```

Summary is null before success. Terminal errors have `{ "code": "PROVIDER_...",
"message": "..." }`. GET excludes input text, callback URL and internal causes.
Job and health responses use `Cache-Control: no-store`.

## States, accounting and recovery

```text
queued -> running -> succeeded | failed | dead
```

| State     | Meaning                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| queued    | Persisted, waiting for worker; attempts = 0                                              |
| running   | Atomically claimed; attempt incremented before provider call                             |
| succeeded | Valid summary and reported usage persisted                                               |
| failed    | Confirmed permanent input rejection or refusal                                           |
| dead      | One-attempt budget exhausted, interrupted execution, configuration or unexpected failure |

This version permits **one attempt**, with no automatic retries or terminal requeue.
429, timeout, network failure and provider 5xx become dead. Invalid/incomplete
responses become dead too. Unsupported model/parameter and 401/403/404 are service
configuration errors: current job becomes dead, worker stops claiming, GET remains
available, POST and health return 503. Fix configuration and restart to resume queued
jobs; terminal jobs stay terminal. Unknown HTTP 400 is not assumed to be invalid text.

A separate SQLite file `<real database path>.worker-lock.sqlite` holds a lifetime
`BEGIN IMMEDIATE` transaction. Acquire it before schema initialization; bind HTTP
before recovering interrupted `running` jobs to `dead` (`PROVIDER_0005`). Queued rows
survive and resume. Never delete the sidecar to release a lock: SQLite/OS releases
it when the owning connection/process closes. This supports a shared **local
filesystem**, not NFS, hard-link aliases, distributed replicas or copied databases.
Network calls never hold a transaction on the jobs database.

Claims and conditional finishes are transactional. A finish requires the matching
running attempt, preventing duplicate outcome writes and accounting. A persistence
failure halts the worker, drains HTTP and closes resources with exit code 1; restart
recovers any remaining running job. There is **no exactly-once provider guarantee**:
a crash after a billable call can lose the unpersisted result/usage.

SIGINT/SIGTERM stop new claims and HTTP acceptance, wait for in-flight HTTP and the
worker, then close the DB and release ownership. SDK timeout is 30 seconds; HTTP
drain is bounded at 35 seconds; Compose allows 40 seconds. Forced termination uses
the interrupted-job recovery policy on restart.

Tokens are actual reported usage for Responses and the specified estimates for
the stub. Store integer micro-USD: `3 * input_tokens + 15 * output_tokens`; divide
by 1,000,000 in GET. Accumulate reported usage even on failures. Missing usage adds
zero **reported** units; it does not prove a failed call was free. Cost uses assessment
rates, not your model's invoice; `cost_basis` makes that distinction explicit.

Stub: seeded uniform 1–3s delay, ~15% transient failures, two in-flight slots,
excess calls rejected with a 1–3s Retry-After, input tokens `ceil(length/4)` and
output tokens `ceil(input_tokens*0.2)`. The current worker calls sequentially; the
adapter's independent two-call limit is still enforced and tested.

## Health and errors

Healthy response: `{"status":"ok","checks":{"sqlite":"ok"}}`. Health checks worker
readiness first, then reads jobs and executes a no-row update in an immediate
transaction. It briefly takes a write lock with a 100ms busy timeout, restoring
the previous timeout afterwards. It cannot prove a future write will fit on disk
and does not probe the remote provider. HTTP responding with 503 is alive but not
ready; this is a combined endpoint, not a separate liveness-only probe.

HTTP errors use one envelope:

```json
{ "error": { "code": "JOB_0001", "message": "Invalid job input" } }
```

| Code        | HTTP | Meaning                                             |
| ----------- | ---- | --------------------------------------------------- |
| JOB_0001    | 400  | Invalid body, callback or UUID                      |
| JOB_0002    | 400  | Malformed JSON                                      |
| JOB_0003    | 413  | Body over limit                                     |
| JOB_0004    | 415  | Wrong media type                                    |
| JOB_0005    | 404  | Unknown job                                         |
| JOB_0006    | 503  | Submission unavailable                              |
| HEALTH_0001 | 503  | SQLite not ready                                    |
| HEALTH_0002 | 503  | Worker not ready                                    |
| COMMON_0001 | 500  | Unexpected HTTP error                               |
| COMMON_0003 | 404  | Unknown route                                       |
| COMMON_0004 | 500  | Invalid local configuration (startup failure)       |
| COMMON_0005 | 500  | Bind/listen failure (startup failure)               |
| COMMON_0006 | 500  | Database operation failed                           |
| COMMON_0007 | 503  | Another process owns the database (startup failure) |

Expected failures use `src/error/AppError.ts`; definitions live in
`src/error/definition/`. Controllers forward to central middleware with `next(error)`.
Provider failures are persisted asynchronously, never sent retroactively to POST.
Logging only includes whitelisted error code/name; raw errors, causes, prompts and
SDK responses are not logged. Morgan logs HTTP access metadata.

## Environment

Shell settings take precedence over the optional local `.env`.

| Variable      | Default            | Purpose                                       |
| ------------- | ------------------ | --------------------------------------------- |
| HOST          | 127.0.0.1          | HTTP bind address; Compose uses 0.0.0.0       |
| PORT          | 3000               | Local HTTP / Compose published host port      |
| DATABASE_PATH | ./data/jobs.sqlite | Local DB; Compose fixes /app/data/jobs.sqlite |
| AI_PROVIDER   | openai             | openai or offline stub                        |
| API_KEY       | none               | Required for openai                           |
| BASE_URL      | none               | Required HTTP(S) API base for openai          |
| MODEL         | none               | Required Responses-compatible model           |
| SEED          | 42                 | Integer seed for stub                         |

## Scope and verification

Tests cover submission/polling, validation, persistence, atomic claims/finishes,
accounting, provider classifications, SDK requests with fake fetch, stub timing and
concurrency, shutdown, recovery, and real competing processes. They use temporary
DBs; no billable AI requests are made. Custom gateway compatibility is not live-tested.
Schema initialization uses the existing table and `CREATE IF NOT EXISTS`; future
schema changes need migrations.

Source layout follows responsibility layers:

```text
src/
  routes/         controllers/    services/       repositories/
  validations/    middlewares/    types/          workers/
  config/         ai/             database/       error/
  app.ts          server.ts       startup.ts
```

HTTP flows through route → middleware/pure validation → controller → service →
repository. `validations/jobValidation.ts` contains the pure wire parser and internal
invariant checks; `middlewares/validateJob.ts` handles Express and typed locals.
`ai/` owns provider transport, `workers/jobWorker.ts` owns polling and
`workers/workerReadiness.ts` describes lifecycle readiness. The SQLite sidecar lock
lives in `database/workerOwnership.ts`; `startup.ts` coordinates ownership and cleanup.
`config/aiConfig.ts` reads environment settings. AppError/definitions and safe process
logging stay in `error/`; HTTP error middleware lives in `middlewares/`.

Deferred: retries/backoff, webhook delivery, idempotency, multiple workers, backpressure,
authentication, metrics and an Extension C DESIGN.md. These are outside this iteration.
