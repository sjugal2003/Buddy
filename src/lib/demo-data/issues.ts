import type { Issue, IssueEvent, IssueStatus, Workspace } from "@/lib/types";
import { brightlineTemplates, cedarleafTemplates, type IssueTemplate } from "./templates";
import { teams, workspaces } from "./workspaces";

/**
 * The demo data is generated relative to this fixed moment so that it is the
 * same on every computer and every page load.
 */
export const DEMO_NOW = new Date("2026-10-20T12:00:00Z");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DAYS_OF_HISTORY = 56;

/** Small seeded random number generator so the data is repeatable. */
function createRandom(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const firstNames = [
  "Aisha", "Ben", "Chloe", "Dev", "Emma", "Farhan", "Grace", "Hiro", "Isla", "Jai",
  "Kavya", "Liam", "Maya", "Noah", "Olivia", "Pranav", "Quinn", "Riya", "Sam", "Tara",
  "Uma", "Vikram", "Wen", "Yusuf", "Zara", "Ananya", "Callum", "Deepa", "Ethan", "Fatima",
];
const lastNames = [
  "Ahmed", "Brown", "Chen", "Desai", "Evans", "Fernandes", "Gupta", "Harris", "Iqbal", "Jones",
  "Khan", "Lopez", "Mehra", "Nair", "O'Brien", "Patel", "Reddy", "Singh", "Taylor", "Wilson",
];

const agentsByTeam: Record<string, string[]> = {
  tm_bl_network: ["Priya Raman", "Daniel Cho", "Hannah Webb"],
  tm_bl_billing: ["Marcus Hale", "Ruth Adeyemi"],
  tm_bl_support: ["Elena Petrova", "Jamal Reid", "Lucy Park"],
  tm_bl_field: ["Tom Okafor", "Greg Simmons"],
  tm_bl_retention: ["Sofia Lind", "Owen Price"],
  tm_cl_fulfil: ["Arjun Mehta", "Pooja Rao", "Vivek Nair"],
  tm_cl_payments: ["Nisha Kapoor", "Imran Shaikh"],
  tm_cl_quality: ["Rahul Iyer", "Sneha Pillai"],
  tm_cl_digital: ["Meera Das", "Aditya Bose"],
  tm_cl_care: ["Kabir Sethi", "Divya Menon", "Farah Ali"],
};

function pickWeighted(templates: IssueTemplate[], random: () => number, recent: boolean) {
  const weightOf = (t: IssueTemplate) => t.weight * (recent && t.recentSpike ? 2.5 : 1);
  const total = templates.reduce((sum, t) => sum + weightOf(t), 0);
  let roll = random() * total;
  for (const t of templates) {
    roll -= weightOf(t);
    if (roll <= 0) return t;
  }
  return templates[templates.length - 1];
}

function pick<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

function generateIssues(
  workspace: Workspace,
  templates: IssueTemplate[],
  prefix: string,
  count: number,
  seed: number,
): Issue[] {
  const random = createRandom(seed);
  const issues: Issue[] = [];

  for (let i = 0; i < count; i++) {
    // Skew towards recent days so the trend charts show growing volume.
    const ageDays = Math.pow(random(), 1.35) * DAYS_OF_HISTORY;
    const recent = ageDays < 14;
    const template = pickWeighted(templates, random, recent);
    const received = new Date(DEMO_NOW.getTime() - ageDays * DAY);
    const ageHours = ageDays * 24;
    const targetHours = workspace.responseTargetsHours[template.urgency];

    // Older issues are more likely to be resolved.
    const resolveChance =
      template.intent === "praise" ? 0.95 : Math.min(0.92, 0.15 + ageDays / 20);
    const isResolved = random() < resolveChance && ageHours > 2;

    let status: IssueStatus;
    let teamId: string | null = template.teamId;
    if (isResolved) {
      status = "resolved";
    } else if (ageHours < 20 && random() < 0.6) {
      status = "new";
      if (random() < 0.4) teamId = null; // Not yet routed.
    } else if (
      (template.urgency === "critical" || template.urgency === "high") &&
      ageHours > targetHours * 6 &&
      random() < 0.55
    ) {
      status = "escalated";
    } else {
      status = pick<IssueStatus>(["open", "in_progress", "in_progress", "waiting_on_customer"], random);
    }

    const assignee =
      teamId && status !== "new" ? pick(agentsByTeam[teamId] ?? [], random) ?? null : null;

    // First response: usually inside the target, sometimes late.
    let firstResponseAt: string | null = null;
    if (status !== "new") {
      const late = random() < 0.22;
      const responseHours = late
        ? targetHours * (1.2 + random() * 2)
        : targetHours * (0.1 + random() * 0.85);
      const at = Math.min(received.getTime() + responseHours * HOUR, DEMO_NOW.getTime() - 5 * 60 * 1000);
      firstResponseAt = new Date(Math.max(at, received.getTime() + 5 * 60 * 1000)).toISOString();
    }

    let resolvedAt: string | null = null;
    if (status === "resolved") {
      const resolutionHours = Math.min(ageHours * 0.95, targetHours * (1 + random() * 8));
      resolvedAt = new Date(received.getTime() + Math.max(resolutionHours, 1) * HOUR).toISOString();
    }

    const customerName = `${pick(firstNames, random)} ${pick(lastNames, random)}`;
    const reference = `${prefix}-${String(1000 + count - i).padStart(4, "0")}`;
    const confidence = Math.round((0.72 + random() * 0.26) * 100) / 100;

    const events: IssueEvent[] = [{ at: received.toISOString(), text: "Message received" }];
    if (teamId) events.push({ at: received.toISOString(), text: `Routed to ${teamName(teamId)}` });
    if (assignee && firstResponseAt) events.push({ at: firstResponseAt, text: `${assignee} replied to the customer` });
    if (status === "escalated") events.push({ at: new Date(received.getTime() + targetHours * 6 * HOUR).toISOString(), text: "Escalated: response target missed" });
    if (resolvedAt) events.push({ at: resolvedAt, text: "Marked as resolved" });

    issues.push({
      id: `${workspace.id}_iss_${i}`,
      workspaceId: workspace.id,
      reference,
      customerName,
      channel: pick(template.channels, random),
      subject: template.subject,
      message: template.message,
      receivedAt: received.toISOString(),
      analysis: {
        sentiment: template.sentiment,
        sentimentScore: template.sentimentScore,
        intent: template.intent,
        urgency: template.urgency,
        categoryId: template.categoryId,
        themes: template.themes,
        summary: template.summary,
        suggestedAction: template.suggestedAction,
        confidence,
        source: "demo",
      },
      teamId,
      assignee,
      status,
      firstResponseAt,
      resolvedAt,
      events,
    });
  }

  issues.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  // A few of the newest messages have just arrived and are not routed yet,
  // so the routing tools have something to work on.
  for (const index of [0, 2, 5]) {
    const issue = issues[index];
    if (!issue || issue.analysis.intent === "praise") continue;
    Object.assign(issue, {
      status: "new",
      teamId: null,
      assignee: null,
      firstResponseAt: null,
      resolvedAt: null,
      events: [{ at: issue.receivedAt, text: "Message received" }],
    });
  }

  return issues;
}

function teamName(teamId: string) {
  return teams.find((t) => t.id === teamId)?.name ?? "Unknown team";
}

const [brightline, cedarleaf] = workspaces;

export const issues: Issue[] = [
  ...generateIssues(brightline, brightlineTemplates, "BRT", 120, 20261020),
  ...generateIssues(cedarleaf, cedarleafTemplates, "CDL", 110, 7714),
];
