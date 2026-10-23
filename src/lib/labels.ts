import type { Channel, Intent, IssueStatus, Sentiment, Urgency } from "@/lib/types";

export const sentimentLabels: Record<Sentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  very_negative: "Very negative",
};

export const sentimentColors: Record<Sentiment, string> = {
  positive: "#10b981",
  neutral: "#94a3b8",
  negative: "#f59e0b",
  very_negative: "#ef4444",
};

export const intentLabels: Record<Intent, string> = {
  complaint: "Complaint",
  question: "Question",
  request: "Request",
  bug_report: "Bug report",
  cancellation: "Cancellation",
  praise: "Praise",
};

export const urgencyLabels: Record<Urgency, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const urgencyOrder: Urgency[] = ["critical", "high", "medium", "low"];

export const statusLabels: Record<IssueStatus, string> = {
  new: "New",
  open: "Open",
  in_progress: "In progress",
  waiting_on_customer: "Waiting on customer",
  escalated: "Escalated",
  resolved: "Resolved",
};

export const statusOrder: IssueStatus[] = [
  "new",
  "open",
  "in_progress",
  "waiting_on_customer",
  "escalated",
  "resolved",
];

export const channelLabels: Record<Channel, string> = {
  email: "Email",
  live_chat: "Live chat",
  app_review: "App review",
  survey: "Survey",
  social: "Social",
  phone_transcript: "Phone transcript",
};
