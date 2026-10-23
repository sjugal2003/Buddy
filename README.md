# Buddy: Customer Service Intelligence Hub

**Status: Phase 2 in progress.** Sign-in, company workspaces, invitations,
roles and customer issues work against a Supabase database protected by Row
Level Security. Teams, routing rules and settings still live only in the demo
(they move to the database in the next stage). There is no live AI and no connection to outside
services. It is **not production-ready** and must not hold real customer data yet.

## Run it on Windows

You need **Node.js 20 or newer** and **Git**. In PowerShell:

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

## Checks

```powershell
npm.cmd run lint        # code style and common mistakes
npx.cmd tsc --noEmit    # type errors
npm.cmd run build       # full production build
```

Database security tests: `supabase/tests/security_test.sql` (96 checks). See
`PROJECT_CONTEXT.md` for how to run them.

## Pages

| Route | What it is |
|---|---|
| `/` | Home: sign in, create an account, or open the demo |
| `/signup`, `/login`, `/check-email` | Account pages |
| `/auth/confirm` | Where the confirmation email link lands |
| `/onboarding` | Create a company workspace (you become its owner) |
| `/invite?token=...` | Accept an invitation |
| `/w/<company>` | Your real workspace: open issue count, members, roles, invitations |
| `/w/<company>/issues` | Customer issues: search, filters, add, status, assignee, history |
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
  templates/              email templates
```

More detail: `PROJECT_CONTEXT.md`. Rules for working on the code: `CLAUDE.md`.
