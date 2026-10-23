import type { AutomationSettings, DataSourceDefinition, RoutingRule } from "@/lib/types";

export const routingRules: RoutingRule[] = [
  { id: "rr_bl_1", workspaceId: "ws_brightline", name: "Cancellations go to Retention", enabled: true, match: "any", conditions: [{ field: "intent", value: "cancellation" }, { field: "keyword", value: "cancel" }], teamId: "tm_bl_retention" },
  { id: "rr_bl_2", workspaceId: "ws_brightline", name: "Outages to Network Operations", enabled: true, match: "any", conditions: [{ field: "category", value: "cat_bl_outage" }, { field: "keyword", value: "outage" }], teamId: "tm_bl_network" },
  { id: "rr_bl_3", workspaceId: "ws_brightline", name: "Billing questions and disputes", enabled: true, match: "any", conditions: [{ field: "category", value: "cat_bl_billing" }, { field: "keyword", value: "refund" }], teamId: "tm_bl_billing" },
  { id: "rr_bl_4", workspaceId: "ws_brightline", name: "Appointments to Field Services", enabled: true, match: "all", conditions: [{ field: "category", value: "cat_bl_install" }], teamId: "tm_bl_field" },
  { id: "rr_bl_5", workspaceId: "ws_brightline", name: "Everything technical", enabled: true, match: "any", conditions: [{ field: "category", value: "cat_bl_speed" }, { field: "category", value: "cat_bl_equipment" }, { field: "category", value: "cat_bl_account" }], teamId: "tm_bl_support" },

  { id: "rr_cl_1", workspaceId: "ws_cedarleaf", name: "Critical payment problems", enabled: true, match: "all", conditions: [{ field: "category", value: "cat_cl_checkout" }, { field: "urgency", value: "critical" }], teamId: "tm_cl_payments" },
  { id: "rr_cl_2", workspaceId: "ws_cedarleaf", name: "Refunds to Payments", enabled: true, match: "any", conditions: [{ field: "category", value: "cat_cl_refund" }, { field: "keyword", value: "refund" }], teamId: "tm_cl_payments" },
  { id: "rr_cl_3", workspaceId: "ws_cedarleaf", name: "Delivery problems", enabled: true, match: "any", conditions: [{ field: "category", value: "cat_cl_delivery" }, { field: "keyword", value: "tracking" }], teamId: "tm_cl_fulfil" },
  { id: "rr_cl_4", workspaceId: "ws_cedarleaf", name: "Damage and quality", enabled: true, match: "any", conditions: [{ field: "category", value: "cat_cl_damaged" }, { field: "category", value: "cat_cl_quality" }], teamId: "tm_cl_quality" },
  { id: "rr_cl_5", workspaceId: "ws_cedarleaf", name: "App and website bugs", enabled: true, match: "any", conditions: [{ field: "category", value: "cat_cl_bug" }, { field: "channel", value: "app_review" }], teamId: "tm_cl_digital" },
  { id: "rr_cl_6", workspaceId: "ws_cedarleaf", name: "Order changes to Customer Care", enabled: false, match: "all", conditions: [{ field: "category", value: "cat_cl_order" }], teamId: "tm_cl_care" },
];

/** The kinds of sources Buddy plans to support. None are connected in Phase 1. */
export const dataSourceCatalog: DataSourceDefinition[] = [
  { kind: "csv_upload", name: "CSV / spreadsheet import", description: "Upload a file of customer messages you already have.", examples: "Exports from any support tool", authorization: "You upload your own file. No outside access needed.", plannedPhase: 5 },
  { kind: "email_inbox", name: "Support email inbox", description: "Read messages sent to a shared support address.", examples: "Gmail, Microsoft 365", authorization: "An administrator signs in and grants read access to one mailbox (OAuth).", plannedPhase: 5 },
  { kind: "helpdesk", name: "Helpdesk tickets", description: "Import tickets from your helpdesk.", examples: "Zendesk, Freshdesk, Intercom", authorization: "An administrator of your helpdesk account creates an API connection for your company only.", plannedPhase: 5 },
  { kind: "live_chat", name: "Live chat transcripts", description: "Analyse completed chat conversations.", examples: "Intercom, LiveChat", authorization: "Connection approved by your chat tool's administrator.", plannedPhase: 5 },
  { kind: "app_store", name: "App store reviews", description: "Reviews of your own mobile apps.", examples: "Google Play Console, App Store Connect", authorization: "Requires developer-account access to apps your company publishes.", plannedPhase: 5 },
  { kind: "review_site", name: "Public review sites", description: "Reviews of your business on review platforms.", examples: "Platforms with an official business API", authorization: "Only through the platform's official API and your verified business account. Buddy will not scrape sites.", plannedPhase: 5 },
  { kind: "survey", name: "Surveys (CSAT / NPS)", description: "Free-text answers from your customer surveys.", examples: "Typeform, Google Forms export", authorization: "Connection or export from your own survey account.", plannedPhase: 5 },
  { kind: "social", name: "Social media mentions", description: "Messages and mentions on your company's own accounts.", examples: "Platforms with an official business API", authorization: "Your company admin connects your own business account. Availability depends on each platform's API terms.", plannedPhase: 5 },
];

export const automationSettings: AutomationSettings[] = [
  {
    workspaceId: "ws_brightline",
    analysisSchedule: "every_15_min",
    escalationRules: [
      { id: "esc_bl_1", name: "Critical issues unanswered", enabled: true, urgency: "critical", afterHours: 1, escalateTo: "Head of Network Operations" },
      { id: "esc_bl_2", name: "High urgency open too long", enabled: true, urgency: "high", afterHours: 24, escalateTo: "Customer Service Manager" },
      { id: "esc_bl_3", name: "Medium urgency stale", enabled: false, urgency: "medium", afterHours: 72, escalateTo: "Team lead" },
    ],
    notificationRules: [
      { id: "ntf_bl_1", name: "Alert on new critical issue", enabled: true, trigger: "new_critical", channel: "email", recipients: "oncall@brightline.example" },
      { id: "ntf_bl_2", name: "Escalation alerts", enabled: true, trigger: "escalated", channel: "email", recipients: "cs-managers@brightline.example" },
      { id: "ntf_bl_3", name: "Weekly management report", enabled: true, trigger: "weekly_report", channel: "email", recipients: "leadership@brightline.example" },
    ],
  },
  {
    workspaceId: "ws_cedarleaf",
    analysisSchedule: "hourly",
    escalationRules: [
      { id: "esc_cl_1", name: "Payment problems unanswered", enabled: true, urgency: "critical", afterHours: 2, escalateTo: "Payments lead" },
      { id: "esc_cl_2", name: "High urgency open too long", enabled: true, urgency: "high", afterHours: 48, escalateTo: "Head of Customer Care" },
    ],
    notificationRules: [
      { id: "ntf_cl_1", name: "Alert on new critical issue", enabled: true, trigger: "new_critical", channel: "email", recipients: "payments@cedarleaf.example" },
      { id: "ntf_cl_2", name: "Daily digest", enabled: true, trigger: "daily_digest", channel: "email", recipients: "care@cedarleaf.example" },
      { id: "ntf_cl_3", name: "Weekly management report", enabled: false, trigger: "weekly_report", channel: "email", recipients: "founders@cedarleaf.example" },
    ],
  },
];
