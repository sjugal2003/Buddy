import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getIssueReport, getMembershipBySlug } from "@/lib/data/live";
import { formatDateTimeIn } from "@/lib/format";
import { reportFileName, reportToCsv } from "@/lib/report-csv";
import { resolveReportRange, todayIn } from "@/lib/reports";

// "Download CSV" on the Reports page: the same figures for the same range, as
// a file. Counted through the signed-in person's own session, so it only
// works for members of the company, like the page.

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace: slug } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/w/${slug}/reports`)}`, request.url));
  // A company they don't belong to gives the same "not found" as one that doesn't exist.
  const membership = await getMembershipBySlug(user.id, slug);
  if (!membership) return new NextResponse("Not found", { status: 404 });

  const { organization } = membership;
  const now = new Date();
  const range = resolveReportRange(Object.fromEntries(request.nextUrl.searchParams), todayIn(now, organization.timezone));
  // An unusable range is not quietly swapped for another one in a downloaded file.
  if (range.error) return new NextResponse(range.error, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const result = await getIssueReport(organization.id, range.from, range.to);
  if ("error" in result) {
    return new NextResponse(result.error, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const csv = reportToCsv(result.report, {
    companyName: organization.name,
    generatedAt: formatDateTimeIn(now, organization.timezone),
  });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportFileName(organization.slug, range.from, range.to)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
