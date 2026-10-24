# Buddy: project context

Last updated: 2026-10-24 (Phase 3: stages 11 to 13, plus Gemini option).
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
| Runtime | Node.js | 22 recommended; 20.19 or newer (Vitest's tooling needs it). CI uses 20 |
| Database and sign-in | Supabase (Postgres 17 + Auth + Row Level Security), hosted free dev project | `@supabase/supabase-js` 2.118, `@supabase/ssr` 0.12, CLI `supabase` 2.122 (dev dependency) |
| Input validation | zod | 4.x |
| Unit tests | Vitest | 4.1.x |
| Browser tests | Playwright (`@playwright/test`) | 1.56 |
| Database test runner | `pg` (Node PostgreSQL client) | 8.x |
| AI analysis (Phase 3) | Claude Haiku 5.5 (`claude-haiku-5-5`) through `@anthropic-ai/sdk`, or Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`) through `@google/genai`; server only, picked by which key is set | SDKs 1.2 and 2.31 |

`package.json` pins `postcss` to `^8.5.31` through `overrides` (security fix).

## 4. Current architecture

```
Real workspaces (/w/<slug>):
  Browser ──► Next.js server ──► Supabase (as the signed-in user)
                │                   └─ Row Level Security decides which rows
                ├─ reads:  src/lib/data/live.ts
                └─ writes: server actions in src/app/actions/ (zod first)

Demo (/demo/<slug>):
  Browser ──► Next.js server ──► src/lib/data/index.ts ──► src/lib/demo-data/*
  In the browser, WorkspaceProvider keeps edits in React state and
  localStorage only (key "buddy-demo:<workspaceId>").
```

There are two halves:

- **Demo** (`src/app/demo/[workspace]/...`): the Phase 1 app, unchanged
  apart from its URL. Fictional data, no sign-in, never touches the database.
- **Real workspaces** (`src/app/w/[workspace]/...`): require sign-in. The
  server reads the Supabase session cookie (`src/lib/supabase/server.ts`),
  `src/middleware.ts` refreshes it on each request, and every query runs as
  the user so Row Level Security limits it to their organisations. Writes go
  through server actions in `src/app/actions/` with zod validation
  (`src/lib/validation.ts`) and plain-language errors (`src/lib/errors.ts`).
  Reads live in `src/lib/data/live.ts`.

Demo details:

- `src/app/demo/[workspace]/layout.tsx` loads every record for one workspace
  (teams, categories, issues, rules, automation) and passes it all to the
  `WorkspaceProvider`. Pages read from the provider with `useWorkspace()`.
- All pages are prerendered at build time (`generateStaticParams`) for the
  two demo workspaces.
- Dashboard, report and intelligence numbers are calculated in the browser by
  `src/lib/analytics.ts` from the full issue list.
- Routing rules are matched by `src/lib/routing.ts` (pure function, first
  enabled matching rule wins). The real workspaces use the same function on
  the server.

## 5. Existing features and routes

| Route | View component | What works | Demo-only |
|---|---|---|---|
| `/` | `app/page.tsx` | Home: sign in, sign up, or open the demo. Signed-in users go to their first workspace or `/onboarding`. Shows a notice when Supabase is not configured | |
| `/signup`, `/login`, `/check-email` | `components/auth/*` | Account pages with validation and plain errors | |
| `/auth/confirm` | route handler | Verifies the email link (`token_hash`, or `code` fallback), redirects only within the app | |
| `/onboarding` | `components/org/create-org-form.tsx` | Create a company (`create_organization`), caller becomes owner | |
| `/invite?token=` | `components/org/members.tsx` | Accept an invitation (`accept_invitation`) | |
| `/w/[workspace]` | `app/w/[workspace]/page.tsx` | Real workspace home: open issue count, members, role changes (owners), remove/leave, invite links and open invitations (owners and admins) | |
| `/w/[workspace]/issues` | `app/w/[workspace]/issues/page.tsx` | Issues from the database, newest first (up to 200), filter by status, urgency and team, search customer/reference/subject/message. Filters are in the address bar (plain GET form) | |
| `/w/[workspace]/issues/new` | `components/issues/issue-forms.tsx` | Add an issue: customer, channel, subject, message, urgency, sentiment, type, team, category (`createIssue`). When AI is on and set up, urgency, sentiment and type default to "Let AI decide" (saved with the usual defaults, then filled by the AI); an empty category is also filled | |
| `/w/[workspace]/issues/[issueId]` | `app/w/[workspace]/issues/[issueId]/page.tsx` | Issue detail, change status, assignee, team and category (any member of the workspace, `updateIssue`), history from `issue_activity`. "AI analysis" panel (`components/issues/ai-panel.tsx`, `app/actions/ai.ts`): right after creation it runs `analyseIssue` in a separate request (`?analyse=<fields>`), shows the summary, next step, themes and each suggestion with an Accept button when it differs (`acceptAiValue`), "Analyse again", and failures with the reason | Real Claude answers not yet checked against the live API (no key in the cloud copy) |
| `/w/[workspace]/routing` | `components/routing/routing-forms.tsx` | Routing rules from the database: add, edit (conditions on category, urgency, sentiment, type, channel, message text; match all or any), reorder, switch off, delete. Owners and admins edit (`app/actions/routing.ts`); members see them read-only. "Route open issues that have no team" gives each open issue without a team the team its first matching rule suggests (`routeUnassignedIssues`, up to 500 at a time). The issue page shows the matching rule and an "Apply suggestion" button (`applySuggestedTeam`, any member). Both recompute the match on the server and never overwrite a team someone already chose | Suggest only: no automatic routing when an issue arrives (Phase 3) |
| `/w/[workspace]/settings` | `components/settings/settings-forms.tsx` | Company name, industry, time zone, first-response targets; add/rename/delete teams (name, lead, email, colour) and categories; "AI analysis" card (on/off, monthly limit, analyses used this month and approximate cost, whether this server has an AI key). Owners and admins edit (`app/actions/settings.ts`); members see it read-only | Team email is display only. AI switch does nothing yet (stage 13 runs analyses) |

Every `/w/[workspace]` page has a "Something went wrong, try again" screen
(`error.tsx`). Forms show "Saving…" while they work; while a page loads, the
previous page stays on screen.

**No `loading.tsx` under `/w`.** Stage 7 added one, and in production builds
(`npm run build` + `next start`, not `npm run dev`) it made a server action
occasionally never finish: the save happened in the database but the button
stayed on "Saving…". Found on 2026-10-23 with repeated quick saves (about 1
in 6 hung); without it, 0 of 60+ hung. Removed in stage 8a. Don't add a
`loading.tsx` above pages that use server actions: the "six quick saves"
step in `tests/e2e/issues.spec.ts` runs against a production build in CI and
would catch it.

Forms people type a lot into use `keepValuesOnSubmit` (`components/ui/form.tsx`)
so a validation error doesn't clear what they typed (React 19 otherwise
resets a form after its action). Edit forms are keyed on their saved values so
they redraw after a save; their messages sit outside the form.

Demo pages (all under `/demo/[workspace]`, fictional data):

| Route | View component | What works | Demo-only |
|---|---|---|---|
| `/demo/[workspace]` | `dashboard-view.tsx` | Stats, sentiment trend, recurring problems, urgent list, team performance | Data is fictional |
| `/demo/[workspace]/inbox` | `inbox-view.tsx`, `issue-detail.tsx` | Search, filters, sort, detail panel, status change, team reassignment, "apply suggested rule" | Edits saved in this browser only |
| `/demo/[workspace]/intelligence` | `intelligence-view.tsx` | Sentiment, intent, themes, category × urgency, churn signals | Labels are hand-written, not AI |
| `/demo/[workspace]/routing` | `routing-view.tsx` | Create/edit/reorder/enable/delete rules, test a rule, route unassigned issues | Saved in this browser only |
| `/demo/[workspace]/data-sources` | `data-sources-view.tsx` | Catalogue of planned sources and the permission each needs | Nothing is connected |
| `/demo/[workspace]/reports` | `reports-view.tsx` | Per-team trends, unresolved issues, people stats, print | |
| `/demo/[workspace]/automation` | `automation-view.tsx` | Schedule, escalation and email-notification settings, "would escalate" count | Nothing runs, no email is sent |
| `/demo/[workspace]/settings` | `settings-view.tsx` | Company profile, targets, teams, categories, reset demo data | Read-only |

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

Real workspace, for example changing an issue's status:

1. `/w/outskill/issues/<id>` loads. `app/w/[workspace]/layout.tsx` sends
   signed-out visitors to sign in, then looks up their membership of the
   organisation by slug **as the signed-in user**. If there is none (or Row
   Level Security hides it), the page is "not found".
2. The page reads the issue, history, teams, categories and routing rules
   through `src/lib/data/live.ts`.
3. Saving runs the `updateIssue` server action: it checks the session,
   validates with zod, updates the row and asks for it back (0 rows means not
   allowed). A database trigger writes the history row.
4. The action revalidates the workspace pages and returns "Changes saved."
   only after the database confirmed the change.

Demo, for example `/demo/brightline/inbox`: the layout loads the fictional
workspace from `src/lib/data`, sends it all to the browser, and edits stay in
React state and localStorage. Nothing is sent to a server.

## 7. Database status

Applied to Jugal's hosted development project (`supabase db push`, 2026-10-23)
up to the stage 8a migration (stage 8b adds none). No production database
exists.

Files (`supabase/`):

| File | What it is |
|---|---|
| `config.toml` | Supabase CLI settings (local only; site URL `http://localhost:3000`, email confirmation on) |
| `migrations/20261023120000_core_schema.sql` | The 10 tables, checks, indexes, triggers (updated_at, resolved_at, issue history, profile on sign-up) |
| `migrations/20261023120100_security.sql` | Table privileges allowlist, Row Level Security policies, membership functions |
| `migrations/20261023160000_issue_category_update.sql` | Stage 8a: members may change an issue's category |
| `migrations/20261024120000_ai_accept.sql` | Stage 13: `accept_issue_analysis(analysis, fields)` copies a finished analysis's values onto its issue and writes `ai_accepted` history |
| `migrations/20261024090000_ai_analysis.sql` | Stage 12: `organizations.ai_enabled` (default off) and `ai_monthly_limit` (default 500, 0 to 2,000); `issue_analyses` table; `start_issue_analysis` / `finish_issue_analysis`; history kinds `ai_analysed`, `ai_accepted` |
| `tests/security_test.sql` | 152 checks of tenant isolation, roles, invitations, teams, categories, settings, routing rules and AI analysis; runs in one transaction and rolls back |
| `tests/local-supabase-stub.sql` | Minimal stand-in for Supabase's `auth` schema and roles, for plain PostgreSQL only. Never run on Supabase |

Tables: `profiles`, `organizations`, `organization_members`,
`organization_invitations`, `teams`, `categories`, `issues`, `issue_activity`,
`routing_rules`, `automation_settings`, `issue_analyses` (Phase 3). Deferred: `data_sources` (Phase 5),
`notification_records` (Phase 6). Full design and reasons: Phase 2 plan doc
(https://claude.ai/artifact/7nwyfG2deY29tg9rpVLsBs).

How access works:

- Signed-out visitors (`anon`) have no table rights at all.
- Signed-in users get an explicit allowlist of table/column rights; Row Level
  Security then limits rows to organisations they are a member of
  (`private.is_member`, `private.has_role`).
- Members: read everything in their organisation, create issues, update only
  `status`, `team_id`, `category_id`, `assignee_name`, `first_response_at`.
- Owners/admins: also manage teams, categories, routing rules, automation
  settings, company profile, invitations, and delete issues.
- Memberships change only through `create_organization`, `accept_invitation`
  (invited, confirmed email only), `set_member_role` (owners, never self) and
  `remove_member` (last owner cannot leave).
- `issue_activity` is written only by a trigger. Team and category links use
  composite foreign keys so they cannot point at another organisation.
- Organisation `slug` cannot be changed after creation.
- AI analysis (Phase 3): owners and admins switch it on and set the monthly
  limit. `issue_analyses` is read-only for users; rows are added only by
  `start_issue_analysis` (member of the issue's company, AI on, under the
  monthly limit counted since the 1st in UTC including failed attempts, not
  the same issue within 30 seconds; locks the company row so two requests
  cannot both take the last one) and finished once by
  `finish_issue_analysis` (only by the person who started it, within 5
  minutes). Finished rows never change; deleting an issue keeps its
  analyses (issue_id cleared) so the count cannot be reset.
- Members still cannot set sentiment, type, urgency or summary directly;
  `accept_issue_analysis` is the only way, and only with the values of a
  finished analysis of the same issue.

## 8. Authentication status

Implemented in stage 6 with Supabase Auth (email and password) and
`@supabase/ssr` cookie sessions. Tested end to end against a full local
Supabase (auth, REST API, email catcher) on 2026-10-23: 20 checks passed,
including email confirmation, company creation, invitations accepted only
by the invited email, a user of another company getting 404, role changes,
"last owner cannot leave", sign-out, and the demo working while signed out.
Those checks now live in `tests/e2e/auth.spec.ts` and run on every PR.

- Signed-out visitors to `/w/...`, `/onboarding` or `/invite` are sent to
  `/login?next=...`; `next` only accepts paths inside the app.
- Sign-up needs a confirmed email (Supabase setting "Confirm email" on).
- Two kinds of confirmation link both work. Supabase's **default** template
  (hosted projects without custom SMTP can't edit it) goes through Supabase
  and returns to `/auth/confirm?code=...`; that code only works in the same
  browser that signed up. The custom template in `supabase/templates/`
  (used by the local CLI) sends `token_hash` and works in any browser. Both
  were checked with the e2e script on local Supabase on 2026-10-23.
- Buddy sends no email of its own. Invitations produce a one-time link the
  inviter copies; only its SHA-256 hash is stored.
- Tested by Jugal on the hosted Supabase project on 2026-10-23: sign-up,
  confirmation (default email template) and creating a workspace work.
- `NEXT_PUBLIC_SUPABASE_URL` is reduced to its origin, so a URL copied with
  `/rest/v1/` still works (it used to fail with "Invalid path specified").

## 9. Environment variables

Set in `.env.local` (ignored by Git; template in `.env.example`). Names only,
never commit values. Without them the app runs in demo-only mode.

| Name | Exposed to browser? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (safe) | Address of the Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes (safe, RLS protects data) | Sign-in and user-scoped queries |
| Secret key (`sb_secret_...`) | **Never** | Not used by the app. Must never be added |
| `ANTHROPIC_API_KEY` | **Never** (server only, no `NEXT_PUBLIC_`) | Turns on Claude analysis (Phase 3). Read only in `src/lib/ai/index.ts`. Wins if both AI keys are set |
| `GEMINI_API_KEY` | **Never** (server only, no `NEXT_PUBLIC_`) | Turns on Gemini analysis when there is no Anthropic key. Read only in `src/lib/ai/index.ts`. Neither key means AI is shown as not set up |
| `BUDDY_AI_MODE` | No | `fake` swaps in the free keyword test analyser (automated tests and CI). Leave unset otherwise |

## 10. Development commands (Windows PowerShell)

Use `npm.cmd` because PowerShell may block `npm.ps1`.

```powershell
cd D:\Buddy
npm.cmd ci               # install dependencies exactly as locked (use after git pull)
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

### Automated tests

| Command | What it checks | Needs |
|---|---|---|
| `npm.cmd test` | Unit tests (`tests/unit/`): routing rule matching, analytics, input rules | Nothing |
| `npm.cmd run test:db` | `supabase/tests/security_test.sql` (152 checks); rolls itself back | Local Supabase |
| `npm.cmd run test:e2e` | Browser tests (`tests/e2e/`, Playwright): sign-up, invitations, roles, issues, settings, routing, cross-company access | Local Supabase, test browser |

Local Supabase needs Docker Desktop. One-time setup, then each time:

```powershell
npx.cmd playwright install chromium   # once: downloads the test browser
npx.cmd supabase start                # starts a throwaway database on your PC
npx.cmd supabase db reset             # optional: empty it and re-apply the migrations
npm.cmd run test:db
npm.cmd run test:e2e
npx.cmd supabase stop
```

Safety: `test:db` refuses any database not on this computer, and
`playwright.config.ts` points the test server (port 3100) at the local
Supabase from `npx supabase status`, never the values in `.env.local`. Stop
`npm.cmd run dev` before `test:e2e` (both use the `.next` folder).
Port 3100 is in `additional_redirect_urls` in `supabase/config.toml` so
confirmation links work.

GitHub Actions (`.github/workflows/checks.yml`) runs lint, type check, unit
tests, a local Supabase, the database tests, a production build and the
browser tests on every pull request and on `main`, with no secrets. A failed
run keeps the Playwright report for 7 days (Actions > the run > Artifacts).

## 11. Important technical decisions

- **One data module.** Pages never import demo data directly; they go through
  `src/lib/data`. Phase 2 swaps what that module talks to.
- **Workspace in the URL** (`/w/<slug>`), so a user who belongs to several
  companies can switch. The URL is never trusted for access: the server must
  check membership.
- **Honest demo labelling.** Anything not real says so on screen.
- **No paid services in Phases 1 and 2** (no AI API, email provider, hosting).
- **Phase 2 choices (approved 2026-10-23):** Supabase Auth with cookie
  sessions via `@supabase/ssr`; Row Level Security on every tenant table, with
  an explicit column grant allowlist; Next.js server actions with zod
  validation for writes; SQL migrations in `supabase/migrations/`; the app
  never uses the secret key.
- **Routing suggests, people decide.** Rules never move an issue on their own
  until Phase 3; "Apply suggestion" and "Route open issues that have no team"
  are buttons.
- **Saves report success only after the database confirms**, and updates ask
  for the row back, because a refused update changes 0 rows without an error.
- **Tests run against a local Supabase**, never the hosted project:
  `test:db` refuses other hosts and the browser tests take their settings from
  `npx supabase status`.

## 12. Known bugs, limitations and technical debt

- **npm audit:** 0 findings on 2026-10-23 (stage 10 moved Vitest from 3.2 to
  4.1.12; 3.2 had 1 moderate and 2 critical advisories in its test-runner
  dependencies). Still **never run `npm audit fix --force`**: it makes
  breaking upgrades, such as downgrading `eslint-config-next` to a version
  that doesn't match Next 15. If findings appear, check whether
  `npm audit --omit=dev` (what the app ships) is still 0 and upgrade the
  package named, one at a time.
- Demo pages load the whole workspace into the browser. Real workspaces
  filter on the server but show at most 200 issues; paging comes later.
- The assignee is a name picked from the workspace's members (stored as
  text, `assignee_name`), not a link to a user account.
- Category changes are not written to an issue's history (the history
  trigger records status, team and assignee only).
- Deleting a team or category clears it from issues; deleting a team that a
  routing rule uses is refused until the rule changes.
- `first_response_at` is not set yet (needed for response-time reports).
- Analytics are computed in the browser from the full issue list.
- Demo issue history (`events`) is free text; real issues use the
  `issue_activity` table, written by a database trigger.
- Demo IDs are strings like `ws_brightline`; the database uses UUIDs.
- Member names come from `profiles.full_name`; email addresses of other
  members are not shown (profiles has no email column).
- Old `/w/brightline` demo links now need sign-in; the demo is at `/demo/...`.
- "Now" is a fixed date (`DEMO_NOW = 2026-10-20`) so demo data is repeatable.
- Team `lead` and `email` are display text, not linked to user accounts.
- Browser tests cover the main flows, not every error message; the demo
  pages have no automated tests beyond "all 8 load".
- Running the database and browser tests on Windows needs Docker Desktop.
- AI results are recorded with the user's own session (no secret key), so a
  member could call `finish_issue_analysis` themselves and record a made-up
  "AI" answer for an issue in their own company. It can't touch another
  company, raise the limit, or change anything a member couldn't already
  edit by hand. Closing this needs a server-only key (Phase 7).
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
2. Database, authentication, tenant isolation. **Done (2026-10-23).** Also
   brought forward from phase 4: issue tracking and suggest-only routing.
3. AI analysis of customer messages.
4. Routing, issue tracking, escalation.
5. Supported data-source integrations.
6. Notifications, schedules, reports.
7. Security, reliability and deployment readiness.

## 15. Completed and remaining work

Completed:
- Phase 1 frontend (re-verified 2026-10-23).
- Phase 2 plan approved by Jugal (2026-10-23).
- Stage 5: migrations and security rules; 96/96 security checks pass on
  PostgreSQL 16 with the auth stand-in, on the Supabase Postgres 17 image,
  and on a full local Supabase stack (2026-10-23). PR #1.
- Stage 6: sign-up, email confirmation, sign-in, sign-out, session refresh,
  create company, invitations, members, roles; demo moved to `/demo/...`.
  Lint, type check and build pass; 20/20 end-to-end checks against local
  Supabase; demo-only mode checked with no settings (2026-10-23). PR #2.
- Setup on Jugal's PC with the hosted project (2026-10-23). PR #3 fixed the
  Supabase URL handling and the setup notes.
- Stage 7: issues in the database (list, filters, search, add, status,
  assignee, history; loading, empty and error states). No schema change.
  Lint, type check and build pass; 20/20 issue checks
  (`/mnt/project-files/buddy-phase2/e2e-issues-local.js`), 20/20 auth checks
  and 96/96 security checks against local Supabase (2026-10-23). PR #4.
  Verified by Jugal on the hosted project.
- Stage 8a: Settings tab (company profile, response targets, teams,
  categories), team and category on issues, team filter; one migration
  (category update grant); removed `loading.tsx` (see section 5). 26/26
  settings checks (`e2e-settings-local.js`), 21/21 issue checks, 20/20 auth
  checks, 107/107 security checks against local Supabase (2026-10-23). PR #5.
  Verified by Jugal on the hosted project.
- Stage 8b: Routing tab with rules in the database (suggest only), "Apply
  suggestion" on the issue page, "Route open issues that have no team". No
  schema change. 24/24 routing checks (`e2e-routing-local.js`), 26/26
  settings, 21/21 issue, 20/20 auth and 118/118 security checks against local
  Supabase on a production build (2026-10-23). PR #6. Verified by Jugal on
  the hosted project.
- Stage 9: tests in the repo (Vitest unit tests, Playwright browser tests,
  `test:db` runner) and GitHub Actions running all of them on every PR; first
  CI run green. PR #7. `npm.cmd test` checked by Jugal on Windows.
- Stage 10: docs brought up to date (README setup, Windows testing and
  troubleshooting; this file; CLAUDE.md); Vitest upgraded to clear the audit
  findings. PR #8.

Phase 2 is complete.

Phase 3 (AI analysis). Jugal approved Claude Haiku 5.5 with a spending cap
and the plan (https://claude.ai/artifact/9bZR35rqVSL8ZYpqfLvMw5) on
2026-10-23. Stages: 11 engine, 12 database and Settings card, 13 analyse on
save and AI panel (needs Jugal's own key in `.env.local`), 14 inbox and
routing use AI values, 15 docs.
- Stage 11: analysis engine in `src/lib/ai/` (not yet used by any page):
  `schema.ts` (answer format, `toSuggestion` checks and maps the category),
  `prompt.ts` (what is sent: subject, message cut to 4,000 characters,
  channel, category names; the message is treated as data), `limits.ts`
  (on/off, monthly count up to 2,000, 30-second retry wait, cost estimate),
  `claude.ts` (Haiku 5.5, 600-token cap, no thinking, low effort, no tools,
  structured output; plain error messages), `fake.ts` (keyword test
  analyser), `index.ts` (`getAnalyser`). Unit tests in `tests/unit/ai.test.ts`
  use a stand-in client, so no test calls the paid API. PR #9, merged
  2026-10-24.
- Stage 12: migration `20261024090000_ai_analysis.sql` (switches, the
  `issue_analyses` record, the monthly limit enforced in the database) and an
  "AI analysis" card in Settings. 144/144 security checks, 5/5 browser tests
  (new `tests/e2e/ai-settings.spec.ts`), 45 unit tests, lint, type check and
  build pass locally (2026-10-24). PR #10, merged 2026-10-24.
- Stage 13: analysis runs after an issue is saved; "Let AI decide" on the
  new-issue form; AI panel with Accept buttons and "Analyse again"; history
  entries; migration `20261024120000_ai_accept.sql`. Browser tests use the
  test analyser (`BUDDY_AI_MODE=fake` in `playwright.config.ts`, which also
  blanks `ANTHROPIC_API_KEY`). 152/152 security checks, 6/6 browser tests on
  a production build, 45 unit tests, lint, type check, build (2026-10-24).
  Not yet run against the real Claude API: Jugal checks that with their own key.
  PR #11, merged 2026-10-24.
- Gemini option (Jugal chose "support both, use Gemini now", 2026-10-24):
  `src/lib/ai/gemini.ts` (Gemini 3.5 Flash-Lite, same prompt and checks,
  JSON schema output from the zod answer schema, 1,024-token cap including
  thinking, thinking left at the model's default); `getAnalyser` uses
  Claude if `ANTHROPIC_API_KEY` is set, else Gemini if `GEMINI_API_KEY` is
  set. Settings names the service; cost is estimated per model at paid
  prices (Gemini's free tier is $0, but Google may use free-tier content to
  improve its products: made-up messages only). Unit tests with a stand-in
  client. Not yet run against the real Gemini API.
