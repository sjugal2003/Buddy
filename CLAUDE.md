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
  Fake modes only work where `runsOnThisComputer()` is true (never on a
  live server); keep that check when touching either mode.
- Gmail: only through `src/lib/gmail/` (server only), read-only scope. The
  refresh token is encrypted with `GMAIL_TOKEN_KEY` and reachable only via
  security-definer functions; never send it to the browser or log it. Fetched
  emails go through `import_issues` like CSV rows. Google's return address
  comes from `gmailCallbackUrl()` (`BUDDY_SITE_URL` on a live server). Tests and CI use
  `BUDDY_GMAIL_MODE=fake`; no test may contact Google.

- Google Play reviews: only through `src/lib/play/` (server only), read-only
  (`androidpublisher` scope, `reviews.list` only). Each company's own service
  account key is encrypted with `GMAIL_TOKEN_KEY`, kept in
  `source_credentials` (no grants), and handed back only by
  `start_source_fetch` with `BUDDY_AI_RESULT_KEY`. Sign-in always goes to
  Google's fixed token address, never one from the key file. Real use needs
  `BUDDY_PLAY_REAL=on`, which stays unset until real data is approved. Tests
  and CI use `BUDDY_PLAY_MODE=fake` (same `runsOnThisComputer()` guard); no
  test may contact Google.
- Notifications: created only in the database (`private.notify_staff`,
  `private.notify_team` / `private.create_notification`, from triggers), in
  Buddy only, for owners and admins, plus a team's members (`team_members`)
  for issues given to that team and its escalations. Titles never contain the customer's message, name or email.
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
  The same key is needed for `mailbox_token` and `start_gmail_fetch`.
  Tests use the made-up key in `tests/e2e/helpers.ts`.
- Links that leave the site (email confirmation, invitations) use
  `siteUrl()` from `src/lib/site-url.ts`, never the Host/Origin header.
- Security headers live in `next.config.ts`; e2e tests check them.
- `/api/health` is public: it may only say whether Buddy and the database
  answer, never anything about companies, people or settings.
  `scheduled_job_status` returns job names, schedules, times and statuses
  only (never commands or error text), to owners and admins.
- Backups: `npm run backup` (`scripts/backup.mjs`) writes to `backups/`,
  which must stay in `.gitignore`. Never commit, upload or print a backup.
  Recovery steps live in `docs/RUNBOOK.md`; keep it accurate when an error
  message, key or job it names changes. Going-online steps live in
  `docs/DEPLOYMENT.md`; update its settings table with any new setting.
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
  `npm run check-env` does exactly that; keep it value-free and add any new
  setting to `scripts/check-env-plan.mjs`.

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
instead (see PROJECT_CONTEXT.md §12). `npm audit` reported 0 on 2026-10-26.
CI fails on high or critical advisories (`npm audit --audit-level=high`).
GitHub Actions are pinned to a commit with the version in a comment; keep it
that way. Review Dependabot PRs (read the changelog, run all checks) before
telling the owner they are safe to merge.
