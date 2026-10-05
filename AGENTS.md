# ChatGPT project context

This directory is a local mirror of the ChatGPT project “Conference OS”.

- Treat every file under `sources/` as read-only reference material.
- Do not edit, rename, move, or delete synced project files.
- These files may be replaced the next time a task is created from this ChatGPT project.


## Project instructions

This project has no custom instructions.

## Shared GitHub ownership

GitHub `zhrsidd/MUNOS` is the source of truth. `main` is the stable baseline.

Codex/GPT primarily owns the existing application, frontend architecture, business logic, Supabase core, schema, migrations, RLS, repository layer, bugs/refactors and existing-system performance/reliability.

Claude primarily owns new independent systems, integrations, Vercel, deployment, staging/production, monitoring, logging, operational infrastructure, external services and platform/DevOps.

Parallelize independent work; serialize shared architecture. Only one agent should normally substantially change migrations, schema, RLS, auth/access, shared domain types, repository contracts, environment configuration or Vercel production configuration at a time. Cross-review critical work with the other agent.

Inspect existing changes before editing. Never commit secrets, local session tokens, generated build output or synced `sources/` reference files. Never force-push shared history. Apply schema changes through committed migrations. Do not widen RLS for development convenience. Preserve the independent offline outbox and server idempotency contract.

Product changes listed in `docs/BACKLOG.md` are deferred until after the baseline. No production Supabase project currently exists.
