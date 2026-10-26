# Buddy: Customer Service Intelligence Hub

**Status: Phases 1 to 6 complete (2026-10-25); Phase 7 (security, reliability and deployment readiness) in progress: stage 36 makes creating a company invite-only, adds an AI limit for the whole app and security headers; stage 37 adds limits on repeated actions, a Forgot password page, deleting customer data, and Delete my account.** Sign-in, company workspaces,
invitations, roles, customer issues, teams, categories, company settings and
routing rules work against a Supabase database protected by Row Level
Security, with automated tests on every change. An optional AI (Gemini or
Claude, with your own key) suggests each new issue's sentiment, type, urgency,
category and a summary; every AI value is labelled and can be changed.
Routing rules *suggest* a team (and show a conflict when rules disagree),
unless an owner switches on automatic routing. Each issue has first-response
and resolution deadlines; escalations flag issues that need attention (with
"Check now" and automatic checks every 15 minutes), and the workspace home
shows live counts. Issues are typed in by hand, imported from a CSV file, or
fetched from one connected Gmail inbox with a button. Owners and admins get
**in-app notifications** (the bell) for escalations, new urgent issues,
import problems and failed automatic checks; nothing is emailed or sent
outside Buddy. A **Reports** tab shows company-wide figures for a date range
(no figures for individual people) and downloads them as a CSV file.
It is **not production-ready** and must not hold real customer data yet.
Creating a company is **invite-only**: anyone can make an account, but only
email addresses on Buddy's own list can create a company (see
[Invite-only and app-wide limits](#invite-only-and-app-wide-limits)).

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

1. Sign up, open the confirmation email, create your company. (Your email
   must be on the list of people who may create a company: see
   [Invite-only and app-wide limits](#invite-only-and-app-wide-limits).
   If you already owned a company before stage 36, you are on it.)
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

### Try notifications and reports

1. As an owner or admin, add an issue with urgency **Critical**. The bell at
   the top shows **1**; click it to open **Notifications**, then click the
   notification to open the issue. **Mark all as read** clears the number.
   Members get no notifications.
2. Import a CSV file with a rejected row (for example `samples/test-import.csv`
   into a company that hasn't imported it yet): the bell says the import
   finished with rows that could not be saved.
3. Open **Reports**. Pick **Last 7 days**, **Last 30 days** or your own dates
   and press **Show custom range**. Every box counts only your company's
   issues, in your company's time zone. **Download CSV** saves the same
   figures as a file for Excel (widen a column if it shows `########`).
4. **Settings** > **Escalations** shows whether the automatic checks are
   running, and in red if the latest one failed.
5. **Settings** > **Scheduled jobs** (owners and admins) shows whether the
   daily clean-up ran: "Working. Last run ...", "It hasn't run yet" (it runs
   at 03:30 UTC, 09:00 India time), or a red line if the last run failed or
   it hasn't worked for more than a day.
6. Open http://localhost:3000/api/health. It should show
   `{"status":"ok","database":"ok"}`. If Supabase is unreachable (for example
   the free project was paused) it shows `"status":"error"`. Later, a free
   uptime checker can watch this address once Buddy is online.

## Invite-only and app-wide limits

Two settings protect Buddy while it is being tested (Phase 7 stage 36). Both
live in the database's private area, which the app can't reach, so only you
can change them, in the Supabase dashboard > **SQL Editor**.

**Who may create a company.** Anyone can make an account, but without an
invitation or a place on this list it can do nothing. Everyone who already
owned a company when the stage 36 migration was pushed is on the list.

```sql
-- See the list
select email, added_at from private.company_creators order by added_at;
-- Let someone create companies (use their sign-up email)
insert into private.company_creators (email) values (lower('person@example.com'));
-- Take it away again (companies they already own stay)
delete from private.company_creators where email = lower('person@example.com');
```

People invited to a company never need to be on the list.

**AI analyses for the whole app.** Each company has its own monthly limit
(Settings > AI analysis). On top of that, all companies together can use at
most **300 analyses a month** (counted from the 1st, UTC), so new sign-ups can
never spend more than you chose. When it is used up, the AI panel says so and
everything else keeps working.

```sql
-- See the limit
select ai_monthly_cap from private.platform_settings;
-- Change it (0 switches AI off for everyone)
update private.platform_settings set ai_monthly_cap = 300, updated_at = now();
```

**Buddy's web address (`BUDDY_SITE_URL`).** Sign-up emails and invitation
links point at this address. On your PC you can leave it out: Buddy uses the
address you opened it on (`http://localhost:3000`). A live server refuses to
send those links until it is set, for example
`BUDDY_SITE_URL=https://your-buddy-address`, because the address a request
claims to come from can be faked.

**AI result key (`BUDDY_AI_RESULT_KEY`).** Only Buddy's own server can
record an AI answer, so nobody can make up an "AI" result by calling the
database directly. The server proves it with a random key in `.env.local`;
the database keeps only a fingerprint (hash) of it. Without the key, or if
the two don't match, AI says it isn't set up and nothing is sent to the AI.
Set it up once:

```powershell
npm.cmd run ai-key
```

It prints a line to add to `.env.local` and one SQL line to run in the SQL
Editor, then restart `npm.cmd run dev`. From stage 37 Gmail fetching uses the same key, so only Buddy's server can open the saved Google sign-in. Never share the key, not even with
Claude. Running it again makes a new key; then do both steps again.

**Limits on repeated actions (stage 37).** So that one account can't flood
Buddy, each person can do these at most so many times in any hour. The
database counts them, so they can't be skipped:

| Action | Limit per person per hour |
|---|---|
| Send invitations | 30 |
| Imports and Gmail fetches (together) | 30 |
| Add issues by hand | 200 |
| Press "Check now" for escalations | 30 |

When someone reaches a limit, Buddy says "Too many ... in the last hour" and
the rest keeps working. Automatic jobs (the scheduled checks, AI analysis)
are not counted.

**Forgot password (stage 37).** The sign-in page has a **Forgot password?**
link. Buddy emails a reset link (through Supabase's free sender, which allows
only a few emails an hour) and always says the same thing, so nobody can use
it to find out who has an account. The link opens a page to choose a new
password. It needs the same Supabase redirect setting as sign-up
(`http://localhost:3000/**` in Authentication > URL Configuration).

**Deleting customer data (stage 37).** Only the company's **owner** can
delete, and every deletion is listed in Settings > **Customer data** >
**Deletion log** (when, who and how many issues, never the customer's name,
email or message). Deleting can't be undone.

- **One issue:** open it and use **Delete issue** at the bottom. Type the
  issue's reference (for example `ISS-1A2B3C4D`) to confirm.
- **Everything from one customer** (for example when they ask you to delete
  their data): Settings > **Customer data** > **Delete a customer's data**.
  Type their email and tick the box. It removes every issue in this company
  with that customer email, with its history, escalations and the AI's notes.
  Issues typed in without an email must be deleted one by one.
- **How long resolved issues are kept:** Settings > **Customer data**. Choose
  90 days, 180 days, 1, 2 or 5 years, or keep them. The daily clean-up
  (03:30 UTC) then deletes resolved issues older than that. Open issues are
  never deleted automatically.

The AI's monthly count doesn't go down when issues are deleted.

**Your own account (stage 37).** Click your email at the top right (or
**Account** on a phone) to open **Your account**. There you can change your
password or **Delete my account**: type your own email to confirm. Companies
you share with others keep going without you (your work stays, without your
name). A company where you are the only member is deleted with your account.
Buddy refuses while you are the only owner of a company that has other
people (make one of them an owner first), or while a company that would be
deleted still has Gmail connected (disconnect it first). To leave just one
company, use **Leave** next to your name in its **Members** list.

**Security headers.** Every page tells the browser not to let other sites
show Buddy inside a frame, not to guess file types, and to load scripts and
styles only from Buddy itself.

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

**Real customer data (decision, Phase 7 stage 37):** keep using Gemini's free
tier with made-up messages only. Before any real customer message goes to an
AI, the owner chooses one: a paid Gemini tier, the Claude API, or AI switched
off for that company. Until then, AI stays off for anything real.

1. Create a key for the service you chose. For Claude, also add a small
   prepaid credit and set a monthly spend limit under **Settings > Limits**.
2. Add it to `.env.local` on its own line, for example
   `GEMINI_API_KEY=...`, and restart `npm.cmd run dev`. Never put it in a
   `NEXT_PUBLIC_` variable, a chat or Git. Also run `npm.cmd run ai-key`
   once and follow what it prints (see
   [Invite-only and app-wide limits](#invite-only-and-app-wide-limits)).
   Settings should then say "AI service on this server: Set up: ...".
3. Settings shows "about $... at paid prices": on Gemini's free tier the real
   cost is $0.
4. In Buddy, **Settings > AI analysis**: tick the box and choose a monthly
   limit (default 500, at most 2,000). The limit for the whole app (300 a
   month, see [Invite-only and app-wide limits](#invite-only-and-app-wide-limits))
   applies on top.
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
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
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

## Backups and when something goes wrong

[docs/RUNBOOK.md](docs/RUNBOOK.md) has numbered steps for a paused Supabase
project, error pages, stopped scheduled jobs, AI or Gmail problems, a leaked
key (including changing `GMAIL_TOKEN_KEY` safely), and restoring a backup.

Free Supabase doesn't let you download its backups, so make your own copy
once a week. It needs **Docker Desktop** running (one-time setup in the
runbook):

```powershell
npm.cmd run backup
```

It saves `roles.sql`, `schema.sql` and `data.sql` into
`backups\<date>_<time>\`. Git ignores that folder. The files hold customer
data, so keep them private.

## Checks

```powershell
npm.cmd run lint        # code style and common mistakes
npx.cmd tsc --noEmit    # type errors
npm.cmd run build       # full production build
npm.cmd test            # unit tests (no setup needed)
```

GitHub runs all of these, plus the database and browser tests below and a
package security check (`npm audit`), on every pull request: the **Checks**
tick or cross on the PR page. You only need the next section if you want to
run those yourself.

### Package updates (Dependabot)

GitHub's free Dependabot checks Buddy's packages every Monday and opens a pull
request when updates are available (from the user "dependabot"). Don't merge
those yourself: ask Claude to look first, because an update can break
something even when the checks pass. If `npm audit` turns a check red, upgrade
the package it names on its own. Never run `npm.cmd audit fix --force`.

### Database and browser tests on your PC (optional)

These run against a throwaway copy of Supabase on your own computer, never
your hosted project. It runs inside **Docker Desktop** (free for personal use).

One-time setup:

```powershell
winget install Docker.DockerDesktop
```

Restart Windows, open Docker Desktop once and wait until it says it is
running. If it says **WSL is not installed**, run `wsl --install` in an
**admin** PowerShell (right-click Start, **Terminal (Admin)**), restart Windows
and open Docker Desktop again (details in `docs/RUNBOOK.md`, section 8). Then, in the `Buddy` folder:

```powershell
npx.cmd playwright install chromium
```

Each time (stop `npm.cmd run dev` first; the browser tests start their own
copy of the app on port 3100):

```powershell
npx.cmd supabase start     # first time downloads a few GB; later about 30 seconds
npm.cmd run test:db        # should end with "512 security checks passed"
npm.cmd run test:e2e       # should end with "30 passed"
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
| Fetch brought in real emails (the wrong inbox was connected) | Don't analyse them. Disconnect, then delete them: one by one with **Delete issue**, by sender with Settings > **Customer data**, or all at once in the Supabase dashboard > **SQL Editor**: run `delete from public.issues where source = 'gmail' and organization_id = (select id from public.organizations where slug = 'your-company');` (run it as `select count(*) ...` first to check the number). Connect a brand-new test Gmail instead |
| `npx.cmd supabase db push` says "Remote database is up to date" right after a stage with a new migration | The new code isn't on your PC yet: run `git pull`, check `git log -1 --oneline` names the right PR, then `db push` again |
| `supabase db push\` says `Unknown subcommand` | There's an extra character at the end of the command; type it again exactly |
| The bell never shows a number | Notifications go to owners and admins only, and only for new events after the notifications migrations were pushed |
| Onboarding says "You need an invitation" | Creating a company is invite-only. Add the email to the list (see [Invite-only and app-wide limits](#invite-only-and-app-wide-limits)), then reload the page |
| The AI panel says "Buddy has used all of this month's AI analyses" | The limit for the whole app is used up. Raise it in the SQL Editor (see [Invite-only and app-wide limits](#invite-only-and-app-wide-limits)) or wait until the 1st |
| Settings says AI is "Not set up" although your Gemini or Claude key is in `.env.local` | `BUDDY_AI_RESULT_KEY` is missing: run `npm.cmd run ai-key` and follow what it prints (see [Invite-only and app-wide limits](#invite-only-and-app-wide-limits)) |
| The AI panel says the AI result key "is not set up in the database" or "does not match" | Run the SQL line that `npm.cmd run ai-key` printed. If you ran the command twice, use the newest key **and** the newest SQL line, then restart `npm.cmd run dev` |
| Sign-up or an invitation says "Buddy's web address is not set up yet" | Only on a live server: set `BUDDY_SITE_URL` to Buddy's address and restart it |
| An action says "Too many ... in the last hour" | That person reached a limit on repeated actions (see [Invite-only and app-wide limits](#invite-only-and-app-wide-limits)). Wait a while; other actions keep working |
| No password reset email arrives | Check the spam folder. Supabase's free sender allows only a few emails per hour, so wait and try again. Buddy says the same thing whether or not the email has an account |
| The reset link opens the sign-in page or says it expired | Open the newest link, in the same browser, within an hour. Or ask for a new one with **Forgot password?** |
| There is no **Delete issue** card or **Customer data** form | Only the company's owner sees them. Admins and members can't delete |
| Delete my account says you are the only owner | Open that company, make another member an owner (Members list), then try again. Or remove the other members first |
| **Fetch new email** says it needs `BUDDY_AI_RESULT_KEY` | From stage 37 Gmail also uses Buddy's server key. Run `npm.cmd run ai-key` and follow what it prints (see [Invite-only and app-wide limits](#invite-only-and-app-wide-limits)) |
| The downloaded report shows `########` in Excel | The column is too narrow for a date: double-click the line between the column letters to widen it |
| `git pull` says your local changes to `package-lock.json` would be overwritten | `npm.cmd install` rewrote that file. Run `git checkout -- package-lock.json`, then `git pull` and `npm.cmd ci`. Use `npm.cmd ci` from then on so it doesn't happen again |

## Pages

| Route | What it is |
|---|---|
| `/` | Home: sign in, create an account, or open the demo |
| `/signup`, `/login`, `/check-email` | Account pages |
| `/account` | Your account: change password, Delete my account |
| `/forgot-password`, `/reset-password` | Ask for a password reset email; choose a new password from its link |
| `/auth/confirm` | Where the confirmation email link lands |
| `/onboarding` | Create a company workspace (you become its owner) |
| `/invite?token=...` | Accept an invitation |
| `/w/<company>` | Your real workspace: dashboard cards (urgent, due within 2 hours, targets missed, escalations, no team, waiting, this week), recent activity, members, roles, invitations |
| `/w/<company>/issues` | Customer issues: search, filters (including deadlines and escalations), add, status, assignee, team, category, history, deadlines, "Record first response", escalations with Acknowledge; AI analysis panel and "AI suggested" marks when AI is on |
| `/w/<company>/routing` | Routing rules: add, edit, reorder, switch off, delete (owners and admins); route open issues that have no team |
| `/w/<company>/data-sources` | Import a CSV file (owners and admins: match columns, preview, open or past conversations), "Analyse with AI" for an import's issues (asks first, shows the month's remaining analyses), connect or disconnect one Gmail inbox read-only (owners), "Fetch new email" (owners and admins), and every import with its counts and rejected-row reasons |
| `/w/<company>/notifications` | Your own in-app notifications for this company (owners and admins receive them): newest first, open the linked page, mark one or all as read. The bell in the header shows how many are unread |
| `/w/<company>/reports` | Company-wide figures for the last 7 days, the last 30 days or your own dates (company time zone): received, resolved, response and resolution times, response target, teams, urgency, sentiment, channel, category, escalations and imports. **Download CSV** saves them. Everyone in the company can see it; no per-person figures |
| `/w/<company>/settings` | Customer data (owners: how long resolved issues are kept, delete a customer's data, deletion log), company profile, first-response and resolution targets, AI analysis (on/off, monthly limit, automatic routing), escalation conditions with "Check now" and the automatic-check status (red when the latest one failed), scheduled jobs (owners and admins: whether the daily clean-up ran), teams, categories (owners and admins edit; automatic routing owners only) |
| `/api/health` | Health check for an uptime checker: `{"status":"ok","database":"ok"}`, or `"error"` with status 503 when the database can't be reached. No sign-in, nothing private |
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
  app/api/health/         health check for an uptime checker
  lib/notifications.ts    notification labels and links (notifications are created only by the database)
  lib/reports.ts          report date ranges and formatting; lib/report-csv.ts builds the CSV file
  lib/supabase/           Supabase clients (server, middleware)
  lib/validation.ts       input rules (zod) for everything the browser sends
  lib/site-url.ts         Buddy's own address for email and invitation links (BUDDY_SITE_URL)
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
