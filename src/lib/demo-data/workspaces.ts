import type { Category, Team, Workspace } from "@/lib/types";

// Two fictional companies. Any resemblance to real businesses is accidental.

export const workspaces: Workspace[] = [
  {
    id: "ws_brightline",
    slug: "brightline",
    name: "Brightline Broadband",
    industry: "Internet service provider",
    timezone: "Europe/London",
    responseTargetsHours: { critical: 1, high: 4, medium: 12, low: 24 },
  },
  {
    id: "ws_cedarleaf",
    slug: "cedarleaf",
    name: "Cedarleaf Home",
    industry: "Online home goods store",
    timezone: "Asia/Kolkata",
    responseTargetsHours: { critical: 2, high: 6, medium: 24, low: 48 },
  },
];

export const teams: Team[] = [
  { id: "tm_bl_network", workspaceId: "ws_brightline", name: "Network Operations", lead: "Priya Raman", email: "netops@brightline.example", color: "#6366f1" },
  { id: "tm_bl_billing", workspaceId: "ws_brightline", name: "Billing", lead: "Marcus Hale", email: "billing@brightline.example", color: "#0ea5e9" },
  { id: "tm_bl_support", workspaceId: "ws_brightline", name: "Technical Support", lead: "Elena Petrova", email: "support@brightline.example", color: "#10b981" },
  { id: "tm_bl_field", workspaceId: "ws_brightline", name: "Field Services", lead: "Tom Okafor", email: "field@brightline.example", color: "#f59e0b" },
  { id: "tm_bl_retention", workspaceId: "ws_brightline", name: "Customer Retention", lead: "Sofia Lind", email: "retention@brightline.example", color: "#ec4899" },

  { id: "tm_cl_fulfil", workspaceId: "ws_cedarleaf", name: "Fulfilment & Delivery", lead: "Arjun Mehta", email: "fulfilment@cedarleaf.example", color: "#6366f1" },
  { id: "tm_cl_payments", workspaceId: "ws_cedarleaf", name: "Payments & Refunds", lead: "Nisha Kapoor", email: "payments@cedarleaf.example", color: "#0ea5e9" },
  { id: "tm_cl_quality", workspaceId: "ws_cedarleaf", name: "Product Quality", lead: "Rahul Iyer", email: "quality@cedarleaf.example", color: "#10b981" },
  { id: "tm_cl_digital", workspaceId: "ws_cedarleaf", name: "Web & App", lead: "Meera Das", email: "digital@cedarleaf.example", color: "#f59e0b" },
  { id: "tm_cl_care", workspaceId: "ws_cedarleaf", name: "Customer Care", lead: "Kabir Sethi", email: "care@cedarleaf.example", color: "#ec4899" },
];

export const categories: Category[] = [
  { id: "cat_bl_outage", workspaceId: "ws_brightline", name: "Outage & connectivity" },
  { id: "cat_bl_speed", workspaceId: "ws_brightline", name: "Slow speeds" },
  { id: "cat_bl_billing", workspaceId: "ws_brightline", name: "Billing & charges" },
  { id: "cat_bl_install", workspaceId: "ws_brightline", name: "Installation & appointments" },
  { id: "cat_bl_equipment", workspaceId: "ws_brightline", name: "Router & equipment" },
  { id: "cat_bl_account", workspaceId: "ws_brightline", name: "Account & login" },
  { id: "cat_bl_cancel", workspaceId: "ws_brightline", name: "Cancellation" },
  { id: "cat_bl_praise", workspaceId: "ws_brightline", name: "Praise" },

  { id: "cat_cl_delivery", workspaceId: "ws_cedarleaf", name: "Late or missing delivery" },
  { id: "cat_cl_damaged", workspaceId: "ws_cedarleaf", name: "Damaged item" },
  { id: "cat_cl_refund", workspaceId: "ws_cedarleaf", name: "Refunds" },
  { id: "cat_cl_checkout", workspaceId: "ws_cedarleaf", name: "Checkout & payment" },
  { id: "cat_cl_quality", workspaceId: "ws_cedarleaf", name: "Product quality" },
  { id: "cat_cl_order", workspaceId: "ws_cedarleaf", name: "Order changes" },
  { id: "cat_cl_bug", workspaceId: "ws_cedarleaf", name: "Website & app bugs" },
  { id: "cat_cl_praise", workspaceId: "ws_cedarleaf", name: "Praise" },
];
