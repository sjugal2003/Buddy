-- Improvement D, step 2: repeated problems.
--
-- Uses the "same problem" links from step 1 (issues.duplicate_of). Nothing
-- here changes an issue, and nothing uses AI.
--
-- * public.issue_report gains a "repeated" list: up to 10 main issues of the
--   company with the most reports received in the period. The rest of the
--   report is exactly as before: the previous function is kept, renamed, as
--   private.issue_report_base and the new one adds the list to its answer.
-- * When a main issue reaches 3, 5 and 10 reports (itself plus its linked
--   reports), owners and admins, and the members of the issue's team, get a
--   notification in Buddy, once per step. Titles name only the reference.

-- ---------------------------------------------------------------------------
-- Repeated problems in the report
-- ---------------------------------------------------------------------------

-- Fast counting of linked reports by when they arrived.
create index issues_duplicate_received_idx on public.issues (organization_id, duplicate_of, received_at)
  where duplicate_of is not null;

alter function public.issue_report(uuid, date, date) rename to issue_report_base;
alter function public.issue_report_base(uuid, date, date) set schema private;
revoke all on function private.issue_report_base(uuid, date, date) from public, anon, authenticated;

-- As before (members only, company time zone, at most 366 days), plus
-- "repeated": main issues with at least one report in the period, where
-- in_period counts the main issue (if it arrived in the period) and its linked
-- reports that arrived in the period, and total counts the main issue and all
-- its linked reports. Most in the period first.
create function public.issue_report(p_organization_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  tz text;
  range_start timestamptz;
  range_end timestamptz;
begin
  -- Checks sign-in, membership and the dates, and counts everything else.
  result := private.issue_report_base(p_organization_id, p_from, p_to);

  select o.timezone into tz from public.organizations o where o.id = p_organization_id;
  range_start := p_from::timestamp at time zone tz;
  range_end := (p_to + 1)::timestamp at time zone tz;

  return result || jsonb_build_object('repeated', (
    select coalesce(jsonb_agg(to_jsonb(x) order by x.in_period desc, x.total desc, x.reference), '[]')
    from (
      select m.id, m.reference, m.subject, m.status,
        (count(*) filter (where r.received_at >= range_start and r.received_at < range_end)
          + case when m.received_at >= range_start and m.received_at < range_end then 1 else 0 end) as in_period,
        count(*) + 1 as total
      from public.issues r
      join public.issues m on m.organization_id = r.organization_id and m.id = r.duplicate_of
      where r.organization_id = p_organization_id and r.duplicate_of is not null
      group by m.id, m.reference, m.subject, m.status, m.received_at
      having count(*) filter (where r.received_at >= range_start and r.received_at < range_end) > 0
         or (m.received_at >= range_start and m.received_at < range_end)
      order by 5 desc, 6 desc, m.reference
      limit 10) x));
end;
$$;

revoke all on function public.issue_report(uuid, date, date) from public, anon;
grant execute on function public.issue_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- "Reported N times" notifications
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('escalation', 'urgent_issue', 'import_problem', 'scheduler_failed', 'team_issue', 'repeated_problem'));

create function private.notify_repeated_problem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  main public.issues;
  reports integer;
  title text;
  dedupe text;
begin
  select * into main from public.issues x where x.id = new.duplicate_of;
  if main.id is null then
    return null;
  end if;
  select count(*) + 1 into reports from public.issues x
    where x.organization_id = main.organization_id and x.duplicate_of = main.id;
  if reports not in (3, 5, 10) then
    return null;
  end if;
  title := format('%s has been reported %s times.', main.reference, reports);
  -- One notification per person per step, however often links change.
  dedupe := format('repeated:%s:%s', main.id, reports);
  perform private.notify_staff(main.organization_id, 'repeated_problem', title, dedupe, main.id);
  perform private.notify_team(main.organization_id, main.team_id, 'repeated_problem', title, dedupe, main.id);
  return null;
end;
$$;

revoke all on function private.notify_repeated_problem() from public, anon, authenticated;

create trigger issues_notify_repeated_problem after update of duplicate_of on public.issues
  for each row when (new.duplicate_of is not null and new.duplicate_of is distinct from old.duplicate_of)
  execute function private.notify_repeated_problem();
