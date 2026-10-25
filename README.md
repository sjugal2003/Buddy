# Buddy: Customer Service Intelligence Hub

**Status: Phase 4 complete; Phase 5 (data sources) in progress (2026-10-24).** Sign-in, company workspaces,
invitations, roles, customer issues, teams, categories, company settings and
routing rules work against a Supabase database protected by Row Level
Security, with automated tests on every change. An optional AI (Gemini or
Claude, with your own key) suggests each new issue's sentiment, type, urgency,
category and a summary; every AI value is labelled and can be changed.
Routing rules *suggest* a team (and show a conflict when rules disagree),
unless an owner switches on automatic routing. Each issue has first-response
and resolution deadlines; escalations flag issues that need attention (with
"Check now" and automatic checks every 15 minutes), and the workspace home
shows live counts. Escalations only appear in Buddy: no email or chat
messages are sent yet. Issues are typed in by hand (with an optional customer email); owners and admins can import customer messages from a CSV file on the Data sources tab, which also shows every import. There is no connection to outside services yet.
It is **not production-ready** and must not hold real customer data yet.

## Run it on Windows

You need **Node.js 22** (20.19 or newer also works) and **Git**. In PowerShell:

```powershell
node -v
git --version
```

If either is missing:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Then close and reopen PowerShell.

Get the code and start the app. PowerShell may block `npm`, so use `npm.cmd`
and `npx.cmd`:

```powershell
git clone https://github.com/sjugal2003/Buddy.git
cd Buddy
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3000. Press `Ctrl + C` in PowerShell to stop it.

To get the latest changes later, stop the app and run:

```powershell
cd D:\Buddy
git pull
npm.cmd ci
npx.cmd supabase db push
npm.cmd run dev
```

Use `npm.cmd ci`, not `npm.cmd install`, after a pull. `ci` installs exactly
what `package-lock.json` lists and never rewrites that file, so the next
`git pull` won't be blocked. (`db push` is only needed once Supabase is
connected; it says "up to date" when there is nothing new.)

Without Supabase settings the app runs in **demo mode only**: the home page
says so, and the fictional companies are at `/demo/brightline` and
`/demo/cedarleaf`.

## Connect Supabase (sign-in and real workspaces)

Do this once. Use a **development** project only.

1. **Create a project** at supabase.com (Free plan is enough). Save the database
   password in a password manager. Never paste it into a chat.
2. **Local settings file.** In the `Buddy` folder:

   ```powershell
   copy .env.example .env.local
   notepad .env.local
   ```

   Fill in the project URL (Project Settings > Data API) and the publishable key
   (Project Settings > API Keys, starts with `sb_publishable_`). Never use the
   secret key (`sb_secret_...`) here.

   | Variable | Browser-safe? |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Yes |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes (the database rules decide what it can do) |
   | secret key | **Never** used by this app |

3. **Create the tables and security rules**:

   ```powershell
   npx.cmd supabase login
   npx.cmd supabase link --project-ref <project-ref>
   npx.cmd supabase db push
   ```

   `<project-ref>` is the part of your project URL before `.supabase.co`.
   `link` asks for the database password. `db push` lists the migrations and
   asks you to confirm.

4. **Sign-in settings** in the Supabase dashboard:
   - Authentication > URL Configuration: **Site URL** `http://localhost:3000`,
     and add `http://localhost:3000/**` under **Redirect URLs**.
   - Leave the **Confirm signup** email template as it is. (Supabase only lets
     you edit it after setting up your own email server, and Buddy works with
     the default one.) Open the confirmation link in the **same browser** you
     signed up in. If you open it elsewhere, your email is still confirmed:
     just sign in.
   - Authentication > Sign In / Providers > Email: keep **Confirm email** on.
     Invitations rely on confirmed email addresses.

5. Restart `npm.cmd run dev`, open http://localhost:3000, and choose
   **Create an account**.

Supabase's built-in email sender is for testing and sends only a few emails
per hour.

## Try it

1. Sign up, open the confirmation email, create your company.
2. Under **Invite a colleague**, create a link for a second email address you own.
   Buddy does not send emails yet, so copy the link yourself.
3. In a private browser window, sign up with that second address, confirm it,
   then open the invite link and accept.
4. As the owner, change the second person's role to Admin. They now see the
   invite form too.
5. Try opening a company you don't belong to: you get "Page not found".
6. Open **Issues** > **New issue**, fill it in and save. Change its status
   and who it's assigned to: each change appears under **History**.
7. Use the search box and filters on the Issues page. Resolved issues are
   hidden unless you pick **All statuses** or **Resolved**.
8. Copy the issue's address. In a private window, sign in as someone who is
   **not** a member of your company and open it: you get "Page not found".
9. Open **Settings**: change the response targets, add teams (for example
   Payments, Support) and categories (for example Billing). Members see this
   page read-only.
10. Give an issue a team and category. The Issues page can filter by team.
11. Open **Routing** and add a rule, for example "If Category is Billing,
    suggest Payments". Every rule is checked; if two matching rules name
    different teams, the issue shows a conflict and a person chooses. Use the
    arrows to reorder and **Switch off** to pause one.
12. Open an issue with no team that matches the rule. Under the Handling form
    it says which rule matches and why; press **Apply suggestion** to give it
    that team, or **Dismiss suggestion** to hide it. On the Routing page,
    **Route open issues that have no team** does the same for every open
    issue without a team, skipping conflicts and dismissed suggestions.

### Try the data sources

Use made-up customers only until Phase 7.

1. Open **Data sources** > **Import a CSV file** and choose
   `samples/test-import.csv` from the Buddy folder. The preview flags rows 5
   and 6; keep **Open issues** and press **Import**. Expected: 3 imported,
   1 already in Buddy (row 7 repeats ticket T-101), 2 rejected with reasons.
   Import the same file again: 0 imported, 4 already in Buddy.
2. With AI on (see below), press **Analyse with AI** on that import. It shows
   how many analyses it will use and how many are left this month before
   anything is sent.
3. With Gmail set up (see "Gmail inbox" below) and a **brand-new test Gmail**
   connected, send it two or three made-up emails from another account, then
   press **Fetch new email**: each becomes an issue. Press it again: "No new
   email since the last fetch."
4. Sign in as a member: they see the import history and which inbox is
   connected, but no import, fetch or connect buttons.

## AI analysis (optional)

Buddy can ask an AI to fill in each new issue's sentiment, type, urgency,
category, a short summary and a next step. It works with either of two
services; you only need one key. Without a key everything else works as
before.

| | Gemini 3.5 Flash-Lite (Google) | Claude Haiku 5.5 (Anthropic) |
|---|---|---|
| Key goes in `.env.local` as | `GEMINI_API_KEY=...` | `ANTHROPIC_API_KEY=...` |
| Get a key at | aistudio.google.com > **Get API key** | console.anthropic.com > **Settings > API Keys** |
| Cost | Free tier within Google's limits; paid tier about $1 per 1,000 messages | About 25 cents per 1,000 messages (prepaid credit) |
| Privacy | On the free tier Google may use what is sent to improve its products | Not used for training by default |

If both keys are set, Claude is used.

1. Create a key for the service you chose. For Claude, also add a small
   prepaid credit and set a monthly spend limit under **Settings > Limits**.
2. Add it to `.env.local` on its own line, for example
   `GEMINI_API_KEY=...`, and restart `npm.cmd run dev`. Never put it in a
   `NEXT_PUBLIC_` variable, a chat or Git. Settings should then say
   "AI service on this server: Set up: ...".
3. Settings shows "about $... at paid prices": on Gemini's free tier the real
   cost is $0.
4. In Buddy, **Settings > AI analysis**: tick the box and choose a monthly
   limit (default 500, at most 2,000).
5. Add an issue and leave urgency, sentiment and type on **Let AI decide**.
   After saving, the **AI analysis** panel fills in within a few seconds.
   Anything you chose yourself is kept; the panel offers **Accept** for the
   AI's view instead. **Analyse again** can be used once every 30 seconds.
6. The **Issues** list marks analysed issues "AI suggested" and shows the
   AI's one-line summary. Routing rules use the AI's urgency, type and
   category like any other value.
7. Optional, owners only: tick **Apply routing automatically** in the same
   card. Then a newly analysed issue that has no team goes straight to the
   team its matching routing rules name (the history shows the move). If
   the rules disagree, it is left for a person.
   Left off, rules only suggest a team and a person presses the button.

What is sent to the AI service: the subject, the message (first 4,000
characters), the channel and your category names. Never the customer's name.
Use made-up messages until Phase 7. If the key ever leaks, delete it in the
Console and create a new one.

When a new version adds a file to `supabase/migrations/`, apply it to your
Supabase project before trying the new features:

```powershell
npx.cmd supabase db push
```

## Gmail inbox (optional)

An owner can connect one Gmail inbox per company, **read-only**: Buddy asks
Google only for `gmail.readonly`, so it can read messages but can never send,
delete or change email. Owners and admins then press **Fetch new email** to
add new emails as issues. Google's setup is free. Use a **test Gmail account with
made-up emails** until Phase 7.

**1. Create a Google Cloud project** (about 15 minutes, once)

1. Open https://console.cloud.google.com and sign in with your Google account.
2. At the top, click the project picker, then **New project**. Name it
   `Buddy dev` and click **Create**. Make sure it is selected at the top.
3. Menu (three lines, top left) > **APIs & Services** > **Library**. Search
   for **Gmail API**, open it and click **Enable**.
4. Menu > **Google Auth platform** > **Branding**. If it says "not configured
   yet", click **Get started**:
   - App name `Buddy dev`, user support email: your email. **Next**.
   - Audience: **External**. **Next**.
   - Contact information: your email. **Next**.
   - Tick the agreement, **Continue**, **Create**.
5. **Audience** (left menu): leave the publishing status as **Testing**. Under
   **Test users**, click **Add users**, type the Gmail address you will
   connect, and **Save**. Only test users can connect while it is in Testing.
6. **Data Access** > **Add or remove scopes**. Search `gmail.readonly`, tick
   `.../auth/gmail.readonly`, click **Update**, then **Save**.
7. **Clients** > **Create client**. Application type **Web application**,
   name `Buddy local`. Under **Authorized redirect URIs** click **Add URI**
   and paste exactly `http://localhost:3000/api/gmail/callback`. Click
   **Create**.
8. A box shows the **Client ID** and **Client secret**. Keep it open for the
   next step (you can see them again under Clients).

**2. Add three lines to `.env.local`** (in `D:\Buddy`, with Notepad)

```
GOOGLE_CLIENT_ID=paste-the-client-id
GOOGLE_CLIENT_SECRET=paste-the-client-secret
GMAIL_TOKEN_KEY=paste-the-key-from-the-command-below
```

Make the `GMAIL_TOKEN_KEY` value on your own PC with this PowerShell command
and paste what it prints (it encrypts the Gmail sign-in before it is saved):

```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Never put these in a `NEXT_PUBLIC_` variable, a chat or Git. If you change
`GMAIL_TOKEN_KEY` later, connect Gmail again. Restart `npm.cmd run dev`.

**3. Connect**

In Buddy, **Data sources** > **Gmail inbox** > **Connect Gmail**. Google
shows a warning that the app is not verified (normal in Testing mode): click
**Continue**, tick the box to allow reading email, and continue. You come back
to Buddy with "Gmail connected: your-address". **Disconnect Gmail** asks
Google to cancel Buddy's access and removes the connection; issues already in
Buddy stay.

**4. Fetch**

Owners and admins press **Fetch new email** on Data sources. Buddy reads the
inbox's new emails since the last fetch (the first time, the last 7 days), up
to 50 at a time, leaving out emails sent from the inbox itself, and adds each
as an open issue: sender's name and email, subject, text and received time.
The same email is never added twice. If more are waiting, it says so: press
again. Nothing in Gmail changes (not even "read"). Each fetch shows in the
import history, and "Analyse with AI" asks first, as for CSV imports.

In Testing mode Google ends the sign-in after **7 days**; then connect again.
You can also remove Buddy any time at https://myaccount.google.com/permissions.

## Checks

```powershell
npm.cmd run lint        # code style and common mistakes
npx.cmd tsc --noEmit    # type errors
npm.cmd run build       # full production build
npm.cmd test            # unit tests (no setup needed)
```

GitHub runs all of these, plus the database and browser tests below, on
every pull request: the **Checks** tick or cross on the PR page. You only need
the next section if you want to run those yourself.

### Database and browser tests on your PC (optional)

These run against a throwaway copy of Supabase on your own computer, never
your hosted project. It runs inside **Docker Desktop** (free for personal use).

One-time setup:

```powershell
winget install Docker.DockerDesktop
```

Restart Windows, open Docker Desktop once and wait until it says it is
running. Then, in the `Buddy` folder:

```powershell
npx.cmd playwright install chromium
```

Each time (stop `npm.cmd run dev` first; the browser tests start their own
copy of the app on port 3100):

```powershell
npx.cmd supabase start     # first time downloads a few GB; later about 30 seconds
npm.cmd run test:db        # should end with "426 security checks passed"
npm.cmd run test:e2e       # should end with "20 passed"
npx.cmd supabase stop
```

If a browser test fails, `npx.cmd playwright show-report` opens a page showing
which step failed, with a screenshot.

## Troubleshooting

| What you see | What to do |
|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled` | Use `npm.cmd` / `npx.cmd` instead of `npm` / `npx` |
| Sign-up says "We couldn't create your account" and the PowerShell window shows `Invalid path specified` | `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` should be just `https://<project-ref>.supabase.co` (Buddy now ignores anything after it, but check for typos) |
| The confirmation link says it expired or is invalid | Open it in the same browser you signed up in, or just sign in: your email is confirmed anyway |
| No confirmation email arrives | Supabase's free sender allows only a few emails per hour. Wait, then try again |
| A new feature says a column or permission is missing | Run `npx.cmd supabase db push` to apply new migrations |
| The home page says "Sign-in is not set up on this computer yet" | `.env.local` is missing or misnamed; it must be in the `Buddy` folder itself |
| `Port 3000 is in use, trying 3001` | Another `npm.cmd run dev` is still running; close it, because sign-in links only return to port 3000 |
| `npm.cmd install` lists vulnerabilities | Tell Claude; never run `npm audit fix --force` (it breaks the lint tools) |
| Settings says "AI service on this server: Not set up" | `GEMINI_API_KEY` (or `ANTHROPIC_API_KEY`) is missing from `.env.local`, or `npm.cmd run dev` wasn't restarted after adding it |
| The AI panel says the key was not accepted | Check the key in `.env.local`: no spaces or quotes around it, and the right name |
| The AI panel says Gemini's limit was reached | The free tier allows only a few requests per minute and per day; wait and press **Analyse again** |
| The AI panel says the account has no credit (Claude) | Check the credit and spend limit at console.anthropic.com |
| `npx.cmd supabase start` says it cannot connect to Docker | Open Docker Desktop and wait until it is running |
| Google Cloud asks for a card or a free trial | Not needed for Buddy: dismiss it and open console.cloud.google.com/projectcreate directly. The Gmail API and sign-in client are free |
| Google says "Access blocked: Buddy dev has not completed the Google verification process" | The Gmail address isn't a test user: Google Auth platform > **Audience** > **Test users** > **Add users** |
| Google says `redirect_uri_mismatch` | The client's redirect URI must be exactly `http://localhost:3000/api/gmail/callback` (no extra slash or space) |
| Data sources says Gmail is not set up | One of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_TOKEN_KEY` is missing from `.env.local`, or `npm.cmd run dev` wasn't restarted |
| Fetch says Google's sign-in has ended | Normal after 7 days in Testing mode: **Disconnect Gmail**, then **Connect Gmail** again |
| Fetch brought in real emails (the wrong inbox was connected) | Don't analyse them. Disconnect, then delete them: Supabase dashboard > **SQL Editor**, run `delete from public.issues where source = 'gmail' and organization_id = (select id from public.organizations where slug = 'your-company');` (run it as `select count(*) ...` first to check the number). Connect a brand-new test Gmail instead |
| `git pull` says your local changes to `package-lock.json` would be overwritten | `npm.cmd install` rewrote that file. Run `git checkout -- package-lock.json`, then `git pull` and `npm.cmd ci`. Use `npm.cmd ci` from then on so it doesn't happen again |

## Pages

| Route | What it is |
|---|---|
| `/` | Home: sign in, create an account, or open the demo |
| `/signup`, `/login`, `/check-email` | Account pages |
| `/auth/confirm` | Where the confirmation email link lands |
| `/onboarding` | Create a company workspace (you become its owner) |
| `/invite?token=...` | Accept an invitation |
| `/w/<company>` | Your real workspace: dashboard cards (urgent, due within 2 hours, targets missed, escalations, no team, waiting, this week), recent activity, members, roles, invitations |
| `/w/<company>/issues` | Customer issues: search, filters (including deadlines and escalations), add, status, assignee, team, category, history, deadlines, "Record first response", escalations with Acknowledge; AI analysis panel and "AI suggested" marks when AI is on |
| `/w/<company>/routing` | Routing rules: add, edit, reorder, switch off, delete (owners and admins); route open issues that have no team |
| `/w/<company>/data-sources` | Import a CSV file (owners and admins: match columns, preview, open or past conversations), "Analyse with AI" for an import's issues (asks first, shows the month's remaining analyses), connect or disconnect one Gmail inbox read-only (owners), "Fetch new email" (owners and admins), and every import with its counts and rejected-row reasons |
| `/w/<company>/settings` | Company profile, first-response and resolution targets, AI analysis (on/off, monthly limit, automatic routing), escalation conditions with "Check now" and the automatic-check status, teams, categories (owners and admins edit; automatic routing owners only) |
| `/demo/<company>/...` | The Phase 1 demo with fictional data (dashboard, inbox, intelligence, routing, data sources, reports, automation, settings) |

## Project layout

```
src/
  app/demo/[workspace]/   demo pages (fictional data, no sign-in)
  app/w/[workspace]/      real workspaces (sign-in and membership required)
  app/actions/            server actions: every change goes through here
  components/             views, UI building blocks, auth and org forms
  lib/data/index.ts       demo data access
  lib/data/live.ts        database reads, always as the signed-in user
  lib/ai/                 AI analysis (server only): Gemini, Claude, test analyser
  lib/csv-import.ts       reading and checking CSV files (runs in the browser)
  lib/gmail/              Gmail sign-in, token encryption and fetching (server only)
  app/api/gmail/          the Connect Gmail redirect and Google's return address
  lib/supabase/           Supabase clients (server, middleware)
  lib/validation.ts       input rules (zod) for everything the browser sends
supabase/
  migrations/             database tables and security rules
  tests/                  database security tests
  templates/              email template used by the local Supabase
tests/unit/               unit tests (Vitest)
tests/e2e/                browser tests (Playwright)
samples/test-import.csv   made-up CSV for trying the import
scripts/test-db.mjs       runs the database security tests locally
.github/workflows/        the automatic checks GitHub runs on every PR
```

More detail: `PROJECT_CONTEXT.md`. Rules for working on the code: `CLAUDE.md`.
