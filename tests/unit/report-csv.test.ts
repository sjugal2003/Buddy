import { describe, expect, it } from "vitest";
import { csvCell, reportFileName, reportToCsv } from "@/lib/report-csv";
import type { IssueReport } from "@/lib/reports";

const report: IssueReport = {
  timezone: "Asia/Kolkata",
  from: "2025-01-01",
  to: "2025-01-31",
  totals: { received: 5, history: 1, still_open: 2 },
  resolved: 3,
  first_response: { count: 2, median_seconds: 11_700, average_seconds: 11_700 },
  resolution: { count: 2, median_seconds: 8_100, average_seconds: null },
  response_target: { met: 1, late: 1, missed: 1, not_due: 0, resolved_without_response: 1 },
  escalations: [{ condition: "first_response_breached", count: 1, acknowledged: 0 }],
  teams: [
    { name: "=HYPERLINK(\"http://x\")", received: 3, still_open: 1, median_response_seconds: 1_800, median_resolution_seconds: null },
    { name: null, received: 2, still_open: 1, median_response_seconds: null, median_resolution_seconds: null },
  ],
  categories: [{ name: "Billing, refunds", count: 5 }],
  channels: [{ key: "email", count: 3 }],
  urgency: [
    { key: "low", count: 1 },
    { key: "critical", count: 4 },
  ],
  sentiment: [{ key: "neutral", count: 5 }],
  imports: [{ source: "gmail", runs: 2, failed: 1, imported: 38, skipped_duplicate: 0, rejected: 0 }],
};

const lines = () => reportToCsv(report, { companyName: "Acme \"Support\"", generatedAt: "31 Jan, 18:00 (Asia/Kolkata)" }).split("\r\n");

describe("csvCell", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("stops spreadsheets running typed-in text as a formula", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+44 team")).toBe("'+44 team");
    expect(csvCell("-x")).toBe("'-x");
    expect(csvCell("@sum")).toBe("'@sum");
  });

  it("writes numbers as they are and nothing for missing values", () => {
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });
});

describe("reportToCsv", () => {
  it("starts with a byte-order mark and a header row, and uses Windows line ends", () => {
    const csv = reportToCsv(report, { companyName: "Acme", generatedAt: "now" });
    expect(csv.startsWith("﻿Section,Item,Value")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("writes the range, totals and times in minutes", () => {
    const l = lines();
    expect(l).toContain('Report,Company,"Acme ""Support"""');
    expect(l).toContain("Report,From,2025-01-01");
    expect(l).toContain("Report,Time zone,Asia/Kolkata");
    expect(l).toContain("Totals,Issues received,5");
    expect(l).toContain("Totals,Issues resolved in this period,3");
    expect(l).toContain("Times (minutes),First response: median,195");
    expect(l).toContain("Times (minutes),Resolution: median,135");
    expect(l).toContain("Times (minutes),Resolution: average,");
    expect(l).toContain("Response target,Share met (%),33.3");
  });

  it("writes teams safely, breakdowns in order, escalations and imports", () => {
    const l = lines();
    expect(l).toContain(`Teams,"'=HYPERLINK(""http://x"")",3,1,30,`);
    expect(l).toContain("Teams,No team,2,1,,");
    expect(l.indexOf("By urgency,Critical,4")).toBeLessThan(l.indexOf("By urgency,Low,1"));
    expect(l).toContain('By category,"Billing, refunds",5');
    expect(l).toContain("By channel,Email,3");
    expect(l).toContain("Escalations,First-response target breached,1,0");
    expect(l).toContain("Imports,Gmail fetch,2,1,38,0,0");
  });

  it("has no column for individual people", () => {
    expect(lines().join("\n")).not.toMatch(/assignee|agent|employee/i);
  });
});

describe("reportFileName", () => {
  it("names the company and range", () => {
    expect(reportFileName("acme", "2025-01-01", "2025-01-31")).toBe("buddy-report-acme-2025-01-01-to-2025-01-31.csv");
  });
});

describe("reportToCsv: repeated problems", () => {
  it("lists repeated problems, with subjects made safe", () => {
    const csv = reportToCsv(
      { ...report, repeated: [{ id: "x", reference: "ISS-1", subject: "=Payment, failed", status: "new", in_period: 3, total: 4 }] },
      { companyName: "Acme", generatedAt: "now" },
    ).split("\r\n");
    expect(csv).toContain("Repeated problems,Issue,Subject,Reports in this period,Reports in total");
    expect(csv).toContain(`Repeated problems,ISS-1,"'=Payment, failed",3,4`);
  });

  it("leaves the section out when the database doesn't send it yet", () => {
    expect(lines().some((line) => line.startsWith("Repeated problems"))).toBe(false);
  });
});
