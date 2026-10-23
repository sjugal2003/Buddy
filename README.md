# Buddy: Customer Service Intelligence Hub

**Status: Phase 1 prototype.** A frontend with fictional demo data. There is no
sign-in, no database, no live AI and no connection to any real service. It is
not production-ready and must not be used with real customer data yet.

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

Start the app (run these from the `buddy` folder):

```powershell
npm install
npm run dev
```

Open http://localhost:3000 in your browser. Press `Ctrl + C` in PowerShell to stop it.

## Checks

```powershell
npm run lint        # code style and common mistakes
npx tsc --noEmit    # type errors
npm run build       # full production build
```

## What's in Phase 1

| Page | What works | What is demo-only |
|---|---|---|
| Dashboard | Stats, sentiment trend, recurring problems, urgent list, team performance, all calculated from the demo issues | The issues are fictional |
| Issues Inbox | Search, filters, sorting, issue detail, status and team changes | Changes are saved in your browser only |
| AI Intelligence | Sentiment, intent, themes, category × urgency, churn signals | Analysis labels are hand-written, not live AI |
| Routing Rules | Create, edit, reorder, enable rules; test them; route unassigned issues | Saved in your browser only |
| Data Sources | Lists the planned sources and the permission each one needs | Nothing is connected |
| Department Reports | Per-team trends, unresolved issues, people stats, print to PDF | |
| Automation | Schedule, escalation and email notification settings, with a live "would escalate" count | Nothing is scheduled and no email is sent |
| Workspace Settings | Company profile, targets, teams, categories, reset demo data | Read-only until sign-in exists |

## Project layout

```
src/
  app/w/[workspace]/      one folder per page; the workspace is part of the URL
  components/views/       the content of each page
  components/ui/          shared building blocks (cards, badges, form controls)
  components/charts/      charts
  components/workspace/   in-browser store for the current workspace
  lib/types.ts            the shapes of all data (Issue, Team, RoutingRule, ...)
  lib/data/               the ONLY place pages get data from (swapped for the database in Phase 2)
  lib/demo-data/          fictional companies, teams and generated issues
  lib/analytics.ts        dashboard and report calculations
  lib/routing.ts          routing rule matching
```

Every record carries a `workspaceId`, so the same shapes fit a multi-company
database. The workspace switcher is **not** security: real tenant isolation
(sign-in plus database rules) is Phase 2 work.
