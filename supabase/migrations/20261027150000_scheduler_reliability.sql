-- Phase 6 stage 31: making the scheduler's problems visible, and tidying up.
--
-- * A scheduled escalation check that fails notifies the company's owners and
--   admins (at most once a day per company, so a check failing every 15
--   minutes does not fill the bell).
-- * One daily pg_cron job (free, built into Supabase) closes imports left
--   "running" for over an hour (which notifies, like any failed import),
--   deletes read notifications older than 90 days, and deletes escalation
--   check logs older than 90 days. Unread notifications are never deleted.
-- Settings shows whether the latest automatic check failed and when one last
-- succeeded. The 15-minute job from Phase 4 is unchanged.

-- ---------------------------------------------------------------------------
-- Failed scheduled checks
-- ---------------------------------------------------------------------------

create function private.notify_scheduler_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'scheduled' and new.error is not null and old.error is null then
    perform private.notify_staff(new.organization_id, 'scheduler_failed',
      'The automatic escalation check failed. See Settings for the reason.',
      'scheduler_failed:' || to_char(new.started_at at time zone 'UTC', 'YYYY-MM-DD'));
  end if;
  return null;
end;
$$;

revoke all on function private.notify_scheduler_failure() from public, anon, authenticated;

create trigger escalation_runs_notify_failure
  after update of error on public.escalation_runs
  for each row execute function private.notify_scheduler_failure();

-- ---------------------------------------------------------------------------
-- Daily clean-up
-- ---------------------------------------------------------------------------

-- Run by the scheduler as the database owner; nobody can call it from the app.
-- Returns what it did, for anyone checking by hand.
create function private.run_daily_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed integer;
  notes integer;
  runs integer;
begin
  -- Imports whose browser or server stopped before finishing. Gmail fetches
  -- are also closed after 10 minutes when someone presses Fetch again.
  update public.import_runs
    set status = 'failed', finished_at = now(), error = 'Did not finish.'
    where status = 'running' and started_at < now() - interval '1 hour';
  get diagnostics closed = row_count;

  delete from public.notifications
    where read_at is not null and read_at < now() - interval '90 days';
  get diagnostics notes = row_count;

  delete from public.escalation_runs
    where started_at < now() - interval '90 days';
  get diagnostics runs = row_count;

  return jsonb_build_object('imports_closed', closed, 'notifications_deleted', notes, 'check_logs_deleted', runs);
end;
$$;

revoke all on function private.run_daily_cleanup() from public, anon, authenticated;

-- Every day at 03:30 UTC. Scheduling again under the same name replaces the job.
select cron.schedule(
  'buddy-daily-cleanup',
  '30 3 * * *',
  'select private.run_daily_cleanup()'
);
