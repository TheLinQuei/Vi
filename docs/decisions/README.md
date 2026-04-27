# Architecture Decision Records

ADR files are **ordered** and **stable by number** once merged.

## Format

- `ADR-001-<slug>.md`
- `ADR-002-<slug>.md`
- …

## Rules

1. **Never reuse or renumber** an ADR after it exists on the main branch.  
2. **Supersede** by adding a new ADR that states what it replaces and link both ways.  
3. Boundary and integration decisions are as important as stack choices.  
4. New substantive decisions use **`ADR-template.md`**.

## Index

| ADR | Title |
|-----|--------|
| [ADR-001](./ADR-001-monorepo-and-workspace-shape.md) | Monorepo and workspace shape |
| [ADR-002](./ADR-002-runtime-stack.md) | Runtime stack and orchestration default |
| [ADR-003](./ADR-003-fastify-owns-http.md) | Fastify owns HTTP |
| [ADR-004](./ADR-004-single-streaming-path.md) | Single streaming path |
| [ADR-005](./ADR-005-memory-authority.md) | Memory authority and optional index layer |
| [ADR-006](./ADR-006-core-boundary.md) | Core package boundary |
| [ADR-007](./ADR-007-initial-package-boundaries.md) | Initial package boundaries |
| [ADR-008](./ADR-008-model-pinning.md) | Model pinning (Ollama v0) |
| [ADR-009](./ADR-009-memory-index-rebuild.md) | Canonical write order and index rebuild |
| [ADR-010](./ADR-010-dependency-direction.md) | Workspace dependency direction |
