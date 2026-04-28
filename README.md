# Vi

TypeScript monorepo for Vi v1.5. The backend chat loop is implemented with user-global continuity, bounded idle runtime, and companion-mode behavior authority.

## What Works Now

- `POST /chat` accepts a message and returns a Vi reply.
- Session continuity works with optional `sessionId` reuse.
- Postgres persistence is active for users, sessions, and messages.
- Last 20 messages for a session are loaded (oldest to newest) before generation.
- Web UI: multiple sessions (new chat, switch, `localStorage` restore). Storage key `vi.session.v1`.
- Vi identity prompt authority is in `packages/core`, consumed by orchestration.
- Dev-only context logging is available via `VI_DEBUG_CONTEXT=true`.

## Windows one-click dev

Double-click **`start-vi.bat`** (or run **`.\start-vi.ps1`**). This is the canonical startup path. It checks Node, Docker daemon, `.env`, pnpm (Corepack or `npx pnpm@9.15.4`), runs `pnpm install` if needed, then **`pnpm dev:up`** and automatically launches readiness checks plus **Phase 2 eval** (`pnpm eval:phase2`) sidecar.

Optional: **`.\start-vi.ps1 -SkipInstall`** to skip install when dependencies are already present.

Dev ports (fixed so the web app never steals the API port): **UI `http://localhost:3002`**, **API `http://127.0.0.1:3001`** (or `API_PORT` from `.env`).

Time Cathedral eval remains available and can be forced with **`.\start-vi.ps1 -RunTimeEval`**.

## Required Environment Variables

- `VI_PROVIDER` — `openai` | `xai` | `gemini` | `vertexai` (defaults to `openai` in examples; set explicitly in `.env`)
- `OPENAI_API_KEY` — required when `VI_PROVIDER=openai`
- `XAI_API_KEY` — required when `VI_PROVIDER=xai`
- `GEMINI_API_KEY` — required when `VI_PROVIDER=gemini`
- `VERTEXAI_PROJECT` — required when `VI_PROVIDER=vertexai` (uses ADC / `gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`)
- `DATABASE_URL` — Postgres connection string (local default: `postgresql://postgres:postgres@127.0.0.1:5432/vi`)
- `VI_OWNER_API_KEY` — owner-tier API key when `VI_REQUIRE_API_KEY=true` (omit or leave empty for fully open local dev)
- `VI_OWNER_EXTERNAL_ID` — canonical owner external id (e.g. `owner:yourhandle`); must match your deployment
- `VI_OWNER_EMAIL` — email that receives owner role when logged into web auth
- `VI_SESSION_COOKIE_NAME` / `VI_SESSION_TTL_HOURS` / `VI_SESSION_SECURE` — cookie-session controls for `/auth/*`
- `VI_GOOGLE_CLIENT_ID` / `VI_GOOGLE_CLIENT_SECRET` / `VI_GOOGLE_REDIRECT_URI` — required for Google login
- `API_PORT` — optional; defaults to `3001` locally (`8080` is typical for Cloud Run)
- `VI_DEBUG_CONTEXT` — optional; `true` enables context logs
- `VI_USER_TIMEZONE` — optional; IANA zone for local-style time context, e.g. `America/Chicago`

Cloud Run and Vercel are optional deployment targets; local dev can run on Docker Postgres + Node only. See `docs/CLOUD_RUN_DEPLOYMENT.md` for a production deploy outline.

## Database Setup

Run once (or whenever schema needs initialization):

```bash
pnpm --filter @vi/db db:setup
```

## Start API

```bash
cd apps/api
pnpm dev
```

## `/chat` Contract

Request:

```json
{
  "message": "string (required)",
  "sessionId": "string (optional)"
}
```

Success response (`200`):

```json
{
  "reply": "string",
  "sessionId": "string",
  "chronos": {
    "serverNow": "ISO-8601",
    "userMessageAt": "ISO-8601",
    "assistantMessageAt": "ISO-8601"
  }
}
```

`chronos` is optional for older clients; current API always includes it. Use it to verify wall time against Vi’s replies.

`GET /chat/messages` returns each message with optional `createdAt` (ISO) when served by the current API.

Validation error response (`400`):

```json
{
  "error": {
    "message": "message is required"
  }
}
```

Session behavior:

- Missing `sessionId` -> create new session.
- Valid owned `sessionId` -> reuse session.
- Invalid/not-owned `sessionId` -> create new session.

## Windows Note (`--env-file` and Working Directory)

When running commands that use `--env-file`, relative paths are resolved from the current working directory. Run commands from the repo root or use an absolute `.env` path (for example, `E:\Tentai Ecosystem\vi\.env`) to avoid "not found" errors.

## Package Responsibilities (Current)

- `apps/api`: HTTP transport (`/chat`), request validation, session edge flow, persistence orchestration.
- `packages/db`: Postgres/Drizzle schema, client, repositories, explicit DB setup script.
- `packages/orchestration`: Turn execution and provider flow; adapts core identity prompt into provider messages.
- `packages/core`: Vi identity authority (currently `VI_SYSTEM_PROMPT`).
- `packages/shared`: Shared request/response/history types.
- `apps/web`: Next.js UI — multi-session chat, capability queue, activity feed, and reflection views.

## Time Authority

- Canonical temporal behavior contract: `docs/architecture/06-time-cathedral-contract.md`

## Self-Model Discovery Authority

- Canonical bounded self-model discovery contract: `docs/architecture/07-self-model-discovery.md`
- v1 UI slice shows capability queue, status, activity feed, and completed reflections.

## Time Cathedral Eval Harness

Run executable contract checks against the live API:

```bash
pnpm eval:time-cathedral
```

Optional flags:

- `--apiBaseUrl http://127.0.0.1:3001` (defaults to local API)
- `--cases eval/time-cathedral-cases.json` (alternate case file)

## V1.5 Companion Evals

- `pnpm eval:companion-proactivity`
- `pnpm eval:warmth-boundary`
- `pnpm eval:memory-affection-continuity`
