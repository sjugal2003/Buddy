"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  AutomationSettings,
  Category,
  Issue,
  IssueStatus,
  RoutingRule,
  Team,
  Workspace,
} from "@/lib/types";

/**
 * Holds one workspace's demo data in the browser.
 *
 * Phase 1 has no database, so changes (status updates, routing rules,
 * automation settings) are saved to this browser's localStorage only. They
 * are not shared with anyone and can be reset at any time. In Phase 2 these
 * updates will be sent to the server instead.
 */

type IssuePatch = Partial<Pick<Issue, "status" | "teamId" | "assignee" | "resolvedAt" | "events">>;

interface SavedChanges {
  issuePatches: Record<string, IssuePatch>;
  rules?: RoutingRule[];
  automation?: AutomationSettings;
}

interface WorkspaceData {
  workspace: Workspace;
  workspaces: Workspace[];
  teams: Team[];
  categories: Category[];
  issues: Issue[];
  rules: RoutingRule[];
  automation: AutomationSettings;
  now: Date;
}

interface WorkspaceStore extends WorkspaceData {
  hasLocalChanges: boolean;
  setIssueStatus: (issueId: string, status: IssueStatus) => void;
  assignIssue: (issueId: string, teamId: string | null) => void;
  setRules: (rules: RoutingRule[]) => void;
  setAutomation: (automation: AutomationSettings) => void;
  resetDemoData: () => void;
  teamName: (teamId: string | null) => string;
  categoryName: (categoryId: string) => string;
}

const StoreContext = createContext<WorkspaceStore | null>(null);

const storageKey = (workspaceId: string) => `buddy-demo:${workspaceId}`;

function readSaved(workspaceId: string): SavedChanges {
  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (raw) return JSON.parse(raw) as SavedChanges;
  } catch {
    // Storage can be unavailable (private browsing) or hold bad data; start fresh.
  }
  return { issuePatches: {} };
}

function writeSaved(workspaceId: string, saved: SavedChanges) {
  try {
    window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(saved));
  } catch {
    // Ignore: changes simply won't survive a page reload.
  }
}

export function WorkspaceProvider({
  initial,
  nowIso,
  children,
}: {
  initial: Omit<WorkspaceData, "now">;
  nowIso: string;
  children: React.ReactNode;
}) {
  const workspaceId = initial.workspace.id;
  const [saved, setSaved] = useState<SavedChanges>({ issuePatches: {} });
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  // Load saved changes after the first render so server and browser HTML match.
  useEffect(() => {
    setSaved(readSaved(workspaceId));
  }, [workspaceId]);

  const update = useCallback(
    (change: (current: SavedChanges) => SavedChanges) => {
      setSaved((current) => {
        const next = change(current);
        writeSaved(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  const issues = useMemo(
    () => initial.issues.map((issue) => ({ ...issue, ...saved.issuePatches[issue.id] })),
    [initial.issues, saved.issuePatches],
  );

  const teamName = useCallback(
    (teamId: string | null) => initial.teams.find((t) => t.id === teamId)?.name ?? "Unassigned",
    [initial.teams],
  );
  const categoryName = useCallback(
    (categoryId: string) => initial.categories.find((c) => c.id === categoryId)?.name ?? "Uncategorised",
    [initial.categories],
  );

  const patchIssue = useCallback(
    (issueId: string, makePatch: (issue: Issue) => IssuePatch) => {
      const issue = issues.find((i) => i.id === issueId);
      if (!issue) return;
      const patch = makePatch(issue);
      update((current) => ({
        ...current,
        issuePatches: { ...current.issuePatches, [issueId]: { ...current.issuePatches[issueId], ...patch } },
      }));
    },
    [issues, update],
  );

  const value: WorkspaceStore = {
    ...initial,
    now,
    issues,
    rules: saved.rules ?? initial.rules,
    automation: saved.automation ?? initial.automation,
    hasLocalChanges:
      Object.keys(saved.issuePatches).length > 0 || saved.rules !== undefined || saved.automation !== undefined,
    teamName,
    categoryName,
    setIssueStatus: (issueId, status) =>
      patchIssue(issueId, (issue) => ({
        status,
        resolvedAt: status === "resolved" ? new Date().toISOString() : null,
        events: [...issue.events, { at: new Date().toISOString(), text: `Status changed to "${status.replaceAll("_", " ")}" (demo change, saved in this browser)` }],
      })),
    assignIssue: (issueId, teamId) =>
      patchIssue(issueId, (issue) => ({
        teamId,
        assignee: null,
        events: [...issue.events, { at: new Date().toISOString(), text: `Reassigned to ${teamName(teamId)} (demo change, saved in this browser)` }],
      })),
    setRules: (rules) => update((current) => ({ ...current, rules })),
    setAutomation: (automation) => update((current) => ({ ...current, automation })),
    resetDemoData: () => update(() => ({ issuePatches: {} })),
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useWorkspace() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return store;
}
