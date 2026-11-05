// Core domain types for Buddy.
// Every tenant-owned record carries a workspaceId so the same shapes can be
// stored in a multi-tenant database in Phase 2.

export type Channel =
  | "email"
  | "live_chat"
  | "app_review"
  | "survey"
  | "social"
  | "phone_transcript";

export type Sentiment = "positive" | "neutral" | "negative" | "very_negative";

export type Intent =
  | "complaint"
  | "question"
  | "request"
  | "bug_report"
  | "cancellation"
  | "praise";

export type Urgency = "low" | "medium" | "high" | "critical";

/** Where an issue came from: typed in, a CSV import, or a Gmail fetch. */
export type IssueSource = "manual" | "csv" | "gmail" | "google_play";

export type IssueStatus =
  | "new"
  | "open"
  | "in_progress"
  | "waiting_on_customer"
  | "escalated"
  | "resolved";

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  industry: string;
  timezone: string;
  /** Hours within which a first response is expected, per urgency. */
  responseTargetsHours: Record<Urgency, number>;
}

export interface Team {
  id: string;
  workspaceId: string;
  name: string;
  lead: string;
  /** Fictional address shown in the UI only. Nothing is ever sent to it. */
  email: string;
  color: string;
}

export interface Category {
  id: string;
  workspaceId: string;
  name: string;
}

/** Output of message analysis. In Phase 1 this is pre-written demo content. */
export interface IssueAnalysis {
  sentiment: Sentiment;
  /** -1 (very negative) to 1 (very positive). */
  sentimentScore: number;
  intent: Intent;
  urgency: Urgency;
  categoryId: string;
  themes: string[];
  summary: string;
  suggestedAction: string;
  /** 0 to 1. */
  confidence: number;
  source: "demo";
}

export interface IssueEvent {
  at: string;
  text: string;
}

export interface Issue {
  id: string;
  workspaceId: string;
  reference: string;
  customerName: string;
  channel: Channel;
  subject: string;
  message: string;
  receivedAt: string;
  analysis: IssueAnalysis;
  teamId: string | null;
  assignee: string | null;
  status: IssueStatus;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  events: IssueEvent[];
}

export type RuleField =
  | "category"
  | "urgency"
  | "sentiment"
  | "intent"
  | "channel"
  | "keyword";

export interface RuleCondition {
  field: RuleField;
  /** For "keyword" this is matched case-insensitively against subject and message. */
  value: string;
}

export interface RoutingRule {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  match: "all" | "any";
  conditions: RuleCondition[];
  teamId: string;
}

export type DataSourceKind =
  | "email_inbox"
  | "helpdesk"
  | "live_chat"
  | "app_store"
  | "review_site"
  | "survey"
  | "social"
  | "csv_upload";

export interface DataSourceDefinition {
  kind: DataSourceKind;
  name: string;
  description: string;
  examples: string;
  authorization: string;
  plannedPhase: number;
}

export interface EscalationRule {
  id: string;
  name: string;
  enabled: boolean;
  urgency: Urgency;
  /** Escalate when unresolved for longer than this many hours. */
  afterHours: number;
  escalateTo: string;
}

export interface NotificationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "new_critical" | "escalated" | "daily_digest" | "weekly_report";
  channel: "email";
  recipients: string;
}

export interface AutomationSettings {
  workspaceId: string;
  analysisSchedule: "every_15_min" | "hourly" | "every_6_hours" | "daily";
  escalationRules: EscalationRule[];
  notificationRules: NotificationRule[];
}
