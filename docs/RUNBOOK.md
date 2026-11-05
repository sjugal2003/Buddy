# Buddy runbook: what to do when something goes wrong

Plain steps for the owner, written for Buddy on your own Windows PC with a
hosted Supabase project (Phase 7 stage 38). Commands are for PowerShell, run in
`D:\Buddy`. Type each command exactly, with nothing extra at the end.

Two rules for every situation here:

- **Never paste a key, password or connection string into a chat**, an email
  or GitHub, not even to Claude. Say which step you're on and what Buddy
  showed instead.
- **Write down what happened and when** (a screenshot is fine). It helps work
  out what went wrong.

Contents:

1. [First check: is Buddy up?](#1-first-check-is-buddy-up)
2. [Supabase paused the project](#2-supabase-paused-the-project)
3. [Buddy shows an error page or a save fails](#3-buddy-shows-an-error-page-or-a-save-fails)
4. [The daily clean-up or the 15-minute checks stopped](#4-the-daily-clean-up-or-the-15-minute-checks-stopped)
5. [AI analysis stops working](#5-ai-analysis-stops-working)
6. [Gmail stops connecting or fetching](#6-gmail-stops-connecting-or-fetching)
7. [A key or password might have leaked](#7-a-key-or-password-might-have-leaked)
8. [Backups](#8-backups)
9. [Restore the database from a backup](#9-restore-the-database-from-a-backup)

---

## 1. First check: is Buddy up?

1. Make sure Buddy is running (`npm.cmd run dev` in a PowerShell window).
2. Open http://localhost:3000/api/health in your browser.
   - `{"status":"ok","database":"ok"}` means Buddy and the database both
     answer. Go to the section that matches what you saw.
   - `{"status":"error","database":"unreachable"}` means Buddy can't reach
     Supabase. Go to [section 2](#2-supabase-paused-the-project).
   - The page doesn't load at all means Buddy itself isn't running. Look at
     the PowerShell window for a red error, then start it again with
     `npm.cmd run dev`.

## 2. Supabase paused the project

Free Supabase projects pause after about **7 days with nobody using them**.
Nothing is lost; the project just sleeps. While paused, Buddy can't sign
anyone in and the scheduled jobs don't run.

1. Go to https://supabase.com/dashboard and sign in.
2. Click your Buddy project. A paused project says **Paused** and shows a
   **Restore project** button.
3. Click **Restore project** and wait (it can take a few minutes).
4. Open http://localhost:3000/api/health again. It should say `"ok"`.
5. Open **Settings** in Buddy. Under **Escalations**, "Automatic checks"
   should say "Running every 15 minutes" within about 15 minutes. Under
   **Scheduled jobs**, the daily clean-up catches up at the next 03:30 UTC
   (09:00 India time).

To keep it from pausing, use Buddy (or open the Supabase dashboard) at least
once a week. Something that keeps it awake automatically is a decision for
launch (stage 40).

## 3. Buddy shows an error page or a save fails

Buddy never shows a "Saved" message unless the save really worked, so a red
message means nothing was changed.

1. Read the message on the page. Many explain themselves, for example a
   limit reached ("Too many ... in the last hour") or a
   missing permission.
2. Look at the PowerShell window running `npm.cmd run dev`. Server problems
   appear there as one line like `[listIssues] 42501 permission denied ...`:
   the part in brackets says where, then a code and a short reason. These
   lines never contain customers' names, emails or messages, so you can show
   them to Claude.
3. If it says something is missing from `.env.local`, open `.env.local` in
   Notepad and check the line exists (don't share its value). Then stop Buddy
   with **Ctrl + C** and start it again with `npm.cmd run dev`.
4. If it started after you pulled new code, run these one at a time:

   ```powershell
   git pull
   ```

   ```powershell
   npm.cmd ci
   ```

   ```powershell
   npx.cmd supabase db push
   ```

   Then start Buddy again. A page that fails because a database change
   wasn't pushed yet usually works after `db push`.

## 4. The daily clean-up or the 15-minute checks stopped

Buddy's scheduled jobs run inside the database (pg_cron, free):
`buddy-escalation-check` every 15 minutes and `buddy-daily-cleanup` at 03:30
UTC.

1. Open Buddy > **Settings**.
   - **Escalations > Automatic checks** shows the 15-minute checks.
   - **Scheduled jobs > Daily clean-up** shows the daily job. Red text
     means its last run failed or it hasn't worked for more than a day.
2. If the project was paused, restore it ([section 2](#2-supabase-paused-the-project)).
   The jobs start again by themselves.
3. To see the job history yourself: Supabase dashboard > **SQL Editor** >
   **New query**, paste this and click **Run** (it only reads):

   ```sql
   select j.jobname, d.status, d.start_time, left(d.return_message, 200) as message
   from cron.job_run_details d join cron.job j using (jobid)
   order by d.start_time desc limit 20;
   ```

   Send Claude a screenshot of the result.
4. If Settings says a job is **not set up**, run
   `npx.cmd supabase db push`. If that says everything is up to date, tell
   Claude: the job can be set up again with one SQL command from the
   migration that created it.

## 5. AI analysis stops working

1. Open **Settings > AI analysis**.
   - "Analyses this month: N of N" means this company's monthly limit is
     used up. An owner can raise it there.
   - The AI panel on an issue saying the app-wide limit is used up means all
     companies together reached the shared limit (300 a month). See
     "Invite-only and app-wide limits" in the README.
   - "AI service on this server: Not set up" means `GEMINI_API_KEY` (or
     `ANTHROPIC_API_KEY`) or `BUDDY_AI_RESULT_KEY` is missing from
     `.env.local`, or Buddy wasn't restarted after adding it.
2. If the PowerShell window shows `[gemini] 429`, Google's free quota is used
   up for now. Wait (the free tier resets daily) and try again later.
3. If it says `BUDDY_AI_RESULT_KEY` does not match, the key in `.env.local` and
   the one set up in the database are different. Make a new one with
   [section 7](#buddy_ai_result_key).

Everything else in Buddy keeps working without AI.

## 6. Gmail stops connecting or fetching

1. Open **Data sources**. The Gmail card says what went wrong in plain words.
2. **"Google's sign-in for this inbox has ended"**: while your Google
   Cloud project is in **Testing** mode, Google ends Buddy's access after
   **7 days**. That's expected. An owner clicks **Disconnect**, then
   **Connect Gmail** again. (Publishing the Google project removes the 7-day
   limit but needs Google's review. That's a launch decision.)
3. **"... BUDDY_AI_RESULT_KEY is missing or does not match ..."**: fix the key as in [section 5](#5-ai-analysis-stops-working),
   step 3.
4. **"Buddy can't read the saved Google sign-in"**: `GMAIL_TOKEN_KEY` in
   `.env.local` changed since Gmail was connected. Put the old value back, or
   disconnect and connect again.
5. **"Gmail could not be reached"**: wait a few minutes and press **Fetch new email**
   again. Nothing is lost; the next fetch carries on from where the last one
   stopped.

### Google Play reviews stop fetching

The Google Play card on **Data sources** says what went wrong:

- **"switched off on this server"**: expected until real data is approved
  (`BUDDY_PLAY_REAL` isn't `on`).
- **"Google didn't accept this service account key"**: the key was deleted
  in Google Cloud. Make a new JSON key, then **Disconnect** and **Connect
  Google Play** again.
- **"Google Play refused access"**: the service account lost its access in
  Play Console (Users and permissions). Give it **View app information** for
  the app again.
- **"Buddy can't read the saved key"**: `GMAIL_TOKEN_KEY` changed. Put the old
  value back, or disconnect and connect again.
- **"... BUDDY_AI_RESULT_KEY is missing or does not match ..."**: as for Gmail,
  step 3 above.

## 7. A key or password might have leaked

If a key appeared somewhere it shouldn't (a chat, a screenshot, GitHub, an
email), change it. Do them in this order, and only the ones that leaked.
After changing anything in `.env.local`, stop Buddy (**Ctrl + C**) and start
it again with `npm.cmd run dev`.

**Supabase database password** (used by `db push` and backups)

1. Supabase dashboard > your project > **Project Settings** > **Database** >
   **Reset database password**. Save the new one in your password manager.
2. The next `npx.cmd supabase db push` or `npm.cmd run backup` asks for the
   new password.

**Supabase publishable key** (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)

This one is public on purpose: every visitor's browser gets it, and the
database's access rules protect the data. Nothing to do.

**Supabase secret (service role) key**

Buddy never uses it and it should never be in `.env.local`. If it leaked
anyway: Supabase dashboard > **Project Settings** > **API Keys**, create a new
secret key and delete the old one.

**`GEMINI_API_KEY`**

1. Go to https://aistudio.google.com/apikey, delete the leaked key and create
   a new one.
2. Replace the value in `.env.local` and restart Buddy.

**`ANTHROPIC_API_KEY`** (only if you use Claude)

1. Go to https://console.anthropic.com/settings/keys, disable or delete the
   leaked key and create a new one.
2. Replace the value in `.env.local` and restart Buddy.

<a id="buddy_ai_result_key"></a>**`BUDDY_AI_RESULT_KEY`**

1. Run:

   ```powershell
   npm.cmd run ai-key
   ```

2. Follow the three steps it prints: the new line goes in `.env.local`, the
   `update ...` line goes in the Supabase **SQL Editor** (it holds only a
   fingerprint of the key, not the key), then restart Buddy.
3. Until both are done, AI and Gmail fetching say the key doesn't match.
   Nothing else is affected.

**`GMAIL_TOKEN_KEY`** (encrypts the saved Gmail sign-in and Google Play key)

Changing it makes the saved Gmail sign-in and Google Play key unreadable, so
do it in this order (if Google Play is connected, also click **Disconnect
Google Play** in step 1 and connect it again in step 4 with a new JSON key):

1. In Buddy, as owner, open **Data sources** and click **Disconnect** on the
   Gmail card. (This also cancels Buddy's access at Google.) Do this in every
   company that has Gmail connected.
2. Make a new key:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

3. Replace the `GMAIL_TOKEN_KEY` value in `.env.local` with what it printed
   and restart Buddy.
4. Click **Connect Gmail** again.
5. If the old key leaked together with the database, also open
   https://myaccount.google.com/permissions with the test Gmail account and
   remove Buddy's access there.

**`GOOGLE_CLIENT_SECRET`**

1. Google Cloud console > your Buddy project > **Google Auth Platform** >
   **Clients** > `Buddy local` > **Add secret**, then delete the old secret.
2. Replace the value in `.env.local` and restart Buddy. Gmail stays
   connected.

**Your own Buddy or Supabase account password**

Change it (Buddy: click your email at the top, then **Change your password**; Supabase and GitHub in their
own settings), and turn on two-step sign-in for Supabase, GitHub and Google
if it isn't on already.

## 8. Backups

Free Supabase doesn't let you download its own backups, so Buddy has a
command that saves your own copy.

**One-time setup: Docker Desktop** (free for personal use; Supabase's backup
tool runs inside it)

1. Install it:

   ```powershell
   winget install Docker.DockerDesktop
   ```

2. Restart Windows.
3. Open **Docker Desktop** from the Start menu, accept the terms, skip the
   sign-in, and wait until the bottom left says **Engine running**.
4. If Docker says **WSL is not installed** (or needs an update), Windows is
   missing the small Linux layer Docker runs on. Right-click the Start button,
   choose **Terminal (Admin)** or **Windows PowerShell (Admin)**, click
   **Yes**, and run:

   ```powershell
   wsl --install
   ```

   Restart Windows when it finishes. If a window then asks for a Linux user
   name and password, pick any (they're only for that Linux layer, not
   Buddy). Open Docker Desktop again and wait for **Engine running**. If WSL
   was already installed, `wsl --update` is enough.

**Make a backup** (once a week while Buddy has only made-up data)

1. Open Docker Desktop and wait for **Engine running**.
2. In PowerShell:

   ```powershell
   cd D:\Buddy
   ```

   ```powershell
   npm.cmd run backup
   ```

3. If it asks for the database password, type it (nothing shows while you
   type) and press Enter. The first time, Docker downloads a tool, which takes
   a few minutes.
4. It ends with `Backup finished: D:\Buddy\backups\<date>_<time>`. That folder
   holds `roles.sql`, `schema.sql`, `data.sql` and a `README.txt`.

**Keep backups safe**

- The `backups` folder is never uploaded to GitHub (Git ignores it).
- The files contain everyone's issues and sign-in details (passwords are
  stored only as scrambled hashes) and the encrypted Gmail sign-in. Treat
  them like the data itself: don't email them or put them anywhere public.
- Keep the last four, and copy the newest one to a second place you control
  (for example a USB drive), so one broken disk doesn't lose everything.

## 9. Restore the database from a backup

Use this only if the hosted database is lost or broken, ideally with Claude
helping. Restoring into a project that already has data mixes the two, so
restore into a **new, empty** Supabase project.

This was rehearsed on a local test database on 2026-10-26: every company,
issue, history line, sign-in and the Gmail connection came back, and a
restored user could sign in.

1. Supabase dashboard > **New project** (free). Choose the same region as
   before and save its database password.
2. Point Buddy's folder at the new project and create the tables (its
   reference is in the dashboard address, after `/project/`):

   ```powershell
   npx.cmd supabase link --project-ref <new-project-ref>
   ```

   ```powershell
   npx.cmd supabase db push
   ```

3. In the dashboard, click **Connect** at the top and copy the **Session
   pooler** connection string. Replace `[YOUR-PASSWORD]` in it with the new
   project's database password. Keep it to yourself.
4. With Docker Desktop running, load the data. Replace the folder name with
   your backup's, and paste the connection string between the quotes:

   ```powershell
   docker run --rm -i -v "D:\Buddy\backups\2026-11-02_0930:/backup" postgres:17 psql "PASTE-CONNECTION-STRING" -v ON_ERROR_STOP=1 --single-transaction -c "set session_replication_role = replica" -c "delete from private.platform_settings" -f /backup/data.sql
   ```

   Lines like `SET`, `DELETE 1`, `COPY 12` and `setval` mean it worked. An
   `ERROR` line means nothing was loaded (it's all or nothing). Send Claude
   the error line, without the connection string.
5. Update `.env.local` with the new project's address and publishable key
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) and
   restart Buddy. Keep `BUDDY_AI_RESULT_KEY` and `GMAIL_TOKEN_KEY` as they
   were: the restored data still matches them.
6. In the new project, set **Authentication > URL Configuration** the same as
   the old one (Site URL `http://localhost:3000`, and the redirect URLs from
   the README).
7. Open http://localhost:3000/api/health, sign in, and check that your
   companies and issues are there. Settings > **Scheduled jobs** should show
   the daily clean-up as set up.
