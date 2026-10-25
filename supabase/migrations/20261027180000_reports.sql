-- Phase 6 stage 32: the Reports page.
--
-- One read-only function counts a company's figures for a date range, in the
-- database, so the numbers are right for any number of issues. It checks
-- membership first: everyone in the company can see its reports (they can
-- already see the same issues), nobody else can. Days are counted in the
-- company's time zone, from the start of the first day up to, not including,
-- the start of the day after the last one, so no moment is counted twice.
-- Only company and team figures: nothing per person. Nothing is changed.

create function public.issue_report(p_organization_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  org public.organizations;
  range_start timestamptz;
  range_end timestamptz;
  result jsonb;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.is_member(p_organization_id) then
    raise exception 'That workspace was not found.' using errcode = 'P0002';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a start date on or before the end date.' using errcode = '22023';
  end if;
  if p_to - p_from > 365 then
    raise exception 'Choose a date range of 366 days or fewer.' using errcode = '22023';
  end if;

  select * into org from public.organizations o where o.id = p_organization_id;
  range_start := p_from::timestamp at time zone org.timezone;
  range_end := (p_to + 1)::timestamp at time zone org.timezone;

  with received as (
    select
      i.*,
      -- Past conversations imported as already resolved: counted as received,
      -- left out of the timings and the target (they were never handled in Buddy).
      (i.source <> 'manual' and i.status = 'resolved' and i.first_response_at is null
        and i.resolved_at = i.received_at) as history,
      i.received_at + make_interval(hours => case i.urgency
        when 'critical' then org.target_hours_critical
        when 'high' then org.target_hours_high
        when 'medium' then org.target_hours_medium
        else org.target_hours_low end) as response_due
    from public.issues i
    where i.organization_id = p_organization_id
      and i.received_at >= range_start and i.received_at < range_end
  ),
  timed as (
    select
      r.*,
      case when r.first_response_at is not null
        then greatest(0, extract(epoch from r.first_response_at - r.received_at)) end as response_seconds,
      case when r.status = 'resolved' and not r.history
        then greatest(0, extract(epoch from r.resolved_at - r.received_at)) end as resolution_seconds
    from received r
  )
  select jsonb_build_object(
    'timezone', org.timezone,
    'from', p_from,
    'to', p_to,
    'totals', (
      select jsonb_build_object(
        'received', count(*),
        'history', count(*) filter (where t.history),
        'still_open', count(*) filter (where t.status <> 'resolved'))
      from timed t),
    -- A reopened issue is counted once, by its latest resolution.
    'resolved', (
      select count(*) from public.issues i
      where i.organization_id = p_organization_id and i.status = 'resolved'
        and i.resolved_at >= range_start and i.resolved_at < range_end),
    'first_response', (
      select jsonb_build_object(
        'count', count(t.response_seconds),
        'median_seconds', round(percentile_cont(0.5) within group (order by t.response_seconds)),
        'average_seconds', round(avg(t.response_seconds)))
      from timed t),
    'resolution', (
      select jsonb_build_object(
        'count', count(t.resolution_seconds),
        'median_seconds', round(percentile_cont(0.5) within group (order by t.resolution_seconds)),
        'average_seconds', round(avg(t.resolution_seconds)))
      from timed t),
    -- Measured against the company's current first-response targets.
    'response_target', (
      select jsonb_build_object(
        'met', count(*) filter (where t.first_response_at <= t.response_due),
        'late', count(*) filter (where t.first_response_at > t.response_due),
        'missed', count(*) filter (where t.first_response_at is null and t.status <> 'resolved' and now() > t.response_due),
        'not_due', count(*) filter (where t.first_response_at is null and t.status <> 'resolved' and now() <= t.response_due),
        'resolved_without_response', count(*) filter (where t.first_response_at is null and t.status = 'resolved' and not t.history))
      from timed t),
    'escalations', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.count desc, x.condition), '[]')
      from (
        select e.condition, count(*) as count, count(*) filter (where e.acknowledged_at is not null) as acknowledged
        from public.escalations e
        where e.organization_id = p_organization_id
          and e.created_at >= range_start and e.created_at < range_end
        group by e.condition) x),
    -- Workload and timing per team, never per person.
    'teams', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.received desc, x.name nulls last), '[]')
      from (
        select tm.name, count(*) as received,
          count(*) filter (where t.status <> 'resolved') as still_open,
          round(percentile_cont(0.5) within group (order by t.response_seconds)) as median_response_seconds,
          round(percentile_cont(0.5) within group (order by t.resolution_seconds)) as median_resolution_seconds
        from timed t left join public.teams tm on tm.id = t.team_id
        group by t.team_id, tm.name) x),
    'categories', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.count desc, x.name nulls last), '[]')
      from (
        select c.name, count(*) as count
        from timed t left join public.categories c on c.id = t.category_id
        group by t.category_id, c.name) x),
    'channels', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.count desc, x.key), '[]')
      from (select t.channel as key, count(*) as count from timed t group by t.channel) x),
    'urgency', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.count desc, x.key), '[]')
      from (select t.urgency as key, count(*) as count from timed t group by t.urgency) x),
    'sentiment', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.count desc, x.key), '[]')
      from (select t.sentiment as key, count(*) as count from timed t group by t.sentiment) x),
    'imports', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.source), '[]')
      from (
        select r.source, count(*) as runs,
          count(*) filter (where r.status = 'failed') as failed,
          coalesce(sum(r.imported), 0) as imported,
          coalesce(sum(r.skipped_duplicate), 0) as skipped_duplicate,
          coalesce(sum(r.rejected), 0) as rejected
        from public.import_runs r
        where r.organization_id = p_organization_id
          and r.started_at >= range_start and r.started_at < range_end
        group by r.source) x)
  ) into result;

  return result;
end;
$$;

revoke all on function public.issue_report(uuid, date, date) from public, anon;
grant execute on function public.issue_report(uuid, date, date) to authenticated;
