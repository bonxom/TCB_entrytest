## Run with Docker

```sh
# Only if you do not already have .env:
cp .env.example .env
# Set API_KEY, BASE_URL and MODEL in .env, then:
docker compose up --build
```

`BASE_URL` is the API base (for example `https://api.openai.com/v1`), not the full
`/responses` endpoint. Your gateway and selected model must support Responses;

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

Node 22.20+ (22.x) is required. SQLite needs no standalone installation;

## How to run tests — The model provider

Run from the project root. Tests use stubs/fakes; no API key or HTTP server is needed.

What each test checks:

- **Latency:** delays within 1,000–3,000 ms using simulated waits.
- **Transient failure:** simulated 500 failures release occupied slots.
- **Concurrency limit:** two calls stay in flight; the third is rejected with a 2s Retry-After.
- **Invalid input:** empty text and text with 10,001 characters are rejected.
- **Success response:** the Responses adapter returns the expected summary and usage from a fake response.
- **Token counting:** 400 characters produce 100 input tokens and 20 output tokens.
- **Determinism:** the same seed and call order produce identical delays and outcomes.
- **Pricing:** 100 input + 20 output tokens cost USD 0.0006, without double charging.
- **Concurrency demo:** three simultaneous stub calls print successful summaries and the rejected call's Retry-After.

Some requirements share the same test, so their commands are identical.
Choose either Local or Docker below; both run the same checks in the same order.

**Current test failure:** `Responses wrapper sends` fails its retry assertion:
`openai-client.ts` sets `maxRetries: 3`, while the test expects `0`. Agree on the
retry policy before changing either. The listed stub tests and pricing test passed.

**Local commands:**

```sh
# Latency
pnpm exec vitest run tests/providers.test.ts -t 'stub seeded runs'

# Transient failure
pnpm exec vitest run tests/providers.test.ts -t 'stub seeded runs'

# Concurrency limit
pnpm exec vitest run tests/providers.test.ts -t 'stub enforces two slots'

# Invalid input
pnpm exec vitest run tests/providers.test.ts -t 'stub enforces two slots'

# Success response
pnpm exec vitest run tests/providers.test.ts -t 'Responses wrapper sends'

# Token counting
pnpm exec vitest run tests/providers.test.ts -t 'stub enforces two slots'

# Determinism
pnpm exec vitest run tests/providers.test.ts -t 'stub seeded runs'

# Pricing
pnpm exec vitest run tests/jobs.test.ts -t 'atomic claims'

# Concurrency demo
pnpm exec tsx tests/manual/stub-concurrency.ts
```

**Docker commands:**

```sh
# Latency
docker compose run --rm --no-deps app pnpm exec vitest run tests/providers.test.ts -t 'stub seeded runs'

# Transient failure
docker compose run --rm --no-deps app pnpm exec vitest run tests/providers.test.ts -t 'stub seeded runs'

# Concurrency limit
docker compose run --rm --no-deps app pnpm exec vitest run tests/providers.test.ts -t 'stub enforces two slots'

# Invalid input
docker compose run --rm --no-deps app pnpm exec vitest run tests/providers.test.ts -t 'stub enforces two slots'

# Success response
docker compose run --rm --no-deps app pnpm exec vitest run tests/providers.test.ts -t 'Responses wrapper sends'

# Token counting
docker compose run --rm --no-deps app pnpm exec vitest run tests/providers.test.ts -t 'stub enforces two slots'

# Determinism
docker compose run --rm --no-deps app pnpm exec vitest run tests/providers.test.ts -t 'stub seeded runs'

# Pricing
docker compose run --rm --no-deps app pnpm exec vitest run tests/jobs.test.ts -t 'atomic claims'

# Concurrency demo
docker compose run --rm --no-deps app pnpm exec tsx tests/manual/stub-concurrency.ts
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

- **Attempts:** one per job, no automatic retry/requeue. Rate limits, timeouts, network/5xx errors and invalid responses become `dead`; unknown HTTP 400 is not assumed to be invalid input.
- **Configuration errors:** mark the job `dead` and stop claims. POST/health return 503; GET remains available. Fix configuration and restart to resume queued jobs only.
- **Persistence:** transactional claims and conditional finishes prevent duplicate local writes/accounting. DB failures shut down with exit code 1; recovery marks interrupted running jobs `dead`. No exactly-once guarantee; crashes can lose unpersisted results/usage.
- **Shutdown:** SIGINT/SIGTERM stop new work, drain HTTP and the worker, then close DB and release ownership. SDK timeout: 30s; HTTP drain: 35s; Docker grace: 40s. Forced termination relies on restart recovery.
- **Accounting:** use reported Responses usage or stub estimates, including reported usage on failures. Store `3 × input_tokens + 15 × output_tokens` in micro-USD; GET divides by 1,000,000 and labels it `assessment_rate`. This is not the model's invoice; missing usage does not mean a free call.

### Extension B — production readiness status

- **Idempotency — not implemented:** repeated POST requests create new jobs.
- **Error classification/dead-lettering — partial:** input rejection becomes `failed`; other failures become persisted `dead` jobs after one attempt. No retry scheduling or redrive.
- **Multiple workers — not implemented:** one sequential worker and one process owner per DB; atomic claims/finishes do not guarantee exactly-once provider execution.
- **Backpressure/rate limiting — not implemented:** no queue cap or submission rate limit; the worker makes one provider call at a time.
- **Graceful shutdown — implemented with limits:** drains active work before closing storage. Forced termination recovers running jobs as interrupted `dead` jobs; unpersisted results may be lost.
- **Health/metrics — partial:** worker and SQLite readiness checks exist; dashboard metrics are not implemented.
- **Token/cost accounting — partial:** reported usage and assessment-rate cost are persisted per job; service-wide totals are not exposed.

================================

"I ran out of time here, and this is what I would have
done"
