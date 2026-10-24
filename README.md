# Buddy: Customer Service Intelligence Hub

**Status: Phase 2 complete (2026-10-23).** Sign-in, company workspaces,
invitations, roles, customer issues, teams, categories, company settings and
routing rules work against a Supabase database protected by Row Level
Security, with automated tests on every change. Routing rules only *suggest* a
team: nothing moves an issue until a person presses a button. Issues are typed
in by hand; there is no live AI and no connection to outside services yet. It
is **not production-ready** and must not hold real customer data yet.

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
    suggest Payments". Rules are checked top to bottom and the first match
    wins; use the arrows to reorder and **Switch off** to pause one.
12. Open an issue with no team that matches the rule. Under the Handling form
    it says which rule matches; press **Apply suggestion** to give it that
    team. On the Routing page, **Route open issues that have no team** does
    the same for every open issue without a team.

When a new version adds a file to `supabase/migrations/`, apply it to your
Supabase project before trying the new features:

```powershell
npx.cmd supabase db push
```

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
npm.cmd run test:db        # should end with "144 security checks passed"
npm.cmd run test:e2e       # should end with "4 passed"
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
| `npx.cmd supabase start` says it cannot connect to Docker | Open Docker Desktop and wait until it is running |
| `git pull` says your local changes to `package-lock.json` would be overwritten | `npm.cmd install` rewrote that file. Run `git checkout -- package-lock.json`, then `git pull` and `npm.cmd install` again |

## Pages

| Route | What it is |
|---|---|
| `/` | Home: sign in, create an account, or open the demo |
| `/signup`, `/login`, `/check-email` | Account pages |
| `/auth/confirm` | Where the confirmation email link lands |
| `/onboarding` | Create a company workspace (you become its owner) |
| `/invite?token=...` | Accept an invitation |
| `/w/<company>` | Your real workspace: open issue count, members, roles, invitations |
| `/w/<company>/issues` | Customer issues: search, filters, add, status, assignee, team, category, history |
| `/w/<company>/routing` | Routing rules: add, edit, reorder, switch off, delete (owners and admins); route open issues that have no team |
| `/w/<company>/settings` | Company profile, response targets, teams, categories (owners and admins edit) |
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
  lib/supabase/           Supabase clients (server, middleware)
  lib/validation.ts       input rules (zod) for everything the browser sends
supabase/
  migrations/             database tables and security rules
  tests/                  database security tests
  templates/              email template used by the local Supabase
tests/unit/               unit tests (Vitest)
tests/e2e/                browser tests (Playwright)
scripts/test-db.mjs       runs the database security tests locally
.github/workflows/        the automatic checks GitHub runs on every PR
```

More detail: `PROJECT_CONTEXT.md`. Rules for working on the code: `CLAUDE.md`.
