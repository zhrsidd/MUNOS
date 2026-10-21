# Isolation prototype: NOT SHIPPING

Disposable local PostgreSQL 17 checks for `docs/ISOLATION_DESIGN.md`. Not wired into the app, `npm test` or `supabase/migrations`. Nothing here is an approved design. See `docs/ISOLATION_FEASIBILITY.md` for what it shows and what it cannot show (no hosted Supabase, PostgREST, Vault, Auth or Vercel).

Run: `TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:<port>/postgres npx tsx --test prototypes/isolation/isolation.proto.test.ts` (loopback only).
