# 01 — Repo shape

Status: Active supporting spec  
Authority: `13-vi-v1-canonical-contract.md` and `14-v1-contract-implementation-checklist.md`

## Layout

```
vi/
├── apps/
│   ├── web/          # Next.js (v0: chat surface)
│   └── api/          # Fastify — sole public HTTP API
├── packages/
│   ├── shared/       # Types, constants, Zod — workspace leaf
│   ├── core/         # Domain + ports — no DB, no HTTP, no LLM SDKs
│   ├── db/           # Drizzle schema, migrations, repository implementations
│   └── orchestration/ # Turn runner, provider wiring, optional agent framework
├── docs/
└── infra/            # Add only when local/prod automation is needed
```

## Monorepo tooling

- **pnpm** workspaces for package boundaries  
- **Turbo** for task orchestration  

## Dependency DAG (acyclic)

| Package / app    | May import |
|------------------|------------|
| `shared`         | *(nothing from workspace)* |
| `db`             | `shared` |
| `core`           | `shared` only |
| `orchestration`  | `core`, `shared`, `db` |
| `apps/api`       | `orchestration`, `db`, `shared` |
| `apps/web`       | `shared` |

Current runtime note:
- User-global continuity + bounded idle runtime currently live in `apps/api/src/idle/` and are persisted through `packages/db`.

**Hard rules**

- `core` **must not** import `db`, `orchestration`, or any app package.  
- `db` **must not** import `core`.  
- `shared` **must not** import other workspace packages.  

## Repository implementations vs wiring

- **Port types** (interfaces) for persistence and provider access live in **`core`** (or neutral DTOs in `shared` if they carry no domain semantics—pick one rule and keep it consistent).  
- **Drizzle-backed repository classes** live in **`db`** and implement those ports.  
- **`orchestration`** constructs repos and adapters and runs the turn; it **does not** embed SQL or schema.  

## External memory index (if added later)

If an **external memory index layer** is adopted, adapters may live in `orchestration` (or a future package split only under pressure). Canonical rows remain in Postgres per ADR-005 / ADR-009.

## Lean scope

Nothing is added to the tree unless it serves the current phase (see root **Build law** in `README.md`). No extra apps, no speculative packages, no doc sprawl.
