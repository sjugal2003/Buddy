import {
  Bot,
  Building2,
  ChartColumn,
  Database,
  GitBranch,
  Inbox,
  LayoutDashboard,
  Timer,
} from "lucide-react";

export const navItems = [
  { href: "", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Issues Inbox", icon: Inbox },
  { href: "/intelligence", label: "AI Intelligence", icon: Bot },
  { href: "/routing", label: "Routing Rules", icon: GitBranch },
  { href: "/data-sources", label: "Data Sources", icon: Database },
  { href: "/reports", label: "Department Reports", icon: ChartColumn },
  { href: "/automation", label: "Automation", icon: Timer },
  { href: "/settings", label: "Workspace Settings", icon: Building2 },
];
