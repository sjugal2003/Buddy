# CLAUDE.md

Buddy is a multi-tenant customer service intelligence hub (Next.js 15 App
Router, React 19, TypeScript strict, Tailwind v4). Full background:
`PROJECT_CONTEXT.md`. Keep both files accurate as work progresses.

## Working rules

- The owner is a beginner on Windows. Explain decisions in plain language and
  give exact PowerShell commands using `npm.cmd` / `npx.cmd` (PowerShell may
  block `npm.ps1`). Project path on their machine: `D:\Buddy`.
- One phase at a time. Present a plan and get approval before major changes.
  Work in small stages and say how to verify each one.
- Preserve working Phase 1 UI. Do not rewrite components for taste.
- No paid services or API keys unless explicitly approved for the phase.
- Never pretend a demo feature is connected to a real service. Keep demo data
  clearly labelled (`DemoNotice`).
- Never show a success message unless the save actually succeeded.

## Code layout

- Demo pages: `src/app/demo/[workspace]/*` render views from
  `src/components/views/*` with fictional data (`src/lib/data/index.ts`).
  Pages never import `src/lib/demo-data` directly.
- Real workspaces: `src/app/w/[workspace]/*`. Reads in `src/lib/data/live.ts`,
  writes as server actions in `src/app/actions/`, always through the user's
  own Supabase session (`src/lib/supabase/server.ts`), never a secret key.
- Every server action: check `getCurrentUser()`, validate with
  `src/lib/validation.ts`, map errors with `friendlyError`, and only report
  success after the database call succeeded (for update/delete, ask for the
  row back: RLS refusals change 0 rows without an error).
- No `loading.tsx` above pages with server actions: in production builds it
  made saves hang (PROJECT_CONTEXT.md §5).
- Shared types: `src/lib/types.ts`. Pure logic: `src/lib/analytics.ts`,
  `src/lib/routing.ts`.
- AI analysis: only through `getAnalyser()` in `src/lib/ai/` (server only;
  Claude or Gemini, picked by which key is set).
  Tests and CI use `BUDDY_AI_MODE=fake`; no test may call the paid API.

## Database

- Schema changes go in a NEW file in `supabase/migrations/` (never edit an
  applied migration). Every new tenant table needs `organization_id`, RLS
  enabled, an explicit grant allowlist, and policies using
  `private.is_member` / `private.has_role`.
- Add checks for any new access rule to `supabase/tests/security_test.sql`
  and run it (see PROJECT_CONTEXT.md §10). Never apply migrations to a
  production database without the owner's go-ahead.

## Security rules

- Every tenant table has Row Level Security; access comes from organisation
  membership checked in the database, never from an ID sent by the browser.
- Roles are `owner`, `admin`, `member`; nobody can grant themselves a role.
- Secret / service-role keys never appear in browser code or `NEXT_PUBLIC_*`
  variables, docs or chat. Use placeholder names.
- Validate all client input on the server (zod) before touching the database.
- Do not claim the app is secure or production-ready until policies and
  cross-tenant tests have actually been run.
- Do not print values from `.env*` files; report only whether a variable exists.

## Checks before calling anything done

```powershell
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
npm.cmd run test:db    # needs local Supabase (npx.cmd supabase start)
npm.cmd run test:e2e   # needs local Supabase
```

New features get tests: pure logic in `tests/unit/`, user flows (including a
cross-company check) in `tests/e2e/`, access rules in `security_test.sql`.
GitHub Actions runs all of them on every PR.

Report tests as passing only if they were run. Say which tests still need a
configured Supabase project.

Do not run `npm audit fix --force`: it makes breaking upgrades (for example it
downgrades `eslint-config-next`). Upgrade the flagged package on its own
instead (see PROJECT_CONTEXT.md §12). `npm audit` reported 0 on 2026-10-23.
