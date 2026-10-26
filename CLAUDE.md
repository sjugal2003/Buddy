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
  Claude or Gemini, picked by which key is set). AI never overwrites a
  value a person chose, and never moves an issue unless the owner switched
  on automatic routing.
  Tests and CI use `BUDDY_AI_MODE=fake`; no test may call the paid API.
- Gmail: only through `src/lib/gmail/` (server only), read-only scope. The
  refresh token is encrypted with `GMAIL_TOKEN_KEY` and reachable only via
  security-definer functions; never send it to the browser or log it. Fetched
  emails go through `import_issues` like CSV rows. Tests and CI use
  `BUDDY_GMAIL_MODE=fake`; no test may contact Google.

- Notifications: created only in the database (`private.notify_staff` /
  `private.create_notification`, from triggers), in Buddy only, for owners
  and admins. Titles never contain the customer's message, name or email.
- Limits on repeated actions (invitations, imports and fetches, issues added
  by hand, "Check now") are triggers using `private.enforce_rate_limit`. Add
  a trigger there for any new action a person can repeat many times.
- Deleting issues: owners only, through `delete_issue` / `delete_customer_data`
  (or the retention clean-up), which write `deletion_log`. Never add a direct
  delete on `issues`, and never put customer details in the log.
- Creating a company is invite-only (`private.company_creators`, checked in
  `create_organization`), and all companies together share an AI limit
  (`private.platform_settings.ai_monthly_cap`, checked in
  `start_issue_analysis`). Keep both checks in the database; never add a way
  for the app to change them.
- Starting or finishing an AI analysis needs `aiResultKey()`
  (`BUDDY_AI_RESULT_KEY`, server only); the database checks its hash. Never
  log it, send it to the browser, or put it in a `NEXT_PUBLIC_` variable.
  Tests use the made-up key in `tests/e2e/helpers.ts`.
- Links that leave the site (email confirmation, invitations) use
  `siteUrl()` from `src/lib/site-url.ts`, never the Host/Origin header.
- Security headers live in `next.config.ts`; e2e tests check them.
- Reports: counted only by `public.issue_report` (members only, company time
  zone). No per-person figures.

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
instead (see PROJECT_CONTEXT.md §12). `npm audit` reported 0 on 2026-10-24.
