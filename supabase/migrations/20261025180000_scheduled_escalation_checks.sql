-- Phase 4 stage 20: automatic escalation checks every 15 minutes.
--
-- pg_cron (built into Supabase, free) runs private.run_scheduled_escalation_checks()
-- as the database owner. It checks every company that has at least one
-- escalation condition switched on, exactly as "Check now" does, and logs
-- each check in escalation_runs with source 'scheduled'. Settings shows the
-- latest scheduled check, so nobody has to take it on trust that it runs.
--
-- Nothing is sent anywhere (no email or chat), and nothing changes an issue's
-- status, team or urgency: a check only adds escalation records.

create extension if not exists pg_cron with schema pg_catalog;

create function private.run_scheduled_escalation_checks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  companies integer := 0;
begin
  for org in
    select s.organization_id from public.escalation_settings s
    where s.first_response_enabled or s.resolution_enabled or s.urgent_no_team_enabled
          or s.no_team_enabled or s.no_update_enabled
    order by s.organization_id
  loop
    -- A failed check is logged by run_escalation_check and saves nothing for
    -- that company; the other companies are still checked.
    perform private.run_escalation_check(org, 'scheduled', null);
    companies := companies + 1;
  end loop;
  return companies;
end;
$$;

-- Only the scheduler (running as the database owner) may call it.
revoke all on function private.run_scheduled_escalation_checks() from public, anon, authenticated;

-- Every 15 minutes. Scheduling again under the same name replaces the job.
select cron.schedule(
  'buddy-escalation-check',
  '*/15 * * * *',
  'select private.run_scheduled_escalation_checks()'
);

-- Settings reads the latest scheduled check per company.
create index escalation_runs_latest_idx on public.escalation_runs (organization_id, source, started_at desc);
