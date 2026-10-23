# Buddy: project context

Last updated: 2026-10-23 (Phase 2, stage 5 done: database migrations and security rules).
Keep this file accurate. Update it at the end of every stage.

## 1. Product vision

Buddy is planned as a multi-tenant SaaS "customer service intelligence hub".
Each company gets its own isolated workspace where it can collect customer
feedback from sources it is authorised to use, have it analysed (sentiment,
intent, urgency, category, recurring themes), route issues to the right
department, track and escalate them, and see reports.

## 2. Core users and use cases

| User | What they do in Buddy |
|---|---|
| Support agent | Works the Issues Inbox: reads issues, changes status, reassigns to a team |
| Team lead / department head | Watches their team's queue and the Department Reports |
| Customer service manager | Watches the Dashboard, urgent complaints and escalations |
| Workspace admin | Manages teams, categories, routing rules, automation and data sources |
| Workspace owner | Everything an admin can do, plus company settings and member roles |

## 3. Technology stack

| Part | Choice | Version (from package.json / lock) |
|---|---|---|
| Framework | Next.js App Router | 15.5.28 |
| UI library | React | 19.1.0 |
| Language | TypeScript (strict) | 5.x |
| Styling | Tailwind CSS v4 via `@tailwindcss/postcss` | 4.x |
| Charts | Recharts | 3.x |
| Icons | lucide-react | 1.x |
| Lint | ESLint 9 + eslint-config-next | 15.5.28 |
| Runtime | Node.js | 20 or newer (checked on 22) |
| Database and sign-in | Supabase (Postgres + Auth + Row Level Security) | **planned, Phase 2, not installed yet** |

`package.json` pins `postcss` to `^8.5.31` through `overrides` (security fix).

## 4. Current architecture (end of Phase 1)

```
Browser ──► Next.js server (renders pages)
              │
              └─► src/lib/data/index.ts   ← the only data access module
                    └─► src/lib/demo-data/*   (fictional, generated in code)

In the browser:
  WorkspaceProvider (src/components/workspace/workspace-store.tsx)
    holds the workspace's data in React state and saves edits to
    localStorage only (key "buddy-demo:<workspaceId>").
```

- `src/app/w/[workspace]/layout.tsx` loads every record for one workspace
  (teams, categories, issues, rules, automation) and passes it all to the
  `WorkspaceProvider`. Pages read from the provider with `useWorkspace()`.
- All pages are prerendered at build time (`generateStaticParams`) for the
  two demo workspaces.
- Dashboard, report and intelligence numbers are calculated in the browser by
  `src/lib/analytics.ts` from the full issue list.
- Routing rules are matched by `src/lib/routing.ts` (pure function, first
  enabled matching rule wins).

## 5. Existing features and routes

| Route | View component | What works | Demo-only |
|---|---|---|---|
| `/` | redirect | Sends you to the first workspace | |
| `/w/[workspace]` | `dashboard-view.tsx` | Stats, sentiment trend, recurring problems, urgent list, team performance | Data is fictional |
| `/w/[workspace]/inbox` | `inbox-view.tsx`, `issue-detail.tsx` | Search, filters, sort, detail panel, status change, team reassignment, "apply suggested rule" | Edits saved in this browser only |
| `/w/[workspace]/intelligence` | `intelligence-view.tsx` | Sentiment, intent, themes, category × urgency, churn signals | Labels are hand-written, not AI |
| `/w/[workspace]/routing` | `routing-view.tsx` | Create/edit/reorder/enable/delete rules, test a rule, route unassigned issues | Saved in this browser only |
| `/w/[workspace]/data-sources` | `data-sources-view.tsx` | Catalogue of planned sources and the permission each needs | Nothing is connected |
| `/w/[workspace]/reports` | `reports-view.tsx` | Per-team trends, unresolved issues, people stats, print | |
| `/w/[workspace]/automation` | `automation-view.tsx` | Schedule, escalation and email-notification settings, "would escalate" count | Nothing runs, no email is sent |
| `/w/[workspace]/settings` | `settings-view.tsx` | Company profile, targets, teams, categories, reset demo data | Read-only |

Demo workspaces (fictional): `brightline` (Brightline Broadband) and
`cedarleaf` (Cedarleaf Home). Every page shows a `DemoNotice` where something
is demo-only.

Shared pieces: `components/ui/*` (card, badges, form controls, notice,
page header, stat card), `components/charts/*`, `components/layout/*`
(app shell, sidebar with workspace switcher, nav items).

Data shapes live in `src/lib/types.ts`: `Workspace`, `Team`, `Category`,
`Issue` (with `IssueAnalysis` and `events`), `RoutingRule`, `AutomationSettings`
(with nested `EscalationRule[]` and `NotificationRule[]`), `DataSourceDefinition`.
Every tenant-owned shape already carries a `workspaceId`.

## 6. Current data flow

1. Request for `/w/brightline/inbox`.
2. Layout calls `src/lib/data` functions, which filter the in-code demo arrays
   by `workspaceId`.
3. The full workspace data is sent to the browser.
4. A status change or reassignment updates React state and localStorage.
   Nothing is sent to a server. Reload keeps the change in that browser only.

## 7. Database status

Schema written and tested locally; **not yet applied to any Supabase project**.
The app does not talk to the database yet (that starts in stage 6/7).

Files (`supabase/`):

| File | What it is |
|---|---|
| `config.toml` | Supabase CLI settings (local only; site URL `http://localhost:3000`, email confirmation on) |
| `migrations/20261023120000_core_schema.sql` | The 10 tables, checks, indexes, triggers (updated_at, resolved_at, issue history, profile on sign-up) |
| `migrations/20261023120100_security.sql` | Table privileges allowlist, Row Level Security policies, membership functions |
| `tests/security_test.sql` | 96 checks of tenant isolation, roles and invitations; runs in one transaction and rolls back |
| `tests/local-supabase-stub.sql` | Minimal stand-in for Supabase's `auth` schema and roles, for plain PostgreSQL only. Never run on Supabase |

Tables: `profiles`, `organizations`, `organization_members`,
`organization_invitations`, `teams`, `categories`, `issues`, `issue_activity`,
`routing_rules`, `automation_settings`. Deferred: `data_sources` (Phase 5),
`notification_records` (Phase 6). Full design and reasons: Phase 2 plan doc
(https://claude.ai/artifact/7nwyfG2deY29tg9rpVLsBs).

How access works:

- Signed-out visitors (`anon`) have no table rights at all.
- Signed-in users get an explicit allowlist of table/column rights; Row Level
  Security then limits rows to organisations they are a member of
  (`private.is_member`, `private.has_role`).
- Members: read everything in their organisation, create issues, update only
  `status`, `team_id`, `assignee_name`, `first_response_at`.
- Owners/admins: also manage teams, categories, routing rules, automation
  settings, company profile, invitations, and delete issues.
- Memberships change only through `create_organization`, `accept_invitation`
  (invited, confirmed email only), `set_member_role` (owners, never self) and
  `remove_member` (last owner cannot leave).
- `issue_activity` is written only by a trigger. Team and category links use
  composite foreign keys so they cannot point at another organisation.
- Organisation `slug` cannot be changed after creation.

## 8. Authentication status

None. There is no sign-in. The workspace switcher shows every workspace and
**is not security**. Anyone who can open the app can see both demo workspaces,
which is acceptable only because the data is fictional.

## 9. Environment variables

Phase 1 needs none. No `.env*` file exists in the project (checked 2026-10-23).
`.gitignore` ignores `.env*`.

Planned for Phase 2 (names only, never commit values):

| Name | Exposed to browser? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (safe) | Address of the Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes (safe, RLS protects data) | Public key used for sign-in and user-scoped queries |
| `SUPABASE_SECRET_KEY` | **Never** | Not needed by the app in Phase 2. Only if a local test script needs to create test users. Server/terminal only |

## 10. Development commands (Windows PowerShell)

Use `npm.cmd` because PowerShell may block `npm.ps1`.

```powershell
cd D:\Downloads\buddy-phase1\buddy
npm.cmd install          # install dependencies
npm.cmd run dev          # start at http://localhost:3000 (Ctrl + C to stop)
npm.cmd run lint         # lint
npx.cmd tsc --noEmit     # type check
npm.cmd run build        # production build
npm.cmd audit            # dependency audit (see section 12)
```

Database (needs a Supabase project, see the Phase 2 plan doc):

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref <project-ref>
npx.cmd supabase db push
```

Security tests on a plain PostgreSQL server (done in the cloud; needs `psql`):

```bash
psql -d <empty test db> -f supabase/tests/local-supabase-stub.sql
psql -d <same db> -f supabase/migrations/20261023120000_core_schema.sql
psql -d <same db> -f supabase/migrations/20261023120100_security.sql
psql -d <same db> -v ON_ERROR_STOP=1 -f supabase/tests/security_test.sql
```

## 11. Important technical decisions

- **One data module.** Pages never import demo data directly; they go through
  `src/lib/data`. Phase 2 swaps what that module talks to.
- **Workspace in the URL** (`/w/<slug>`), so a user who belongs to several
  companies can switch. The URL is never trusted for access: the server must
  check membership.
- **Honest demo labelling.** Anything not real says so on screen.
- **No paid services in Phases 1 and 2** (no AI API, email provider, hosting).
- Phase 2 direction (pending approval): Supabase Auth with cookie sessions via
  `@supabase/ssr`, Row Level Security on every tenant table, Next.js server
  actions with `zod` validation for writes, version-controlled SQL migrations
  in `supabase/migrations/`.

## 12. Known bugs, limitations and technical debt

- **npm audit:** with the current lock file there are 5 high findings, all in
  one chain: `braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next`
  → `eslint-config-next`. This is development-only lint tooling;
  `npm audit --omit=dev` reports 0. No patched `braces` exists. `npm audit fix
  --force` would downgrade `eslint-config-next` to 14.x, which does not match
  Next 15, so **do not run it**. If a machine reports 7 (1 moderate, 6 high), it
  has an older lock file without the postcss fix: re-extract the latest copy and
  run `npm.cmd install`.
- The whole workspace (all issues) is loaded into the browser on every page.
  Fine for demo sizes; real data will need server-side filtering/pagination.
- Analytics are computed in the browser from the full issue list.
- Issue history (`events`) is free text inside each issue; it should become a
  proper activity table.
- Demo IDs are strings like `ws_brightline`; the database will use UUIDs.
- "Now" is a fixed date (`DEMO_NOW = 2026-10-20`) so demo data is repeatable.
- Team `lead` and `email` are display text, not linked to user accounts.
- Database security tests exist (`supabase/tests/security_test.sql`) but no
  app-level automated tests yet.
- Code lives in the private GitHub repo `sjugal2003/Buddy` (from 2026-10-23).
  Each stage arrives as a pull request.

## 13. Security requirements (apply from Phase 2 on)

- Real data only after sign-in, memberships and Row Level Security are in place
  and tested (including "user in company A cannot see company B").
- Roles: `owner`, `admin`, `member`. Users can never raise their own role.
- Never trust an organisation ID from the browser; the database checks
  membership on every read and write.
- The secret/service-role key never goes in browser code or `NEXT_PUBLIC_*`.
- Validate every client-supplied value on the server.
- No secrets in code, docs or chat. Placeholders only.
- Data sources need a supported integration and the company's authorisation;
  typing a company name grants nothing.
- Do not call the app secure or production-ready until policies and tests are
  checked.

## 14. Planned phases

1. Polished frontend with demo data. **Done (2026-10-23).**
2. Database, authentication, tenant isolation. **In planning.**
3. AI analysis of customer messages.
4. Routing, issue tracking, escalation.
5. Supported data-source integrations.
6. Notifications, schedules, reports.
7. Security, reliability and deployment readiness.

## 15. Completed and remaining work

Completed:
- Phase 1 frontend; lint, type check and build pass; all pages return 200 and
  unknown workspaces return 404 (re-verified 2026-10-23).
- Phase 2 plan approved by Jugal (2026-10-23).
- Stage 5: migrations and security rules. Applied from empty and 96/96
  security checks passed on PostgreSQL 16 with the auth stand-in (2026-10-23).

Remaining for Phase 2: stage 6 (sign-in, organisations, invitations, demo at
`/demo/...`), stage 7 (issues), stage 8 (teams, rules, settings), stage 9
(tests, including re-running the security tests on the real Supabase project),
stage 10 (docs). Waiting on Jugal's Supabase dev project.
