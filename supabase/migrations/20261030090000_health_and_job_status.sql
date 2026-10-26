-- Phase 7 stage 38: noticing when something stops working (findings F8 and
-- F18).
--
-- * public.service_health() answers true when the database is reachable. The
--   health page (/api/health) calls it, so a free uptime checker can watch
--   Buddy later. It reads nothing.
-- * public.scheduled_job_status(org) tells a company's owners and admins
--   whether Buddy's scheduled jobs (pg_cron, inside the database) are set up
--   and how their latest run went. Settings shows the daily clean-up from
--   it. It returns the job's name, schedule, time and status only: never the
--   job's command or error text.

create function public.service_health()
returns boolean
language sql
stable
set search_path = ''
as $$
  select true;
$$;

revoke all on function public.service_health() from public;
grant execute on function public.service_health() to anon, authenticated;

create function public.scheduled_job_status(p_org uuid)
returns table (job_name text, schedule text, active boolean, last_run_at timestamptz, last_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.has_role(p_org, array['owner', 'admin']) then
    raise exception 'Only owners and admins can see the scheduled jobs.' using errcode = '42501';
  end if;

  return query
  select j.jobname::text, j.schedule::text, j.active, last.start_time, last.status::text
  from cron.job j
  left join lateral (
    select d.start_time, d.status
    from cron.job_run_details d
    where d.jobid = j.jobid
    order by d.start_time desc nulls last
    limit 1
  ) last on true
  where j.jobname in ('buddy-daily-cleanup', 'buddy-escalation-check')
  order by j.jobname;
end;
$$;

revoke all on function public.scheduled_job_status(uuid) from public, anon;
grant execute on function public.scheduled_job_status(uuid) to authenticated;
