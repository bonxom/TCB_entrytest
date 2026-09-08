# Async Summarization Service

Development environment using Node.js 22, strict TypeScript, Express, and SQLite
(`better-sqlite3`). Only the environment scaffold is implemented.

## Docker setup (recommended)

Install Docker Engine/Desktop with Docker Compose. No local Node.js, pnpm, or SQLite
installation is required. From the repository root, run:

```sh
docker compose up --build
```

Open `http://127.0.0.1:3000`. The current scaffold returns 404 for all paths;
job endpoints and `/healthz` are not implemented yet. Source and tests are mounted
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
The named `sqlite-data` volume is mounted at `/app/data`; Compose reserves
`DATABASE_PATH=/app/data/jobs.sqlite` for the upcoming persistence implementation.
The scaffold does not create an application database yet. `docker compose down`
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
Every path currently returns Express's default 404. Assessment endpoints are pending.

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

| Variable        | Default          | Purpose                                     |
| --------------- | ---------------- | ------------------------------------------- |
| `HOST`          | `127.0.0.1`      | Bind address                                |
| `PORT`          | `3000`           | Integer port from 1 to 65535                |
| `DATABASE_PATH` | Not consumed yet | Reserved; example uses `./data/jobs.sqlite` |
| `SEED`          | Not consumed yet | Reserved for provider randomness            |

## Structure and scope

- `src/app.ts`: Express application factory.
- `src/server.ts`: server entry point.
- `tests/sqlite.test.ts`: SQLite dependency and file persistence smoke test.

The test verifies SQLite across reopening, not job persistence or process-crash
recovery. Application schema initialization, job routes, validation, controllers,
services, repositories, typed errors, provider stub, worker, accounting, callbacks,
and reliability features are deferred because this step only sets up the coding
environment. Provider error classification and job API contracts remain pending.

Follow `AGENTS.md` and the assessment PDF for application implementation.
