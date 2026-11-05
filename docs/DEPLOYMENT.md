# Putting Buddy online: the deployment guide

Written in Phase 7 stage 39. **Nothing in this guide has been done yet.**
Putting Buddy on the internet is Gate 1 and needs the owner's explicit go,
together with the stage 40 decisions listed below. Until then Buddy runs only on
your own PC (`npm.cmd run dev`) against the hosted Supabase project.

Commands are for PowerShell, run in `D:\Buddy`. Never paste a key, password or
connection string into a chat, an email or GitHub, not even to Claude.

Contents:

1. [Before going online: decisions for stage 40](#1-before-going-online-decisions-for-stage-40)
2. [The settings a live server needs](#2-the-settings-a-live-server-needs)
3. [Hosting on Vercel Hobby (free)](#3-hosting-on-vercel-hobby-free)
4. [Supabase settings on launch day](#4-supabase-settings-on-launch-day)
5. [Google Cloud settings on launch day (Gmail)](#5-google-cloud-settings-on-launch-day-gmail)
6. [Checks right after going online](#6-checks-right-after-going-online)
7. [If something goes wrong after launch](#7-if-something-goes-wrong-after-launch)
8. [Your Supabase settings: the checklist to do now](#8-your-supabase-settings-the-checklist-to-do-now)

---

## 1. Before going online: decisions for stage 40

These are open on purpose. Each one is the owner's call, made at stage 40:

| Decision | Why it matters |
|---|---|
| Gate 1: go online at all, and where | This guide assumes Vercel Hobby (free) for a **private test**. Vercel's free plan is for non-commercial use; a paying launch needs another plan. |
| F2: which AI may see real customer messages | Gemini's free tier may use what it is sent to improve Google's products, so it is for made-up messages only. Options: a paid AI plan, Claude, or AI switched off for real data. |
| Real customer data (Gate 3) | Needs the privacy notice and terms (F22) first, and the deletion tools from stage 37 (already built). |
| Separate production Supabase project? | Today's hosted project holds test data. A clean project for real customers is safer: `db push`, then the `ai-key` hash and the list of who may create companies, as in the README. |
| Emails | Supabase's built-in sender is for testing and sends only a few emails per hour. Real sign-ups need your own email sender (SMTP) set in Supabase. |
| Gmail for other companies (F25) | Gmail's read-only access is a "restricted" Google permission. Outside companies need Google's verification, which can cost money. Keep Gmail test-only until decided. |

---

## 2. The settings a live server needs

Check them on your PC with `npm.cmd run check-env` (it never shows values).
To check them **as a live server would**, put the planned address in for one
PowerShell session and add `-- --live`:

```powershell
$env:BUDDY_SITE_URL = "https://your-buddy-address.example"
```

```powershell
npm.cmd run check-env -- --live
```

It must end with `No problems found.` (Closing PowerShell forgets the
address again.)

| Setting | Secret? | Needed? | Where the value comes from |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | No (browser-safe) | Yes | Supabase > Project Settings > Data API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | No (browser-safe; the database rules decide what it can do) | Yes | Supabase > Project Settings > API Keys, starts with `sb_publishable_` |
| `BUDDY_SITE_URL` | No | Yes on a live server | Buddy's live address, `https://...`, no slash at the end. Sign-up emails, invitations and Gmail all use it. Without it Buddy refuses to send those links. |
| `BUDDY_AI_RESULT_KEY` | **Yes** | For AI and Gmail fetching | `npm.cmd run ai-key` (make a new one for production and run its SQL line in that Supabase project) |
| `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | **Yes** | For AI | Your AI provider (decision F2 above) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **Yes** | For Gmail | Google Cloud > APIs & Services > Credentials |
| `GMAIL_TOKEN_KEY` | **Yes** | For Gmail and Google Play | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Changing it later means connecting Gmail and Google Play again. |
| `BUDDY_PLAY_REAL` | No | **Not yet** | `on` lets owners connect a real Google Play app, which brings in real customer reviews. Leave it unset until real data is approved (Gate 3). |

Never add on a live server:

- **Any other `NEXT_PUBLIC_` setting.** That prefix sends the value to every
  visitor's browser. Secret settings must never have it.
- **The Supabase secret key** (`sb_secret_...`) or a `service_role` key.
  Buddy never uses one. `check-env` refuses both.
- **`BUDDY_AI_MODE`, `BUDDY_GMAIL_MODE` or `BUDDY_PLAY_MODE`.** They are for
  automated tests only. Since stage 39 a live server ignores them anyway (AI,
  Gmail and Google Play then show as not set up or switched off), and
  `check-env -- --live` refuses them.

---

## 3. Hosting on Vercel Hobby (free)

**Only after the Gate 1 go.** Vercel builds Buddy from GitHub; nothing on your
PC changes.

1. Sign in at vercel.com with GitHub (Hobby plan, no card needed) and choose
   **Add New > Project**. Pick the `sjugal2003/Buddy` repository.
2. Leave the framework (Next.js), build command and output folder as Vercel
   suggests. The Node version comes from `package.json` (24.x).
3. Before the first deploy, open **Environment Variables** and add each setting
   from section 2 for the **Production** environment only. Paste values
   straight from your password manager or `.env.local`; never type them into
   a chat.
4. In **Settings > Functions**, pick the region closest to your Supabase
   project's region (Supabase > Project Settings > General), so each page
   doesn't wait on a long round trip.
5. Deploy. Vercel gives an address like `https://buddy-xxxx.vercel.app`. That
   address is your `BUDDY_SITE_URL`: set it in Environment Variables if you
   used a placeholder, then **Redeploy** so Buddy picks it up.
6. Always open Buddy at that one address. The Gmail sign-in comes back to
   `BUDDY_SITE_URL`, so starting it from a different Vercel address fails with
   "took too long or was started in another browser".

Good to know:

- The daily clean-up and the 15-minute deadline checks run **inside Supabase**
  (pg_cron), not on Vercel. Nothing needs setting up on Vercel for them.
- An AI analysis can take up to 30 seconds. If analyses on Vercel stop with a
  time-out, check the function time limit in Vercel's settings for your plan.
- Vercel also builds a preview for every pull request. Those previews get only
  the settings you added for **Preview**. Leave that empty, so previews can't
  reach your data.

---

## 4. Supabase settings on launch day

In the Supabase dashboard of the project the live Buddy uses:

1. **Authentication > URL Configuration**
   - **Site URL**: the live address, for example `https://buddy-xxxx.vercel.app`.
   - **Redirect URLs**: add `https://buddy-xxxx.vercel.app/**`. Keep
     `http://localhost:3000/**` only if you still run Buddy on your PC against
     this same project.
2. **Authentication > Sign In / Providers > Email**: **Confirm email** on
   (invitations trust confirmed addresses), and **Minimum password length 8**,
   the same as Buddy's own forms (section 8 does this now).
3. **Emails**: set up your own email sender if the stage 40 decision says so
   (Authentication > Emails > SMTP Settings).
4. Make a backup first (`npm.cmd run backup`, docs/RUNBOOK.md section 8).

---

## 5. Google Cloud settings on launch day (Gmail)

Only if Gmail is used on the live server. These are OAuth changes (Gate 4), so
only with the owner's go.

1. Google Cloud console > **APIs & Services > Credentials** > your OAuth client.
2. Under **Authorized redirect URIs**, add
   `https://buddy-xxxx.vercel.app/api/gmail/callback` (your live address plus
   `/api/gmail/callback`, exactly). Keep
   `http://localhost:3000/api/gmail/callback` for your PC.
3. Save. Google can take a few minutes to accept the new address.
4. While the app's publishing status is **Testing**, only the test users listed
   on the OAuth consent screen can connect, and Google ends the sign-in after
   7 days. That is fine for a private test.

---

## 6. Checks right after going online

1. Open `https://buddy-xxxx.vercel.app/api/health`. Expected:
   `{"status":"ok","database":"ok"}`.
2. Create a test account with a made-up name and your own email. The
   confirmation link must open the **live** address, not localhost.
3. In your workspace: Settings shows **Scheduled jobs: Working**; AI shows the
   provider you chose (or "not set up" if AI is off).
4. Optional and free: point an uptime checker (for example UptimeRobot's free
   plan) at `/api/health`, so you hear when Buddy is down.

---

## 7. If something goes wrong after launch

- **The new version is broken**: in Vercel, open **Deployments**, pick the last
  one that worked, and choose **Promote to Production** (or **Instant
  Rollback**). The database is not changed by this.
- **A setting was wrong**: fix it in Environment Variables, then **Redeploy**.
  If a secret was exposed, follow docs/RUNBOOK.md section 7.
- **The database**: docs/RUNBOOK.md sections 2 to 9 apply to the live server
  too; read "http://localhost:3000" there as your live address.

---

## 8. Your Supabase settings: the checklist to do now

This is safe to do today. Four things to look at, one to change. Send Claude
what each screen **says** (words or a screenshot); none of it is secret, but
don't include keys or passwords.

Open https://supabase.com/dashboard and click your Buddy project.

1. **Plan**: left sidebar, bottom > **Project Settings** > **Billing** (or the
   organisation's **Billing** page). Note the plan name (for example "Free").
2. **Confirm email**: **Authentication** > **Sign In / Providers** > **Email**.
   Note whether **Confirm email** is on. It should be on.
3. **Site URL and Redirect URLs**: **Authentication** > **URL Configuration**.
   Note both values. Today they should be `http://localhost:3000` and
   `http://localhost:3000/**`.
4. **Google sign-in status**: in the Google Cloud console > **APIs & Services**
   > **OAuth consent screen** (or **Audience**), note the **Publishing status**
   (probably **Testing**). Change nothing there.
5. **The one change, minimum password length**: back in Supabase,
   **Authentication** > **Sign In / Providers** > **Email**. Find **Minimum
   password length**, set it to `8`, and click **Save**. This only affects
   new passwords; existing accounts keep working. If you can't find the
   setting, send a screenshot of that page instead.
