// What Settings says about Buddy's daily clean-up (stage 38), judged only from
// the job history the database keeps (pg_cron), never assumed.

export const DAILY_CLEANUP_JOB = "buddy-daily-cleanup";

/** A day plus a little slack: a run older than this means a missed day. */
export const DAILY_CLEANUP_STALE_HOURS = 26;

export interface ScheduledJob {
  name: string;
  schedule: string;
  active: boolean;
  lastRunAt: string | null;
  /** pg_cron's own words: starting, running, sending, connecting, succeeded or failed. */
  lastStatus: string | null;
}

export interface JobStatus {
  failing: boolean;
  text: string;
}

/**
 * `jobs` is null when the status could not be read at all. `formatTime`
 * shows a time in the company's time zone.
 */
export function dailyCleanupStatus(
  jobs: ScheduledJob[] | null,
  now: Date,
  formatTime: (iso: string) => string,
): JobStatus {
  if (!jobs) return { failing: true, text: "Couldn't check right now. Try again later." };
  const job = jobs.find((j) => j.name === DAILY_CLEANUP_JOB);
  if (!job) return { failing: true, text: "Not set up in this database. Run the database update (db push)." };
  if (!job.active) return { failing: true, text: "Switched off in this database." };
  if (!job.lastRunAt || !job.lastStatus) {
    return { failing: false, text: "Set up to run every day at 03:30 UTC. It hasn't run yet." };
  }
  const when = formatTime(job.lastRunAt);
  if (job.lastStatus === "failed") return { failing: true, text: `The last run failed (${when}).` };
  if (job.lastStatus !== "succeeded") return { failing: false, text: `Running now (started ${when}).` };
  const hours = (now.getTime() - new Date(job.lastRunAt).getTime()) / 3_600_000;
  if (hours > DAILY_CLEANUP_STALE_HOURS) {
    return {
      failing: true,
      text: `Last worked ${when}, more than a day ago, so it may have stopped (for example while Supabase had the project paused).`,
    };
  }
  return { failing: false, text: `Working. Last run ${when}.` };
}
