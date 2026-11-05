# Buddy: project context

Last updated: 2026-10-25 (Phase 6 complete: stage 34 wrap-up).
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
| `/forgot-password`, `/reset-password` | `components/auth/auth-forms.tsx` | Phase 7 stage 37. Ask for a reset email (`requestPasswordReset`, same answer whether or not the account exists); the email link signs the person in through `/auth/confirm` and opens `/reset-password`, where they choose a new password (`updatePassword`) | |
| `/auth/confirm` | route handler | Verifies the email link (`token_hash`, or `code` fallback), redirects only within the app | |
| `/onboarding` | `components/org/create-org-form.tsx` | Create a company (`create_organization`), caller becomes owner | |
| `/invite?token=` | `components/org/members.tsx` | Accept an invitation (`accept_invitation`) | |
| `/w/[workspace]` | `app/w/[workspace]/page.tsx` | Real workspace home: dashboard cards (urgent, due within 2 hours, targets missed, escalations not acknowledged, no team, waiting on customer, this week's resolved vs opened), each linking to the Issues list with the matching filter; the 10 latest history entries; members, role changes (owners), remove/leave, invite links and open invitations (owners and admins) | |
| `/w/[workspace]/issues` | `app/w/[workspace]/issues/page.tsx` | Issues from the database, newest first, 50 per page (`ISSUE_PAGE_SIZE`, `?page=N`, Previous / Next keep the filters via `src/lib/paging.ts`), filter by status, "This week" (`?week=1`: opened or resolved since Monday 00:00 in the company's time zone, same rule as the home card), urgency (or Critical or High together), team, deadline (overdue / due soon / due within 2 hours) and unacknowledged escalation, sort by "needs attention first", search customer/reference/subject/message. Each open issue shows its next deadline (`DeadlineBadge`) and an "Escalated · level N" badge while it has an unacknowledged escalation. Deadline filters and sorting look at up to 1,000 issues (`DEADLINE_SCAN_LIMIT`). Filters are in the address bar (plain GET form). Issues with AI values show an "AI suggested" badge (`AiBadge`) and the AI summary instead of the message preview | |
| `/w/[workspace]/issues/new` | `components/issues/issue-forms.tsx` | Add an issue: customer, optional customer email (stage 22, stored in lower case), channel, subject, message, urgency, sentiment, type, team, category (`createIssue`). When AI is on and set up, urgency, sentiment and type default to "Let AI decide" (saved with the usual defaults, then filled by the AI); an empty category is also filled | |
| `/w/[workspace]/issues/[issueId]` | `app/w/[workspace]/issues/[issueId]/page.tsx` | Issue detail (with the customer's email and, for imported issues, the source and its ID), change status, assignee, team and category (any member of the workspace, `updateIssue`), history from `issue_activity` (status, resolved, reopened, team, category, assignee, first response, AI, same-problem links). "Similar issues" card (improvement D, step 1; `public.similar_issues`, `getIssueLinks` and `listSimilarIssues` in `live.ts`, `app/actions/similar.ts`, `components/issues/similar-issues.tsx`, labels in `src/lib/similar.ts`): up to 5 look-alike issues with "Same problem" (any member, `link_duplicate`), "Same problem as REF" with Unlink (`unlink_duplicate`), and "Reported N times" with the linked reports. Read apart from the issue, so the page still loads (card says "after the database update") when the migration is missing. "Deadlines" card: first-response and resolution deadline in the company time zone, worked out on the server (`src/lib/targets.ts`), "Record first response" button (`recordFirstResponse`, any member), reopen count. "Escalations" card (when there are any): level, condition, reason, and Acknowledge with an optional note (`acknowledgeEscalation`, any member). "AI analysis" panel (`components/issues/ai-panel.tsx`, `app/actions/ai.ts`): right after creation it runs `analyseIssue` in a separate request (`?analyse=<fields>`), shows the summary, next step, themes and each suggestion with an Accept button when it differs (`acceptAiValue`), "Analyse again", and failures with the reason | Checked with real Gemini answers by Jugal (2026-10-24); Claude not yet tried with a real key |
| `/w/[workspace]/routing` | `components/routing/routing-forms.tsx` | Routing rules from the database: add, edit (conditions on category, urgency, sentiment, type, channel, message text; match all or any), reorder, switch off, delete. Owners and admins edit (`app/actions/routing.ts`); members see them read-only. Every rule is checked (`routeIssue` in `src/lib/routing.ts`); when matching rules name different teams the issue shows a conflict instead of "top rule wins". "Route open issues that have no team" gives each open issue without a team the team its matching rules agree on (`routeUnassignedIssues`, up to 500 at a time) and reports how many were skipped because of a conflict. The issue page explains the suggestion ("Suggested team: Payments, because rule "Billing to Payments" matched: category is Billing"), with "Apply suggestion" (`applySuggestedTeam`, any member), "Dismiss suggestion" (`dismissRoutingSuggestion`), and one button per rule in a conflict. Applying goes through `apply_routing_rule`, which records the rule in History. Everything recomputes the match on the server and never overwrites a team someone already chose; dismissed and conflicting issues are skipped by bulk and automatic routing | Automatic routing only after AI analysis, when an owner switched it on (Phase 3 stage 14) |
| `/w/[workspace]/data-sources` | `app/w/[workspace]/data-sources/page.tsx` | Phase 5 stage 22. Lists the sources honestly (typed in: available; CSV import: available to owners and admins; Gmail: "Connected: address (read-only)" or "Not connected."). "Gmail inbox" card (stage 25, `app/api/gmail/connect` and `app/api/gmail/callback` route handlers, `app/actions/gmail.ts`, `components/data-sources/gmail-disconnect.tsx`, server-only `src/lib/gmail/`): owners see Connect Gmail, which sends them to Google asking for read-only Gmail access (`gmail.readonly`, with PKCE and a one-time state cookie); on return the server checks the state, that the person is still an owner, that read-only access and a refresh token were granted, reads the inbox address, encrypts the token with `GMAIL_TOKEN_KEY` and saves it through `save_mailbox_connection`. The card shows the address, when and by whom it was connected, and when it was last fetched. "Fetch new email" (stage 26, owners and admins; `components/data-sources/gmail-fetch.tsx`, `fetchGmail` in `app/actions/gmail.ts`, pure logic in `src/lib/gmail/message.ts`): `start_gmail_fetch` opens an import (source Gmail, one at a time per company) and hands the server the encrypted token; the server gets a short-lived access token, searches `in:inbox -from:me` since `fetched_until` (the first time, the last 7 days), looks at up to 500 new message IDs and reads the oldest 50, turns each into a row (sender name and lower-case email, subject or "(no subject)", the plain-text part or the HTML part as text or the snippet, Gmail's received time, the Gmail message ID as the record ID, channel email), and saves them with `import_issues` as open issues; `finish_gmail_fetch` closes the import and moves `fetched_until` forward. The result ("Fetched N new emails: X added as issues", already in Buddy, could not be saved, more waiting) comes from what the database reports, followed by "Analyse with AI". Expired sign-ins, missing read access, an unreadable token (key changed) and Google not answering each give a plain message and mark the import stopped. Nothing in Gmail is changed. Members see "Owners and admins can fetch new email." "Connected" is shown only when the connection row really exists. Disconnect (owners, asks first) cancels Buddy's access at Google, then removes the connection and token; if Google cannot be reached it still disconnects in Buddy and says so. Admins and members see the connection but not the buttons. Without the Google settings the card says Gmail is not set up. "Import a CSV file" (stage 23, `components/data-sources/csv-import.tsx`, `app/actions/imports.ts`, pure logic in `src/lib/csv-import.ts`): the browser reads the file (up to 5 MB and 5,000 rows; comma, semicolon or tab; quoted cells), guesses each column from the headings (dropdowns to change), reads dates as year-month-day, day/month/year or month/day/year (guessed, changeable; times without a zone are the company's time zone), uses the message's first words when there is no subject column and a chosen channel when there is none, previews the first 10 rows and every row that will be rejected with the database's own reason, then asks "Open issues" or "Past conversations, already resolved" before Import. Rows go to `import_issues` in pieces of at most 500 rows and about 700 KB (the server action limit is 1 MB); the result (imported, already in Buddy, rejected with reasons) comes only from what the database reports, and a piece that fails marks the import "Stopped with an error" with the counts so far. Members see "Only owners and admins can import files." The file itself is never uploaded or stored. "Analyse with AI" (stage 24, `components/data-sources/import-ai-button.tsx`, `planImportAnalysis` in `app/actions/imports.ts`, pure logic in `src/lib/import-ai.ts`), after an import and on each history row for owners and admins: first shows how many of the import's issues have no finished analysis and the month's AI usage ("N of L used, X left"), and offers at most what is left; nothing is sent to the AI until Confirm. It then runs the same `analyseIssue` as the issue page one issue at a time, oldest first, filling sentiment, type, urgency, category and summary (nobody chose those on an imported issue), with a pause between requests (4.5 s for Gemini's free tier, 1 s for Claude, none for the test analyser). It stops at the first failure so a failing service does not use up the month, never analyses an issue that already has a finished analysis, and says when the month is used up or AI is off. Automatic routing applies as for any analysed issue when the owner switched it on. "Google Play reviews" card (improvement B, step 1; `app/actions/play.ts`, `components/data-sources/play-connect.tsx` and `play-fetch.tsx`, server-only `src/lib/play/`, pure logic in `src/lib/play/review.ts`): owners paste the app's package name and the company's own service-account JSON key; the server keeps only the account address and private key, checks them by asking Google for one review (sign-in always at `https://oauth2.googleapis.com/token`, scope `androidpublisher`), encrypts them with `GMAIL_TOKEN_KEY` and saves them with `save_source_connection`. "Fetch new reviews" (owners and admins) reads up to 5 pages of 100 reviews (Google shares only reviews with text from about the last week, 200 reads an hour per app) and saves each as an open App review issue (reviewer's Play name or "Google Play user", "★★ review: first words", the text with any title first, the review's time, the review ID as record ID) through `import_issues`; reviews already in Buddy are skipped. Off unless `BUDDY_PLAY_MODE=fake` (tests, this computer only) or `BUDDY_PLAY_REAL=on`; real use waits for real-data approval. Disconnect (owners) deletes the key. Also and the company's import history from `import_runs`: when, source and file name, who, status, rows examined, imported, already in Buddy, rejected, and the reasons rows were rejected (row number and reason only). Any member can see it | |
| `/w/[workspace]/notifications` | `app/w/[workspace]/notifications/page.tsx` | Phase 6 stage 29. The signed-in person's own notifications for this company, newest first (up to 50): kind, time in the company time zone, a short title linking inside the workspace (the issue, Data sources or Settings; built by `notificationHref` in `src/lib/notifications.ts`, never a stored link), Unread marker, "Mark as read" (`markNotificationRead`) and "Mark all as read" (`markAllNotificationsRead`, `app/actions/notifications.ts`). Empty state "No notifications yet." Every workspace page's header has a bell (`components/notifications/notification-bell.tsx`) with the unread count ("99+" above 99; no number if the count cannot be loaded). From stage 30 the database notifies owners and admins of escalations, open issues that become High or Critical, and CSV imports or Gmail fetches that fail or reject rows; more than 10 escalations in one check become one summary linking to the escalated-issues filter. From improvement F a team's members also get "New issue for <team>" (kind `team_issue`, label "Your team") and that team's escalations. Nothing is emailed | |
| `/w/[workspace]/reports` | `app/w/[workspace]/reports/page.tsx` | Phase 6 stage 32. Company-wide figures for the last 7 days, the last 30 days (default) or a custom range of up to 366 days, as calendar days in the company's time zone (range in the address bar; an unusable custom range shows a message and the last 30 days). Counted by `public.issue_report` in the database: issues received (and still open), resolved in the period, median and average first-response and resolution times (for issues received in the period; past conversations imported as already resolved are counted as received but not timed), share that met the current first-response target (on time / late / missed), per-team workload and median times (team figures, never per person), breakdowns by urgency, sentiment, channel and category, escalations by reason, and CSV import / Gmail fetch results. Everyone in the company can see it. Pure helpers in `lib/reports.ts`. From stage 33, "Download CSV" (`reports/download/route.ts`, through the person's own session; members only, 404 otherwise; an unusable range gives a 400 instead of another range) saves the same figures for the range on screen, one per row, times in minutes, built by `lib/report-csv.ts` (typed-in names that start like a spreadsheet formula get a leading apostrophe) | Read only |
| `/w/[workspace]/settings` | `components/settings/settings-forms.tsx` | Company name, industry, time zone, first-response and resolution targets; add/rename/delete teams (name, lead, email, colour) and each team's members (improvement F: owners and admins add or remove company members; members see the list) and categories; "AI analysis" card (on/off, monthly limit, analyses used this month and approximate cost, whether this server has an AI key). Owners and admins edit (`app/actions/settings.ts`); members see it read-only. "Apply routing automatically" (owners only). "Escalations" card: switch conditions on and set thresholds, "Check now" (`app/actions/escalations.ts`), last check, "Automatic checks" (judged only from the latest scheduled check actually logged: "Not running. Use Check now." until one is seen, "Running every 15 minutes." while they arrive, a warning after 45 minutes without one; from stage 31 also, in red, when the latest scheduled check failed, with its reason, "No automatic check has succeeded in the last hour" when that is so, and the last successful scheduled check) and a note that email and chat notifications are not set up (notifications appear in Buddy only) | Team email is display only |
| `/api/health` | `app/api/health/route.ts` | Phase 7 stage 38. Calls `service_health()` with a 5-second limit; 200 `{"status":"ok","database":"ok"}` or 503 `{"status":"error","database":"unreachable"}`, `Cache-Control: no-store`. No sign-in; shows nothing private. For a free uptime checker after deployment | |

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

Applied to Jugal's hosted development project with `supabase db push`, up
to the stage 14 migration (2026-10-24, checked by using automatic routing).
The stage 16 migration is applied after its PR is merged.
No production database exists.

Files (`supabase/`):

| File | What it is |
|---|---|
| `config.toml` | Supabase CLI settings (local only; site URL `http://localhost:3000`, email confirmation on) |
| `migrations/20261023120000_core_schema.sql` | The 10 tables, checks, indexes, triggers (updated_at, resolved_at, issue history, profile on sign-up) |
| `migrations/20261023120100_security.sql` | Table privileges allowlist, Row Level Security policies, membership functions |
| `migrations/20261023160000_issue_category_update.sql` | Stage 8a: members may change an issue's category |
| `migrations/20261024090000_ai_analysis.sql` | Stage 12: `organizations.ai_enabled` (default off) and `ai_monthly_limit` (default 500, 0 to 2,000); `issue_analyses` table; `start_issue_analysis` / `finish_issue_analysis`; history kinds `ai_analysed`, `ai_accepted` |
| `migrations/20261024120000_ai_accept.sql` | Stage 13: `accept_issue_analysis(analysis, fields)` copies a finished analysis's values onto its issue and writes `ai_accepted` history |
| `migrations/20261024150000_ai_auto_route.sql` | Stage 14: `organizations.ai_auto_route` (default off) and a trigger that lets only owners change it |
| `migrations/20261025090000_resolution_tracking.sql` | Phase 4 stage 16: `organizations.resolution_hours_*` (8/24/72/120 by default, 1 to 2,160); `issues.first_response_by`, `reopened_count`, `waiting_seconds`, `waiting_since` (kept by the `issue_track_lifecycle` trigger); `record_first_response(issue)`; history kinds `category_changed`, `first_response`, `resolved`, `reopened` |
| `migrations/20261025120000_escalations.sql` | Phase 4 stage 17: `escalation_settings` (one row per company, all conditions off), `escalations` (unique per issue, condition and open spell), `escalation_runs` log; `run_escalation_check(company)` (owners and admins; the internal `private.run_escalation_check` does the work), `acknowledge_escalation(id, note)`; history kind `escalation_acknowledged` |
| `migrations/20261025150000_routing_explanations.sql` | Phase 4 stage 18: `issues.routing_dismissed_at` (cleared when category, urgency, type or channel changes); `apply_routing_rule(issue, rule, expected team)` and `dismiss_routing_suggestion(issue)`; history kinds `routing_applied`, `routing_dismissed` |
| `migrations/20261025180000_scheduled_escalation_checks.sql` | Phase 4 stage 20: enables `pg_cron`; `private.run_scheduled_escalation_checks()` (database owner only) runs the escalation check, source `scheduled`, for every company with a condition on; cron job `buddy-escalation-check` every 15 minutes |
| `migrations/20261026090000_import_foundation.sql` | Phase 5 stage 22: `import_runs` log (read-only for members); `issues.source` (`manual`/`csv`/`gmail`, existing issues become `manual`), `source_record_id`, `import_run_id`, `customer_email`; unique index on (company, source, source record) so a record becomes one issue per company; `start_import`, `import_issues` (up to 500 rows a call, checks every row again, skips duplicates, can save past conversations as resolved at their received time), `finish_import`. Owners and admins only; CSV only until Gmail arrives |
| `migrations/20261026120000_gmail_connection.sql` | Phase 5 stage 25: `mailbox_connections` (one inbox per company; address, who connected it and when, where fetching got to; members can read it) and `mailbox_tokens` (the encrypted Google refresh token; no rights and no policies, so nobody reads it directly). `save_mailbox_connection` (owners; a different address resets the fetch position), `mailbox_token` (owners and admins; returns only the encrypted value), `disconnect_mailbox` (owners) |
| `migrations/20261026150000_gmail_fetch.sql` | Phase 5 stage 26: `mailbox_connections.fetched_until` (where the next fetch starts) replaces the unused `last_history_id`; `save_mailbox_connection` resets it for a different inbox; `start_gmail_fetch` (owners and admins, one running fetch per company, closes ones stuck for 10 minutes) and `finish_gmail_fetch` (the person who started it; the starting point only moves forward and only for the same inbox) |
| `migrations/20261027090000_notifications.sql` | Phase 6 stage 29: `notifications` (one row per recipient: company, recipient, kind `escalation`/`urgent_issue`/`import_problem`/`scheduler_failed`, short title, optional issue of the same company (deleted with it), dedupe key unique per recipient, created and read times). Read-only for signed-in users, and only their own rows in companies they still belong to; no inserts, updates or deletes from the app. `mark_notification_read(id)` and `mark_all_notifications_read(company)` change only the caller's rows. `private.create_notification(...)` (database only) skips non-members and repeats; later stages call it |
| `migrations/20261027120000_notification_events.sql` | Phase 6 stage 30: `private.notify_staff` (owners and admins of a company, through `create_notification`); triggers `escalations_notify` (per check: up to 10 escalations each notify with the issue link, more become one summary), `issues_notify_urgent` (an open issue created as or raised to High or Critical, once per issue), `import_runs_notify` (an import or fetch that fails or finishes with rejected rows). Titles use Buddy's own labels and the issue reference, never customer text. None of these functions can be called from the app |
| `migrations/20261107090000_similar_issues.sql` | Improvement D, step 1: `pg_trgm` (schema `extensions`) and two text indexes on issues; `issues.duplicate_of` (same company, cleared when the main issue is deleted, no direct grant); `similar_issues(issue)` (security invoker, top 5, threshold 0.3); `link_duplicate` / `unlink_duplicate` (any member, one level deep, history kinds `duplicate_linked` / `duplicate_unlinked`, rate limit 200 an hour) |
| `migrations/20261106090000_play_connections.sql` | Improvement B, step 1: `source_connections` (company, kind `google_play` only, package name, service account address, connected by/at, last fetched; one per kind per company; members read, nobody writes directly; rate limit 20 connects an hour) and `source_credentials` (the encrypted service-account key, no grants). `save_source_connection` and `disconnect_source` (owners), `start_source_fetch` (owners and admins, needs `BUDDY_AI_RESULT_KEY`, one fetch at a time, closes a stuck one after 10 minutes) and `finish_source_fetch` (the person who started it). `issues.source` and `import_runs.source` accept `google_play`. `notify_import_problem` names "Google Play fetch" |
| `migrations/20261031090000_team_notifications.sql` | Improvement F: `team_members` (company, team, person, added_by; both links include `organization_id`, so they can't cross companies; removed when the person leaves or the team is deleted). Members read; owners and admins add and remove (no updates); rate limit 200 additions an hour. Notification kind `team_issue`; `private.notify_team` (database only); statement-level triggers `issues_notify_team_insert` / `issues_notify_team_update` notify a team's members when an open issue gets that team, skipping the person who made the change, dedupe `team_issue:<issue>:<team>`, more than 10 for one team in one statement = one summary. `private.notify_new_escalations` replaced to also notify the escalated issue's team (same dedupe key, so nobody gets one twice) |
| `migrations/20261027150000_scheduler_reliability.sql` | Phase 6 stage 31: trigger `escalation_runs_notify_failure` (a scheduled check that fails notifies owners and admins, at most once a day per company; a failed Check now does not); `private.run_daily_cleanup()` (database owner only) closes imports left running for over an hour as failed "Did not finish." (which notifies), deletes notifications read more than 90 days ago (unread ones are kept) and escalation check logs older than 90 days; cron job `buddy-daily-cleanup` at 03:30 UTC daily |
| `migrations/20261027180000_reports.sql` | Phase 6 stage 32: `public.issue_report(org, from, to)` (members only; security definer, read only; dates are inclusive calendar days in the company's time zone, at most 366; returns one JSON object with totals, times, the response target, escalations, team and other breakdowns and import results; no per-person figures) |
| `migrations/20261028090000_security_foundation.sql` | Phase 7 stage 36: `private.company_creators` (emails that may create a company; current owners copied in) checked by `create_organization` and `public.can_create_company()`; `private.platform_settings.ai_monthly_cap` (default 300 analyses a month for all companies together, checked in `start_issue_analysis` under an advisory lock); both private tables have RLS on and no grants; revokes the default grant on `private.create_escalation_settings` |
| `migrations/20261028120000_ai_result_key.sql` | Phase 7 stage 36 part 2: `private.platform_settings.ai_result_key_hash`, `private.check_ai_result_key`; `start_issue_analysis(uuid, text)` and `finish_issue_analysis(uuid, jsonb, text)` replace the old versions and refuse without the server's key |
| `migrations/20261029090000_rate_limits.sql` | Phase 7 stage 37: `private.rate_limit_events` (RLS on, no grants) and trigger function `private.enforce_rate_limit(action, max, seconds, label)` under an advisory lock per person and action; triggers limit each signed-in person per hour to 30 invitations, 30 imports and Gmail fetches together, 200 issues added by hand (`source = 'manual'`) and 30 "Check now" escalation checks. Database jobs (no `auth.uid()`) are not counted |
| `migrations/20261029120000_data_deletion.sql` | Phase 7 stage 37 PR 2: `deletion_log` (when, who, kind `issue`/`customer`/`retention`, count, issue reference; never customer details; owners read, nobody writes); `delete_issue(id)` and `delete_customer_data(org, email)` (owners only; the old owner/admin delete policy and grant on `issues` are removed); `organizations.retention_days` (30 to 3650 or empty) set by `set_retention_days` (owners); `private.apply_retention()` deletes resolved issues past the setting (5,000 per company per run), called from `private.run_daily_cleanup()`; trigger `issues_clear_analyses` clears the AI text of a deleted issue's analyses |
| `migrations/20261029150000_account_deletion.sql` | Phase 7 stage 37 PR 3: `account_deletion_plan()` (for each of the caller's companies: `leave`, `delete` when they are its only member, `blocked_owner` when they are its only owner and others belong, `blocked_gmail` when it would be deleted with Gmail connected) and `delete_my_account(email)` (typed own email; deletes the solo companies, the company-creators entry, rate-limit counts and the `auth.users` row, which removes the profile and memberships and sets their name to empty elsewhere). `mailbox_token(uuid, text)` and `start_gmail_fetch(uuid, text)` replace the old versions and need the server key (`BUDDY_AI_RESULT_KEY`, checked by `private.check_server_key_for_gmail`) |
| `migrations/20261030090000_health_and_job_status.sql` | Phase 7 stage 38 PR 2: `service_health()` (returns true; anon and signed-in may call it; used by `/api/health`); `scheduled_job_status(org)` (owners and admins of that company only): for the pg_cron jobs `buddy-daily-cleanup` and `buddy-escalation-check`, the name, schedule, whether active, and the latest run's start time and status from `cron.job_run_details`, never the command or error text |
| `tests/security_test.sql` | 545 checks of tenant isolation, roles, invitations, teams, categories, settings, routing rules, AI analysis, resolution tracking, escalations, routing history, scheduled checks, imports, the Gmail connection, fetching, notifications, team members and reports; runs in one transaction and rolls back |
| `tests/local-supabase-stub.sql` | Minimal stand-in for Supabase's `auth` schema and roles, for plain PostgreSQL only. Never run on Supabase |

Tables: `profiles`, `organizations`, `organization_members`,
`organization_invitations`, `teams`, `categories`, `issues`, `issue_activity`,
`routing_rules`, `automation_settings`, `issue_analyses` (Phase 3), `escalation_settings`, `escalations`, `escalation_runs` (Phase 4), `import_runs`, `mailbox_connections`, `mailbox_tokens` (Phase 5), `notifications` (Phase 6), `team_members` (improvement F). Deferred:
`notification_records` (Phase 6). Full design and reasons: Phase 2 plan doc
(https://claude.ai/artifact/7nwyfG2deY29tg9rpVLsBs).

How access works:

- Signed-out visitors (`anon`) have no table rights at all.
- Signed-in users get an explicit allowlist of table/column rights; Row Level
  Security then limits rows to organisations they are a member of
  (`private.is_member`, `private.has_role`).
- Members: read everything in their organisation, create issues, update only
  `status`, `team_id`, `category_id`, `assignee_name`. The first response is
  recorded only through `record_first_response` (time set by the database,
  once per issue); reopen count and waiting time are set only by a trigger.
- Owners/admins: also manage teams, categories, routing rules, automation
  settings, company profile and invitations. Owners only (stage 37): delete
  issues (`delete_issue`, `delete_customer_data`; direct deletes are closed)
  and set how long resolved issues are kept (`set_retention_days`). Every
  deletion is written to `deletion_log` (owners read it; nobody can change it).
- Memberships change only through `create_organization`, `accept_invitation`
  (invited, confirmed email only), `set_member_role` (owners, never self) and
  `remove_member` (last owner cannot leave).
- `issue_activity` is written only by a trigger. Team and category links use
  composite foreign keys so they cannot point at another organisation.
- Organisation `slug` cannot be changed after creation.
- AI analysis (Phase 3): owners and admins switch it on and set the monthly
  limit; only owners change `ai_auto_route` (trigger
  `organizations_only_owner_sets_auto_route`). `issue_analyses` is read-only for users; rows are added only by
  `start_issue_analysis` (member of the issue's company, AI on, under the
  monthly limit counted since the 1st in UTC including failed attempts, not
  the same issue within 30 seconds; locks the company row so two requests
  cannot both take the last one) and finished once by
  `finish_issue_analysis` (only by the person who started it, within 5
  minutes). Finished rows never change; deleting an issue keeps its
  analyses (issue_id cleared, and from stage 37 its summary, next step and
  themes too) so the count cannot be reset.
- Members still cannot set sentiment, type, urgency or summary directly;
  `accept_issue_analysis` is the only way, and only with the values of a
  finished analysis of the same issue.
- Escalations (Phase 4): members read their company's escalation settings,
  escalations and check log. Owners and admins change the settings and run
  `run_escalation_check` for their own company. Escalations and log rows are
  written only by the check, which looks at one company's open issues and
  never changes an issue. Any member can acknowledge an escalation once
  (`acknowledge_escalation`); nobody can add, edit or delete them directly.
- Routing (Phase 4 stage 18): `apply_routing_rule` sets a team only from an
  enabled rule of the issue's own company and only if the team is still what
  the app read; it gives nobody a new power because members can already set
  a team by hand. `routing_dismissed_at` is set only by
  `dismiss_routing_suggestion` (any member).
- Scheduled checks (Phase 4 stage 20): the pg_cron job runs
  `private.run_scheduled_escalation_checks()` as the database owner. Nobody
  can call it from the app, and nobody can write a check-log row directly,
  so a "scheduled" row in Settings always comes from the real scheduler.
- Imports (Phase 5 stage 22): only owners and admins of the company can
  start an import (`start_import`), and only the person who started it can
  add rows (`import_issues`) or finish it (`finish_import`, owners and admins).
  Rows are checked again in the database whatever the browser checked.
  Nobody can write `import_runs` or the source fields directly; members can
  type `customer_email` on a new issue but nobody can change it afterwards.
  A record ID (or, without one, a fingerprint of name, received time and
  message) becomes at most one issue per company, enforced by a unique
  index, so two imports at the same time cannot both add it. The import log
  keeps row numbers and reasons only, never the customer's text.
- Gmail connection (Phase 5 stage 25): only an owner can connect or
  disconnect the company's inbox; every member can see which inbox it is.
  The Google token sits in `mailbox_tokens`, which has no grants and no
  policies, so it is reachable only through `mailbox_token` (owners and
  admins of that company, and `start_gmail_fetch` for the same people). Only
  owners and admins fetch; fetched emails go through `import_issues`, so the
  same checks and the one-issue-per-record rule apply. It is stored encrypted (AES-256-GCM) with
  `GMAIL_TOKEN_KEY`, which exists only on the server, so the database value
  alone cannot be used. The token is never sent to the browser or logged.
- Invite-only company creation (Phase 7 stage 36): `create_organization`
  refuses anyone whose confirmed email is not in `private.company_creators`.
  Anyone can still make an account; without an invitation it can do nothing.
  The list and `private.platform_settings` (the AI limit for the whole app)
  are changed only in the SQL Editor; the API cannot reach the private
  schema. `supabase/seed.sql` raises the AI limit to 100,000 on local
  databases only, so repeated browser test runs don't use it up.

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
| `BUDDY_AI_MODE` | No | `fake` swaps in the free keyword test analyser (automated tests and CI). Leave unset otherwise. From stage 39 it only works when Buddy runs on this computer (dev server, or `BUDDY_SITE_URL` on localhost); on a live server it is ignored and logged, and AI shows as not set up |
| `GOOGLE_CLIENT_ID` | **Never** (server only) | Google OAuth client for connecting Gmail (stage 25). Read only in `src/lib/gmail/index.ts` |
| `GOOGLE_CLIENT_SECRET` | **Never** (server only) | Secret of that OAuth client |
| `GMAIL_TOKEN_KEY` | **Never** (server only) | 32 random bytes in base64 that encrypt the stored Gmail token. Changing it means reconnecting Gmail (steps in docs/RUNBOOK.md §7). All three must be set for Connect Gmail to appear |
| `BUDDY_AI_RESULT_KEY` | **Never** (server only) | Stage 36 part 2: random key (`npm run ai-key`) that `start_issue_analysis` and `finish_issue_analysis` require; the database stores only its SHA-256 hash in `private.platform_settings.ai_result_key_hash`. Without it AI shows as not set up. From stage 37 also required by `mailbox_token` and `start_gmail_fetch` (Gmail fetching). Read only in `src/lib/ai/index.ts` |
| `BUDDY_SITE_URL` | Not secret (server only) | Buddy's own address for sign-up email links and invitation links (stage 36, `src/lib/site-url.ts`). Optional in development (the request's address is used); in production Buddy refuses to make those links without it, because Host/Origin headers can be faked. From stage 39 also the Gmail return address in production (`gmailCallbackUrl`), and what decides whether fake modes may run |
| `BUDDY_GMAIL_MODE` | No | `fake` swaps in a pretend Google for automated tests and CI. Leave unset otherwise. Same stage 39 guard as `BUDDY_AI_MODE` |
| `BUDDY_PLAY_MODE` | No | `fake` swaps in a pretend Google Play with made-up reviews for automated tests and CI. Same guard as `BUDDY_AI_MODE` |
| `BUDDY_PLAY_REAL` | No | `on` lets owners connect a real Google Play app (real customer reviews). Unset everywhere until real data is approved; needs `GMAIL_TOKEN_KEY` |

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
| `npm.cmd test` | Unit tests (`tests/unit/`): routing rule matching, conflicts and explanations, analytics, input rules, deadlines, escalations, CSV reading and checks, AI batches, token encryption and Google sign-in links, turning Gmail messages into issues, AI engine with stand-in clients | Nothing |
| `npm.cmd run test:db` | `supabase/tests/security_test.sql` (503 checks); rolls itself back | Local Supabase |
| `npm.cmd run test:e2e` | Browser tests (`tests/e2e/`, Playwright): sign-up, invitations, roles, issues, settings, routing, AI analysis and automatic routing (free test analyser), deadlines and first response, escalations, dashboard counts, data sources, CSV import, AI for imports, Gmail connect, disconnect and fetch (pretend Google), cross-company access | Local Supabase, test browser |

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
It also runs `npm audit --audit-level=high`, so a high or critical advisory
in any package turns the check red. Each action is pinned to an exact commit
(version in the comment). Dependabot (`.github/dependabot.yml`) opens update
PRs weekly for npm (minor and patch grouped, at most 3 open) and monthly for
the actions; Claude reviews them before Jugal merges. Major versions of
npm packages are ignored: those need their own planned upgrade (Dependabot
proposed Next 16, TypeScript 7, Vitest 5 and @types/node 26 on 2026-10-26;
all closed).

## 11. Important technical decisions

- **AI and real customer data (F2, recorded 2026-10-26, stage 37).** Gemini's
  free tier stays for made-up data only. Before real customer messages are
  analysed (Gate 3), the owner picks a paid Gemini tier, the Claude API, or
  AI off; until then AI stays off for real data. No code change.
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
  unless an owner switched on "Apply routing automatically" (Phase 3), which
  only fills an empty team after AI analysis; "Apply suggestion" and "Route
  open issues that have no team" are buttons.
- **Phase 3 AI choices (approved 2026-10-23, Gemini added 2026-10-24):** AI
  runs on Buddy's server with the user's own session, only through
  `getAnalyser()`; Claude Haiku 5.5 or Gemini 3.5 Flash-Lite depending on
  which key is set (Claude wins if both); off per company until an owner or
  admin switches it on; monthly limit enforced in the database; the AI fills
  only the fields left to it and everything else gets an Accept button;
  tests never call a paid API.
- **Saves report success only after the database confirms**, and updates ask
  for the row back, because a refused update changes 0 rows without an error.
- **Phase 5 data-source choices (approved 2026-10-24):** every source
  saves issues through one function (`import_issues`), which checks each row
  again and keeps one issue per source record, so nothing is imported twice;
  CSV files are read in the browser and never stored; Gmail is read-only,
  one inbox per company, fetched only when someone presses the button (no
  automatic fetching), with the Google token encrypted by a server-only key
  in a table nobody can query; AI on imported issues only after a
  confirmation that shows the month's remaining analyses; test data only
  until Phase 7.
- **Tests run against a local Supabase**, never the hosted project:
  `test:db` refuses other hosts and the browser tests take their settings from
  `npx supabase status`.

## 12. Known bugs, limitations and technical debt

- **npm audit:** 0 findings on 2026-10-24 (stage 10 moved Vitest from 3.2 to
  4.1.12; 3.2 had 1 moderate and 2 critical advisories in its test-runner
  dependencies). Still **never run `npm audit fix --force`**: it makes
  breaking upgrades, such as downgrading `eslint-config-next` to a version
  that doesn't match Next 15. If findings appear, check whether
  `npm audit --omit=dev` (what the app ships) is still 0 and upgrade the
  package named, one at a time.
- Phase 7 inspection (stage 35, 2026-10-25): full report and plan at
  https://claude.ai/artifact/NYCfw1NtEYH6wLSK9jwe4P (findings F1 to F29).
  Stage 36 closes F1 (open sign-up with AI on the owner's key), F4 (security
  headers), F7 (links built from request headers), F12 and F13. Stage 37 PR 1 adds
  rate limits (F6) and password reset (F8); PR 2 adds deleting an issue or a
  customer's data and a retention setting (F3). PR 3 adds Delete my account (F9; leaving a company already
  existed), F11 and F19, and records the F2 decision. Still open, planned for
  stages 38 to 40: the AI provider for real data, monitoring, backups, a
  runbook, deployment settings, a privacy notice. Stage 38 plan:
  https://claude.ai/artifact/V4RhX8cXG4hXexEez9ttaS; PR 1 closes F17 (audit
  in CI, Dependabot, pinned actions); PR 2 closes F8's health page part and
  F18 (Settings shows whether the daily clean-up ran); PR 3 closes F16, F20,
  F24 and F27 (`npm run backup`, docs/RUNBOOK.md with key changes and
  restore). Stage 39 closes F14, F21, F26, F28 (PRs #49 to #51) and F15
  (Jugal set minimum password 8 on the hosted project).
- Phase 7 final report (stage 40, 2026-10-27):
  https://claude.ai/artifact/XvYVHKnsDwr2g1ZHWPi3rV. Of F1 to F29: 19 fixed
  in code, 3 done by the owner (F15, F18, F24), 2 partly (F8: an uptime
  checker needs a live server; F16: the free project still pauses when
  idle, no keep-awake by the owner's choice), 3 decisions (F2, F22, F25),
  1 open (F23, a customer-data export, goes with F22), F29 needed nothing.
  New low findings: N1 CSP inline scripts, N2 200-issue cap without paging,
  N3 npm 11 install-script warnings (`@google/genai`, `protobufjs`,
  `unrs-resolver`), N4 Supabase's built-in email limit. Never tested on a
  live server; restore rehearsed only locally.
- Hosted project as reported by the owner on 2026-10-26: Free plan, Confirm
  email on, minimum password 8, Site URL `http://localhost:3000`, Redirect
  URL `http://localhost:3000/**`, Google OAuth app in Testing, daily
  clean-up running, two backups made.
- The Content-Security-Policy still allows inline scripts, because Next.js
  adds them to every page; moving to per-request nonces is a later change.
- Demo pages load the whole workspace into the browser. Real workspaces
  filter on the server and show 50 issues per page (improvement A, step 1,
  closes N2). Pages count from the newest, so a new issue moves the rest
  along by one; page numbers above 1,000 are treated as page 1.
- The assignee is a name picked from the workspace's members (stored as
  text, `assignee_name`), not a link to a user account.
- Deleting a team or category clears it from issues; deleting a team that a
  routing rule uses is refused until the rule changes.
- Deadlines are counted around the clock (no business hours or holidays).
- The workspace home counts the newest 1,000 open issues (it says so when
  there are more), and unacknowledged escalations are read up to the
  database's 1,000-row reply limit.
- The "This week" card opens the Issues list with "This week" on
  (`?status=all&week=1`), so it lists the issues it counted.
- Every scheduled escalation check adds a row to `escalation_runs` (about 96
  a day per company with a condition on). From stage 31 the daily clean-up
  (03:30 UTC) deletes rows older than 90 days.
- A free Supabase project pauses after about a week without activity, and
  pg_cron stops with it. Settings then warns that automatic checks may have
  stopped; restoring the project in the Supabase dashboard starts them again.
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
- Closed in Phase 7 stage 36 part 2 (finding F5): a member used to be able
  to call `finish_issue_analysis` directly and record a made-up "AI" answer.
  Starting and finishing an analysis now need `BUDDY_AI_RESULT_KEY`, which
  only the server has. A member who calls `start_issue_analysis` with the
  right key could still only reserve an analysis, never fill it in.
- Automatic routing only happens right after an AI analysis (on save or
  "Analyse again"); issues added while AI is off still need the buttons.
- AI cost per message has not been measured on real traffic yet: Settings
  shows the estimate from the token counts each answer reports. Gemini's free
  tier costs nothing but Google may use what is sent.
- Code lives in the private GitHub repo `sjugal2003/Buddy` (from 2026-10-23).
  Each stage arrives as a pull request.

- **CSV import (stage 23):** closing the page or losing the connection
  part-way leaves that import "Not finished" in the history; the rows already
  saved stay, and importing the same file again adds only the rest (repeats
  are skipped). There is no way in the app to undo a whole import. From stage 37 the owner
  can delete one issue (issue page) or every issue from one customer email
  (Settings > Customer data); other bulk removals are done in the Supabase
  SQL Editor (see the README's troubleshooting table). Rows without an ID column are
  matched by customer name, received time and message, so editing any of
  those in the file makes the row new again.

- **AI for imports (stage 24):** the batch runs in the browser, so closing
  the page stops it (analyses already done are kept; pressing "Analyse with
  AI" again continues with the rest). It stops at the first failed analysis;
  a failed attempt still counts toward the month, as on the issue page. With
  Gemini's free tier a batch of 100 takes about 11 minutes because of the
  pause between requests.

- **Gmail connect (stage 25):** the Google project stays in Testing mode
  (free, no Google review), so only listed test users can connect, Google
  shows an "unverified app" warning, and the sign-in expires after 7 days;
  the owner then disconnects and connects again. One inbox per company.
  Fetching is by button only (no automatic fetching, by Jugal's decision),
  50 emails per press; with more than 500 new emails since the last fetch the
  oldest are left out (the result says so). Attachments are not kept, and
  replies quoted inside an email stay in its text. Each email becomes its own
  issue (replies in a thread are not grouped yet). Use a test
  Gmail account with made-up emails until Phase 7's security review.

- **Notifications (Phase 6, team members from improvement F):** in Buddy
  only (no email, chat or SMS). Owners and admins get every kind; members of
  a team (Settings > Teams) also get "New issue for <team>" when an open issue
  is given to their team (not the person who did it; moving it away and back
  doesn't repeat; more than 10 at once become one summary) and that team's
  escalations. Urgent-issue, import and failed-check notifications stay
  owners and admins only. There are no per-person on/off settings. Each event notifies each
  person once; more than 10 escalations in one check become one summary; a
  failing automatic check notifies at most once a day. Events from before
  the notifications migrations were pushed never notify. Read notifications
  are deleted after 90 days; unread ones are kept. There is no "approaching
  the deadline" warning (escalations cover missed targets).
- **Daily clean-up (Phase 6):** the `buddy-daily-cleanup` pg_cron job (03:30
  UTC) was confirmed to be scheduled on Jugal's hosted project on
  2026-10-25 and seen running successfully there on 2026-10-26 (09:00 IST,
  in Settings > Scheduled jobs). Like the 15-minute job, it stops while a
  free Supabase project is paused (docs/RUNBOOK.md §2).
- **Reports (Phase 6):** times run around the clock from arrival (no
  business hours), and the response target uses the current targets in
  Settings, so changing a target changes past figures too. Response times
  exist only where someone pressed "Record first response"; resolution time
  is from arrival to the latest resolution (time waiting on the customer
  included). Past conversations imported as already resolved count as
  received but are not timed. The import figures come from the import
  history, which keeps the counts from the time of each import even if those
  issues were deleted later. Ranges are at most 366 days. There are no
  per-person figures (the assignee is free text, and raw counts are not a
  fair measure of a person's work).

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
3. AI analysis of customer messages. **Done (2026-10-24).**
4. Routing, issue tracking, escalation. **Done (2026-10-24).**
5. Supported data-source integrations. **Done (2026-10-24).** Plan approved
   2026-10-24 (https://claude.ai/artifact/CfWmbfR8736bJ6zZ7JJru9): CSV import
   first, then a Gmail inbox read with a "Fetch new email" button; AI on
   imports only after confirming, within the monthly limit; public form and
   webhook in Phase 7 after deployment; other sources one at a time later;
   optional `customer_email` on issues.
6. Notifications, schedules, reports. Plan approved 2026-10-25 with all 10
   recommendations (https://claude.ai/artifact/Q4PeLd8ghwsn4fxbsFVBTd):
   in-app notifications only, for owners and admins, on escalations, new
   urgent or critical issues, import or fetch problems and failed scheduled
   checks; read ones deleted after 90 days; reuse the pg_cron scheduler; a
   Reports page everyone in the company can see (no per-person figures);
   optional CSV export. Stages 29 to 34, one PR each, Jugal's go before each.
   **Done (2026-10-25).**
7. Security, reliability and deployment readiness. Inspection report and
   plan (stage 35) approved by Jugal 2026-10-25
   (https://claude.ai/artifact/NYCfw1NtEYH6wLSK9jwe4P): 36 security
   foundation, 37 data, API and AI protection, 38 reliability and recovery,
   39 deployment preparation (no deploy), 40 final checks and launch
   decision. One stage at a time, Jugal's go before each; deployment, real
   customer data, production database, OAuth and credential changes each
   need Jugal's explicit approval.

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
  client. PR #12, merged 2026-10-24. Jugal ran a real Gemini analysis on
  their PC on 2026-10-24 and it worked (Critical, Negative, Complaint,
  Billing, 95% sure).
- Stage 14: the Issues list shows an "AI suggested" badge and the AI summary
  for analysed issues. Routing rules already see AI values because accepted
  values are copied onto the issue. New owner-only switch
  `organizations.ai_auto_route` (migration `20261024150000_ai_auto_route.sql`,
  a trigger refuses the change from anyone but an owner): after an analysis,
  `analyseIssue` gives an issue with no team the team of its first matching
  rule, only while it still has no team (since stage 18: only when the
  matching rules agree). 157/157 security checks, 7/7
  browser tests (new `tests/e2e/ai-routing.spec.ts`), 53 unit tests, lint,
  type check, build (2026-10-24). PR #14, merged 2026-10-24. Verified by
  Jugal on the hosted project: Gemini analysed a payment complaint, the
  "Category billing" rule moved it to Payment, and History recorded it.
- Stage 15: README, this file and CLAUDE.md brought up to date (this PR).
  PR #13 (same day) switched the update steps to `npm.cmd ci`.

Phase 3 is complete.

Phase 4 (routing, issue tracking, escalation). Plan approved by Jugal on
2026-10-24 with all recommended decisions
(https://claude.ai/artifact/V181LkvSKRvS81NYB9MCtm). Stages: 16 resolution
tracking and deadlines, 17 escalation engine ("Check now"), 18 routing
explanations and conflicts, 19 dashboard, 20 scheduled checks (pg_cron),
21 docs.
- Stage 16: resolution targets in Settings; deadlines for first response
  and resolution (counted around the clock; time in "Waiting on customer"
  pauses the resolution deadline; a reopened issue keeps its original
  arrival time); "Record first response" button (never inferred from a
  status change); reopen count; history for category, resolved, reopened
  and first response; deadline filter and "needs attention first" sort on
  the Issues list. Migration `20261025090000_resolution_tracking.sql`.
  181/181 security checks, 8/8 browser tests (new
  `tests/e2e/deadlines.spec.ts`), 65 unit tests, lint, type check, build
  (2026-10-24). PR #16, merged 2026-10-24.
- Stage 17: escalation engine. Settings card with five conditions (all off
  by default): first-response breach (level 1), resolution breach (level
  2, paused while waiting on the customer), Critical/High with no team after
  N hours (level 2 if Critical), open with no team after N hours, no update
  for N hours. "Check now" for owners and admins; each condition escalates
  an issue once per open spell (reopening starts a new one); a failed check
  is logged with its reason and saves nothing. Escalations are separate
  records that never change the issue; badge on the issue and the Issues
  list; Acknowledge with a note; history entries. No scheduled checks yet
  (stage 20) and no notifications (Phase 6). Migration
  `20261025120000_escalations.sql`. 224/224 security checks, 9/9 browser
  tests (new `tests/e2e/escalations.spec.ts`), 70 unit tests, lint, type
  check, build (2026-10-24). PR #17, merged 2026-10-24.
- Stage 18: routing explanations and conflicts. The issue page says which
  rule matched and why; when matching rules name different teams it shows a
  conflict with a button per rule. Bulk and automatic routing skip conflicts
  and dismissed suggestions and say how many were skipped. "Dismiss
  suggestion" hides it until the category, urgency, type or channel changes.
  A team set by a rule is recorded as "Moved to team X by routing rule ...".
  The demo pages keep "first match wins" (`findMatchingRule`). Migration
  `20261025150000_routing_explanations.sql`. 246/246 security checks, 9/9
  browser tests (routing test extended), 75 unit tests, lint, type check,
  build (2026-10-24). PR #18, merged 2026-10-24.
- Stage 19: dashboard on the workspace home, from the company's own issues
  only, counted on the server (`src/lib/dashboard.ts`). The same predicates
  drive new Issues list filters (`?urgency=urgent`, `?due=2h`,
  `?escalated=open`), so each card's number matches the list it opens. "This
  week" starts Monday 00:00 in the company's time zone. A company with no
  issues sees zeros and a "Nothing yet" note. History lines moved to
  `src/lib/activity.ts` (shared by the issue page and the home page). No
  database change. 246/246 security checks, 10/10 browser tests (new
  `tests/e2e/dashboard.spec.ts`), 84 unit tests, lint, type check, build
  (2026-10-24) PR #19, merged 2026-10-24.
- Stage 20: automatic escalation checks. Migration
  `20261025180000_scheduled_escalation_checks.sql` enables pg_cron and
  schedules `buddy-escalation-check` every 15 minutes; it checks every
  company with a condition on, logged as `scheduled` runs (no person as
  starter). Settings says "Automatic checks: Running every 15 minutes." only
  once a scheduled run is logged for that company, and warns after 45
  minutes without one. Still no email or chat notifications (Phase 6).
  256/256 security checks, 10/10 browser tests (escalations test runs the
  scheduled check once), 87 unit tests, lint, type check, build
  (2026-10-24). PR #20, merged 2026-10-24. Seen running on Jugal's hosted
  project: Settings showed "Running every 15 minutes." with a scheduled
  check at 17:30 Asia/Calcutta (12:00 UTC) on 2026-10-24.
- Stage 21: documentation brought up to date (README, this file, known
  limitations), full checks re-run on main after PR #20: 256/256 security
  checks, 10/10 browser tests, 87 unit tests, lint, type check, build,
  `npm audit` 0 (2026-10-24). Phase 5 plan drafted for approval:
  https://claude.ai/artifact/CfWmbfR8736bJ6zZ7JJru9

Phase 4 is complete. Verified on Jugal's hosted project: deadlines and the
first-response button (stage 16), escalations, Check now and Acknowledge
(stage 17), scheduled checks (stage 20). Stages 18 and 19 were applied
there (db push on 2026-10-24) and covered by the browser tests.

Phase 5 (data sources). Jugal approved the plan and its six decisions on
2026-10-24. One stage per PR, each reviewed before the next starts.
- Stage 22: import foundation. Migration
  `20261026090000_import_foundation.sql` (source fields, customer email,
  `import_runs`, `start_import` / `import_issues` / `finish_import`);
  optional customer email on the new-issue form and issue page; Data sources
  tab with import history. No upload yet (stage 23). 294/294 security
  checks, 11/11 browser tests (new `tests/e2e/data-sources.spec.ts`), 88
  unit tests, lint, type check, build, `npm audit` 0 (2026-10-24). PR #22,
  merged 2026-10-24; applied and checked on Jugal's hosted project (customer
  email on a new issue, Data sources "No imports yet").
- Stage 23: CSV import on the Data sources page (see section 5). No
  database change. 294/294 security checks, 13/13 browser tests (new
  `tests/e2e/csv-import.spec.ts`, including a 1,201-row file sent in three
  pieces and the same file in another company), 102 unit tests (new
  `tests/unit/csv-import.test.ts`), lint, type check, build, `npm audit` 0
  (2026-10-24). PR #23, merged 2026-10-24; checked on Jugal's PC with
  `test-import.csv` (3 imported, 1 skipped, 2 rejected).
- Stage 24: AI for imported issues ("Analyse with AI", see section 5). No
  database change: the monthly limit and switch are still enforced by
  `start_issue_analysis`. 294/294 security checks, 14/14 browser tests (new
  `tests/e2e/import-ai.spec.ts` with the free test analyser: AI off, a limit
  of 2 offering 2 of 3, Cancel uses nothing, used-up month, no issue analysed
  twice, members and other companies kept out), 107 unit tests (new
  `tests/unit/import-ai.test.ts`), lint, type check, build, `npm audit` 0
  (2026-10-24). PR #24, merged 2026-10-24; checked on Jugal's PC (Gemini
  analysed the imports and automatic routing moved them).
- Stage 25: connect a Gmail inbox (see section 5). Migration
  `20261026120000_gmail_connection.sql`. 321/321 security checks, 15/15
  browser tests (new `tests/e2e/gmail.spec.ts` with a pretend Google: a
  forged return connects nothing, owner connects and disconnects, member
  cannot, another company sees nothing), 114 unit tests (new
  `tests/unit/gmail.test.ts`), lint, type check, build, `npm audit` 0
  (2026-10-24). PR #25, merged 2026-10-24; checked on Jugal's PC with real
  Google (connected read-only).
- Stage 26: Fetch new email (see section 5). Migration
  `20261026150000_gmail_fetch.sql`. 342/342 security checks, 16/16 browser
  tests (new `tests/e2e/gmail-fetch.spec.ts` with a pretend inbox of three
  emails: fetched once, fetching again adds nothing, member and other company
  cannot fetch), 126 unit tests (new `tests/unit/gmail-message.test.ts`),
  lint, type check, build, `npm audit` 0 (2026-10-24). PR #26, merged
  2026-10-24; checked on Jugal's PC with real Gmail: a new test inbox
  fetched, and pressing again said "No new email since the last fetch".
- Stage 27: documentation brought up to date (README: trying the data
  sources, Gmail troubleshooting, test counts; `samples/test-import.csv`;
  CLAUDE.md Gmail rules; this file). No code or database change.

Phase 5 is complete. Verified on Jugal's hosted project: customer email
(stage 22), CSV import (stage 23), AI for imports (stage 24), Gmail connect
(stage 25) and Fetch new email (stage 26). Deferred by Jugal's decisions:
automatic Gmail fetching, the public contact form and webhook (Phase 7, after
deployment and security hardening), and helpdesk, live chat, app store,
review, survey and social integrations (one at a time, once Jugal names the
tools). Real customer data waits for Phase 7's security review. Next:
Phase 6 (notifications, schedules, reports): see below.

Phase 6:
- Stage 28: inspection report and plan (no code), approved 2026-10-25.
- Stage 29: notification foundation (see sections 5 and 7). Migration
  `20261027090000_notifications.sql`. 376/376 security checks, 17/17 browser
  tests (new `tests/e2e/notifications.spec.ts`: empty bell and page,
  notifications added inside the test database, unread count, links, mark
  one and all as read, another company's person sees only their own and gets
  "not found" for the first company), 133 unit tests (new
  `tests/unit/notifications.test.ts`), lint, type check, build, `npm audit` 0
  (2026-10-25). PR #28, merged 2026-10-25; applied and checked on Jugal's
  PC (bell and empty page).
- Stage 30: notification events (see sections 5 and 7). Migration
  `20261027120000_notification_events.sql`. 397/397 security checks, 18/18
  browser tests (new `tests/e2e/notification-events.spec.ts`: a critical
  issue, an escalation from Check now and a CSV import with a rejected row
  each reach the owner's bell with the right link and no customer words; a
  member and another company get none), 133 unit tests, lint, type check,
  build, `npm audit` 0 (2026-10-25). PR #29, merged 2026-10-25; applied
  and checked on Jugal's PC (a Critical issue and a CSV import with rejected
  rows each notified; Mark all as read worked).
- Stage 31: scheduler reliability (see sections 5 and 7). Migration
  `20261027150000_scheduler_reliability.sql`. 414/414 security checks, 19/19
  browser tests (new `tests/e2e/scheduler-health.spec.ts`: a failed scheduled
  check notifies once a day and shows in Settings with no successful check
  yet; a successful check clears it), 136 unit tests, lint, type check,
  build, `npm audit` 0 (2026-10-25). The 03:30 UTC clean-up job only counts
  as working on the hosted project once it has been seen to run there.
- Stage 32: Reports page (see sections 5 and 7). Migration
  `20261027180000_reports.sql`. 426/426 security checks (company B's
  January 2025 counted in India time; members only, no other company,
  refused ranges), 20/20 browser tests (new `tests/e2e/reports.spec.ts`:
  empty report, figures for 30 days, 7 days and a custom range, an
  unusable range, and "not found" for another company), 150 unit tests
  (new `tests/unit/reports.test.ts`), lint, type check, build, `npm audit` 0
  (2026-10-25). PR #31, merged 2026-10-25; applied and checked on Jugal's
  PC (figures add up; the import history keeps counts from the time of each
  import, even for issues deleted later).
- Stage 33: report CSV download (see section 5). No database change. 158
  unit tests (new `tests/unit/report-csv.test.ts`: quoting, formula-safe
  names, minutes, no per-person columns), 20/20 browser tests
  (`tests/e2e/reports.spec.ts` now downloads the file and checks another
  company gets 404 and a signed-out visitor is sent to sign in), 426/426
  security checks, lint, type check, build, `npm audit` 0 (2026-10-25).
  PR #32, merged 2026-10-25; checked on Jugal's PC (the file opened in
  Excel with the same figures as the page).
- Stage 34: wrap-up (README: status, trying notifications and reports, new
  pages and troubleshooting rows; this file: limitations). No code or
  database change. Every check run once more: 426/426 security checks, 20/20
  browser tests, 158 unit tests, lint, type check, build, `npm audit` 0
  (2026-10-25).

Phase 6 is complete. Verified on Jugal's hosted project: the bell and
Notifications page (stage 29), notifications for a Critical issue and an
import with rejected rows (stage 30), the automatic-check status and both
pg_cron jobs scheduled (stage 31), the Reports page (stage 32) and its CSV
download (stage 33). Not yet seen on the hosted project: a notification for
an escalation or a failed automatic check (both covered by tests), and a run
of the daily clean-up job. Deferred by Jugal's decisions: email, WhatsApp,
Slack and other outside notifications, per-person notification settings,
"approaching the deadline" warnings and per-person reports. Next: Phase 7
(security, reliability and deployment readiness), only after Jugal approves
a plan.

Phase 7 (security, reliability and deployment readiness).
- Stage 35: read-only inspection and plan (no code change). Report:
  https://claude.ai/artifact/NYCfw1NtEYH6wLSK9jwe4P. 0 Critical, 3 High
  findings (open sign-up with AI on the owner's key; Gemini free tier and
  real data; no deletion or retention process).
- Stage 36 (first part): invite-only company creation, an AI limit for the
  whole app, security headers (`next.config.ts`), `BUDDY_SITE_URL` for
  email and invitation links, Gmail disconnect checks the owner role before
  revoking, tidied grant. Migration `20261028090000_security_foundation.sql`.
  Tests: `security_test.sql` (436 checks), new
  `tests/e2e/security-foundation.spec.ts`, new `tests/unit/site-url.test.ts`.
  PR #34, merged 2026-10-25; pushed and checked on Jugal's PC (own email on
  the list, limit 300, a new account sees "You need an invitation").
- Stage 36 part 2: only Buddy's server can record AI results (F5).
  Migration `20261028120000_ai_result_key.sql` replaces
  `start_issue_analysis(uuid)` and `finish_issue_analysis(uuid, jsonb)` with
  versions that take `p_server_key`, checked against
  `private.platform_settings.ai_result_key_hash`. `npm run ai-key` makes a
  key and prints its SQL line. 444 security checks.
  PR #35, merged 2026-10-26; pushed and checked on Jugal's PC (key set up,
  a Gemini analysis worked).
- Stage 37 PR 1: limits on repeated actions and Forgot password. Migration
  `20261029090000_rate_limits.sql` (see §7). `/forgot-password`
  (`requestPasswordReset`, always the same answer so it doesn't reveal who
  has an account; the link goes through `/auth/confirm` to
  `/reset-password`) and `/reset-password` (`updatePassword`, signed-in
  only). 450 security checks; new `tests/e2e/account.spec.ts`.
  PR #36, merged 2026-10-26; pushed and checked on Jugal's PC (Forgot
  password worked).
- Stage 37 PR 2: deleting data and how long it is kept (F3). Migration
  `20261029120000_data_deletion.sql` (see §7). Issue page: "Delete issue"
  card for owners (type the reference to confirm; `deleteIssue` in
  `app/actions/data.ts`, then the list says "Issue ... was deleted.").
  Settings > "Customer data": retention choice (`updateRetention`), "Delete a
  customer's data" by email with a tick box (`deleteCustomerData`), and the
  deletion log (owners only). Wording in `src/lib/data-retention.ts`.
  483 security checks; new `tests/e2e/data-deletion.spec.ts` and
  `tests/unit/data-retention.test.ts`.
  PR #37, merged 2026-10-26; pushed and checked on Jugal's PC.
- Stage 37 PR 3: your own account and small fixes. Migration
  `20261029150000_account_deletion.sql` (see §7). `/account` page (link from
  the email in the workspace header): change password, the deletion plan per
  company and "Delete my account" (`deleteMyAccount` in
  `app/actions/auth.ts`, type your email; signs out and shows "Your account
  has been deleted." on `/login`). F11: Gmail token only with the server key
  (`aiResultKey()` passed by `fetchGmail` and `disconnectGmail`; disconnect
  still works without it but then can't cancel Google's access). F19:
  `cancelInvitation` validates the id, asks for the row back and shows a
  message (`CancelInvitationButton`). F2 recorded in §11. 503 security
  checks; new tests in `tests/e2e/account.spec.ts`.
  PR #38, merged 2026-10-26; pushed and checked on Jugal's PC. Stage 37
  complete. F2 (AI for real data): Jugal chose to decide at launch (stage 40).
- Stage 38 PR 1: package safety checks (F17). `npm audit --audit-level=high`
  step in `.github/workflows/checks.yml`, actions pinned to commits,
  `.github/dependabot.yml` (npm weekly, actions monthly). No app or database
  change. PR #39, merged 2026-10-26; Jugal switched on Dependabot alerts and
  security updates.
- Stage 38 PR 2: noticing problems (F8, F18). Migration
  `20261030090000_health_and_job_status.sql` (see §7). `/api/health` (see
  §5). Settings > "Scheduled jobs" (owners and admins): the daily clean-up's
  latest run from pg_cron's history (`getScheduledJobs` in `live.ts`, wording
  in `src/lib/scheduled-jobs.ts`; red when the last run failed or the last
  success is over 26 hours old; Settings still opens if it can't be read).
  Server logs were checked: they already log `[where] code message`, never
  customer names, emails or messages. 512 security checks; new
  `tests/unit/scheduled-jobs.test.ts` and a second test in
  `tests/e2e/scheduler-health.spec.ts`. PR #44, merged 2026-10-26; Jugal
  pushed it and saw `{"status":"ok"}` and "Daily clean-up: Working" on the
  hosted project. Dependabot PRs #40 (actions v7) and #41 (React 19.3,
  Playwright) merged after review; #42 (Next 16) and #43 (TypeScript 7)
  closed.
- Stage 38 PR 3: backups and recovery (F16, F20, F24, F27).
  `npm run backup` (`scripts/backup.mjs`, steps in `scripts/backup-plan.mjs`)
  runs `supabase db dump --linked` three times (roles, structure, data of
  `auth`, `public` and `private` with COPY) into `backups/<date>_<time>/`,
  which Git ignores. It needs Docker Desktop (Jugal chose to install it).
  `docs/RUNBOOK.md`: health check, paused project, error pages, scheduled
  jobs, AI, Gmail, leaked keys (each key, including `GMAIL_TOKEN_KEY`:
  disconnect, new key, reconnect), backups and restore. Restore (new project,
  `db push`, then `data.sql` through `psql` in Docker with
  `session_replication_role = replica` after clearing the migration-made
  `private.platform_settings` row) was rehearsed on the local database on
  2026-10-26: all rows back and a restored user signed in. README's
  `GMAIL_TOKEN_KEY` command now uses Node's crypto random bytes instead of
  `Get-Random`. New `tests/unit/backup-plan.test.ts`.
- Stage 38 tidy-up: PR #48 (no DEP0190 warning from `npm run backup` on
  Windows; `wsl --install` step in RUNBOOK §8 and README). Merged and
  verified by Jugal 2026-10-26. Stage 38 complete.
- Stage 39 (deployment prep, no deploy), plan approved 2026-10-26:
  https://claude.ai/artifact/XcP15nVzF5ZNfqiDYg7K7p
- Stage 39 PR 1: safety guards (F14, F26). `runsOnThisComputer()` in
  `src/lib/site-url.ts` (dev server, or a production build whose
  `BUDDY_SITE_URL` is localhost/127.0.0.1). `BUDDY_AI_MODE=fake` and
  `BUDDY_GMAIL_MODE=fake` work only then; otherwise they are ignored with a
  log line and AI/Gmail show as not set up. Gmail's OAuth return address comes
  from `gmailCallbackUrl()` (`src/lib/gmail/oauth.ts`): `BUDDY_SITE_URL` +
  `/api/gmail/callback` in production (Connect Gmail says "not set up" without
  it), the request's address in development. Unit tests in `site-url`, `ai`
  and `gmail` tests (189 unit tests).
- Stage 39 PR 1 = PR #49, merged and verified by Jugal 2026-10-26.
- Stage 39 PR 2: Node 24 and `npm run check-env` (F28, F21). CI reads the
  Node version from `.nvmrc` (24; Node 20 reached end of life in April 2026);
  `package.json` `engines.node` is `24.x` so a host picks the same.
  `scripts/check-env.mjs` (rules in `scripts/check-env-plan.mjs`, tested in
  `tests/unit/check-env.test.ts`) reads `.env.local` plus Buddy's variables
  from the environment and prints each known setting as set or missing,
  never a value. Errors (exit 1): missing Supabase settings, any
  `NEXT_PUBLIC_` name besides the two Supabase ones, a Supabase secret or
  service_role key under any name, an unusable `BUDDY_SITE_URL`; with
  `--live` also a missing, non-https or localhost `BUDDY_SITE_URL` and any
  test mode. Warnings: half-set AI or Gmail, short AI result key, wrong-size
  `GMAIL_TOKEN_KEY`, test modes on this computer.
- Stage 39 PR 2 = PR #50, merged; Jugal's `check-env` showed no problems
  (2026-10-26).
- Stage 39 PR 3: deployment guide (F21, F26, F15). New `docs/DEPLOYMENT.md`:
  stage 40 decisions, the settings table, Vercel Hobby steps (only after the
  Gate 1 go), Supabase URL Configuration and Google redirect URI for launch
  day, checks after launch, rollback, and a checklist Jugal does now
  (plan, Confirm email, Site URL, OAuth publishing status; set minimum
  password length 8). Local `supabase/config.toml` minimum password is now 8
  too. `.env.example` uses Node's `randomBytes` for `GMAIL_TOKEN_KEY`. README
  links the guide. F29 needed nothing (stages 36 to 38 added those tests).
- Improvement F (team notifications), approved by Jugal 2026-10-27 from the
  improvement backlog A to F (inspection report
  https://claude.ai/artifact/S8TTFwnxuuAMgtZzqUW1RZ, design
  https://claude.ai/artifact/LfDkkYtu9pKt5h12DMfMt7). Settings > Teams lists
  each team's members; owners and admins add people from the company and
  remove them (`addTeamMember` / `removeTeamMember` in
  `app/actions/settings.ts`, `TeamMembers` in `settings-forms.tsx`). Team
  members get in-app "New issue for <team>" notifications (label "Your
  team") and the team's escalations. Migration
  `20261031090000_team_notifications.sql`. 545/545 security checks (33 new),
  198 unit tests, 31/31 browser tests (new
  `tests/e2e/team-notifications.spec.ts`), lint, type check, build. Needs
  `npx.cmd supabase db push` after merging. Not included: email or chat,
  assigning to a person, deadline warnings, improvements A to E.
- Improvement A, step 1 (2026-11-05, PR #55, design
  https://claude.ai/artifact/Dipb1fRMWeAeJ5GZLBLWEe): Issues list paging (50
  per page, Previous / Next keep the filters) and a "This week" filter that
  the workspace home's card links to. No database change.
- Improvement B, step 1 (2026-11-05, design
  https://claude.ai/artifact/7WrF373QdFQeDHWczpbmjp): Google Play reviews
  connection, read-only, built and tested with the pretend Google Play only.
  Migration `20261106090000_play_connections.sql`: make a backup and run
  `npx.cmd supabase db push` BEFORE merging (the live site updates on merge).
  Real connections stay off (`BUDDY_PLAY_REAL` unset) until real data is
  approved. Not included: automatic fetching (C), replies, App Store or other
  sources, AI review matching (D).
- Improvement D, step 1 (2026-11-05, design
  https://claude.ai/artifact/Dj1NCaj39TyCDM1M6f8Gce): "Similar issues" card on
  the issue page (up to 5 look-alike issues of the same company, open or
  resolved in the last 30 days, matched by words with `pg_trgm`, no AI),
  "Same problem" links (`issues.duplicate_of`, one level deep), "Reported N
  times" on the main issue and a "+N reports" badge on the Issues list.
  Migration `20261107090000_similar_issues.sql`: backup and db push BEFORE
  merging; the pages still load without it. Not included: matching by
  meaning (AI), alerts when a problem is reported again, a recurring-themes
  report (step 2).
