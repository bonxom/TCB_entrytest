# Async Summarization Service

Development environment using Node.js 22, strict TypeScript, Express, and SQLite
(`better-sqlite3`). The environment scaffold and SQLite-backed health endpoint are implemented.

## Docker setup (recommended)

Install Docker Engine/Desktop with Docker Compose. No local Node.js, pnpm, or SQLite
installation is required. From the repository root, run:

```sh
docker compose up --build
```

Open `http://127.0.0.1:3000/healthz` to check readiness.
Job endpoints are not implemented yet; unknown paths return JSON 404. Source and tests are mounted
from your checkout; source changes restart the development server automatically.
Dependencies stay inside the image, so host `node_modules` cannot overwrite the
Linux SQLite addon. After editing dependencies, configuration, or other files not
mounted by Compose, rebuild with `docker compose up --build`.

```sh
# Run all checks inside Docker, even when the app is not running.
docker compose run --rm --no-deps app pnpm run check
# Follow server logs.
docker compose logs -f app
# Stop and remove containers; keep the SQLite volume.
docker compose down
```

SQLite is embedded in the app container, so no separate database service is needed.
The named `sqlite-data` volume is mounted at `/app/data`; Compose sets
`DATABASE_PATH=/app/data/jobs.sqlite`. Startup creates the parent directory, opens
the database, and initializes the jobs table and index before accepting HTTP traffic. `docker compose down`
keeps the volume; `docker compose down -v` deletes its data.

An `.env` file is optional. Compose reads `PORT` (host port, default 3000) and `SEED`
(default 42) from the shell or `.env`. For example, use
`PORT=3001 docker compose up --build` if port 3000 is occupied. Inside the container,
Compose sets `HOST=0.0.0.0` and `PORT=3000`; the published host port binds only to
localhost. This Dockerfile is a development environment, not a production image.

## Local setup (alternative)

```sh
nvm install
nvm use
npm install --global pnpm@11.21.0
pnpm install --frozen-lockfile
cp .env.example .env
pnpm run dev
```

Without nvm, install Node.js 22.20.0 (or a newer Node 22 release) and npm first, then install the pinned pnpm version as above.
SQLite is embedded; no database service or API key is needed. If a prebuilt SQLite
addon is unavailable, installation requires Python 3 and a C/C++ build toolchain.

The server listens at `http://127.0.0.1:3000` and reloads on source changes.
`GET /healthz` checks readiness. Job endpoints are pending.

The project pins pnpm 11.21.0 in `package.json`. `pnpm-lock.yaml` locks dependencies;
Docker installs with `--frozen-lockfile`. `pnpm-workspace.yaml` allows install scripts
for `better-sqlite3` and `esbuild`, which need native binaries. Use pnpm for all
dependency changes (for example, `pnpm add <package>`). npm is only used to bootstrap pnpm.

## Commands

```sh
pnpm run typecheck
pnpm test
pnpm run build
pnpm start
pnpm run format:check
pnpm run check
```

`pnpm start` requires a build. `pnpm run check` runs typechecking, tests, build, and
formatting checks. Use `pnpm run test:watch` for watch mode and `pnpm run format` to format.

## Environment

Dev and start load `.env` if present; existing shell variables take precedence.

| Variable        | Default              | Purpose                                             |
| --------------- | -------------------- | --------------------------------------------------- |
| `HOST`          | `127.0.0.1`          | Bind address                                        |
| `PORT`          | `3000`               | Integer port from 1 to 65535                        |
| `DATABASE_PATH` | `./data/jobs.sqlite` | SQLite file path, relative to the working directory |
| `SEED`          | Not consumed yet     | Reserved for provider randomness                    |

## GET /healthz

```sh
curl -i http://127.0.0.1:3000/healthz
```

When ready, HTTP 200 returns:

```json
{ "status": "ok", "checks": { "sqlite": "ok" } }
```

This endpoint combines HTTP liveness with SQLite readiness. It uses the running
server's database connection, starts an immediate transaction, reads from `jobs`,
and executes an update matching zero rows. It verifies the table is accessible
and a write transaction is allowed without modifying job data. A closed connection,
missing table, read-only storage, or lock that exceeds the SQLite busy timeout
returns HTTP 503 through the shared error middleware:

```json
{ "error": { "code": "HEALTH_0001", "message": "SQLite storage is not ready" } }
```

Responses include `Cache-Control: no-store`. A 503 indicates HTTP is responding but
storage is not ready; this is not a separate liveness-only probe. The probe can
briefly contend with writers and uses the connection's busy timeout (currently
better-sqlite3's default 5 seconds). It does not guarantee future writes will succeed,
detect all disk-capacity problems, or check provider/worker health.

## Error handling

Expected failures use `AppError` in `src/error/AppError.ts`, with a stable `code`, a
client-safe `message`, and an explicit `statusCode`. HTTP responses use:

```json
{ "error": { "code": "COMMON_0003", "message": "Resource not found" } }
```

| Error              | HTTP mapping        | Meaning                                           |
| ------------------ | ------------------- | ------------------------------------------------- |
| `COMMON_0002`      | 400                 | Invalid request input                             |
| `COMMON_0003`      | 404                 | Unknown resource or route                         |
| `COMMON_0006`      | 500                 | Storage operation failed                          |
| `COMMON_0004`      | 500                 | Invalid service configuration                     |
| `COMMON_0005`      | 500                 | HTTP server could not bind/listen                 |
| Unexpected failure | 500 / `COMMON_0001` | Generic client message; details logged internally |

Define shared errors in `src/error/definition/common.ts` using `COMMON_ERROR`.
Future domain-specific definitions belong in separate files under `definition/`.
Construct failures with `new AppError(COMMON_ERROR.DATABASE_ERROR, { cause })`;
`ErrorDefinition` requires `code`, `message`, and `statusCode`. Messages live in
these definitions; diagnostic details belong in `cause` and are never returned.

Routes and controllers will follow route → validation → controller → service →
repository. Services throw typed errors; controllers forward failures with
`next(error)`. Central error middleware is registered after routes and the 404
fallback. HTTP 5xx errors are logged internally; causes and stacks are never
included in JSON responses. AppError messages must therefore be safe for clients.

Database adapters catch native errors only to wrap them in `AppError(COMMON_ERROR.DATABASE_ERROR)`, keeping
`cause` for internal diagnostics. Startup rejects on configuration, database, or
listen failures, and releases an opened database if initialization fails. These
errors reach a single process boundary (`main().catch(handleFatalError)`), which
logs and sets exit code 1; they cannot reach middleware before HTTP starts.
Unexpected programming errors remain unexpected errors rather than being assigned
an invented business classification. Provider/job error classification is pending.

## Structure and scope

- `src/app.ts`: Express application factory.
- `src/server.ts`: process entry point and shutdown signals.
- `src/startup.ts`: database initialization and HTTP startup.
- `src/error/AppError.ts`: shared application error class.
- `src/error/ErrorDefinition.ts`: error definition contract.
- `src/error/definition/common.ts`: common error codes, messages, and HTTP mappings.
- `src/error/error-handler.ts`: central HTTP error mapping.
- `src/error/error-handling.ts`: internal logging and fatal process boundary.
- `src/database/`: file connection and transactional schema initialization.
- `tests/sqlite.test.ts`: initialization, persistence across reopening, and schema constraints.

Startup fails if database initialization fails. The connection closes after the HTTP
server closes on SIGINT/SIGTERM, or if HTTP startup fails. This does not yet provide
worker shutdown or interrupted-job recovery. Schema initialization is repeatable
using `CREATE TABLE/INDEX IF NOT EXISTS`; it does not upgrade existing tables. Future
schema changes need migrations. Costs are integer micro-USD: one input token costs
3 units and one output token costs 15 units; divide by 1,000,000 for USD.

The tests do not cover worker recovery or the job API. Job routes, validation, controllers,
services, repositories, provider stub, worker, accounting, callbacks,
and reliability features are deferred because this step only sets up the coding
environment. Provider error classification and job API contracts remain pending.

Follow `AGENTS.md` and the assessment PDF for application implementation.
