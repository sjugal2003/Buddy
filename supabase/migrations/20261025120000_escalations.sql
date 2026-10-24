-- Phase 4 stage 17: escalation engine.
--
-- Owners and admins switch conditions on in Settings (all off by default).
-- A check looks at one company's open issues and records an escalation for
-- each condition an issue meets: a separate record with a reason and level.
-- It never changes the issue's status, team or urgency. Checks run when an
-- owner or admin presses "Check now"; stage 20 adds a schedule.

-- ---------------------------------------------------------------------------
-- Settings (one row per company)
-- ---------------------------------------------------------------------------

create table public.escalation_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- First-response target breached (level 1)
  first_response_enabled boolean not null default false,
  -- Resolution target breached (level 2)
  resolution_enabled boolean not null default false,
  -- Critical or High urgency still has no team after N hours (level 2 if Critical, else 1)
  urgent_no_team_enabled boolean not null default false,
  urgent_no_team_hours integer not null default 1 check (urgent_no_team_hours between 0 and 720),
  -- Open with no team after N hours (level 1)
  no_team_enabled boolean not null default false,
  no_team_hours integer not null default 24 check (no_team_hours between 0 and 720),
  -- No update for N hours (level 1)
  no_update_enabled boolean not null default false,
  no_update_hours integer not null default 72 check (no_update_hours between 1 and 720),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.escalation_settings
  for each row execute function private.set_updated_at();
create trigger escalation_set_updated_by before update on public.escalation_settings
  for each row execute function private.automation_set_updated_by();

-- Every company gets a row: existing ones now, new ones when created.
insert into public.escalation_settings (organization_id) select id from public.organizations;

create function private.create_escalation_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.escalation_settings (organization_id) values (new.id);
  return null;
end;
$$;

create trigger organizations_create_escalation_settings after insert on public.organizations
  for each row execute function private.create_escalation_settings();

-- ---------------------------------------------------------------------------
-- Escalations and the run log
-- ---------------------------------------------------------------------------

create table public.escalations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  issue_id uuid not null,
  condition text not null
    check (condition in ('first_response_breached', 'resolution_breached', 'urgent_no_team', 'no_team', 'no_update')),
  level smallint not null check (level between 1 and 2),
  reason text not null check (char_length(reason) between 1 and 300),
  -- The issue's reopen count when this was raised. Each condition escalates
  -- an issue once per open spell; reopening starts a new spell.
  spell integer not null check (spell >= 0),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id) on delete set null,
  acknowledge_note text check (char_length(acknowledge_note) <= 500),
  unique (issue_id, condition, spell),
  foreign key (organization_id, issue_id) references public.issues (organization_id, id) on delete cascade
);

create index escalations_open_idx on public.escalations (organization_id, issue_id) where acknowledged_at is null;
create index escalations_issue_idx on public.escalations (issue_id, created_at desc);

create table public.escalation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null check (source in ('manual', 'scheduled')),
  started_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  issues_checked integer not null default 0,
  escalations_created integer not null default 0,
  error text check (char_length(error) <= 500)
);

create index escalation_runs_org_idx on public.escalation_runs (organization_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Access: members read; owners and admins edit settings; escalations and
-- runs are written only by the functions below.
-- ---------------------------------------------------------------------------

revoke all on public.escalation_settings, public.escalations, public.escalation_runs from anon, authenticated;
grant select on public.escalation_settings, public.escalations, public.escalation_runs to authenticated;
grant update (first_response_enabled, resolution_enabled,
              urgent_no_team_enabled, urgent_no_team_hours,
              no_team_enabled, no_team_hours,
              no_update_enabled, no_update_hours)
  on public.escalation_settings to authenticated;

alter table public.escalation_settings enable row level security;
alter table public.escalations enable row level security;
alter table public.escalation_runs enable row level security;

create policy "Members see escalation settings" on public.escalation_settings
  for select to authenticated
  using (private.is_member(organization_id));
create policy "Owners and admins edit escalation settings" on public.escalation_settings
  for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']))
  with check (private.has_role(organization_id, array['owner', 'admin']));

create policy "Members see escalations" on public.escalations
  for select to authenticated
  using (private.is_member(organization_id));

create policy "Members see escalation checks" on public.escalation_runs
  for select to authenticated
  using (private.is_member(organization_id));

-- ---------------------------------------------------------------------------
-- History kinds
-- ---------------------------------------------------------------------------

alter table public.issue_activity drop constraint issue_activity_kind_check;
alter table public.issue_activity add constraint issue_activity_kind_check
  check (kind in ('created', 'status_changed', 'team_changed', 'assignee_changed', 'escalated',
                  'ai_analysed', 'ai_accepted',
                  'category_changed', 'first_response', 'resolved', 'reopened',
                  'escalation_acknowledged'));

-- ---------------------------------------------------------------------------
-- The check
-- ---------------------------------------------------------------------------

-- "2 h 15 min", "45 min", "3 d 4 h", like formatDuration in src/lib/targets.ts.
create function private.duration_text(d interval)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when m < 60 then m || ' min'
    when m < 48 * 60 then (m / 60) || ' h' || case when m % 60 > 0 then ' ' || (m % 60) || ' min' else '' end
    else (m / 1440) || ' d' || case when (m / 60) % 24 > 0 then ' ' || ((m / 60) % 24) || ' h' else '' end
  end
  from (select greatest(1, round(abs(extract(epoch from d)) / 60))::bigint as m) x;
$$;

-- Checks one company's open issues. Returns the run's id. Running it twice
-- creates nothing new: each condition escalates an issue once per open spell.
-- Not callable from the app: public.run_escalation_check decides who may run it.
create function private.run_escalation_check(p_organization_id uuid, p_source text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.organizations;
  s public.escalation_settings;
  run_id uuid;
  checked integer := 0;
  created integer := 0;
begin
  select * into o from public.organizations where id = p_organization_id;
  select * into s from public.escalation_settings where organization_id = p_organization_id;
  insert into public.escalation_runs (organization_id, source, started_by)
  values (p_organization_id, p_source, p_actor)
  returning id into run_id;

  begin
    select count(*) into checked from public.issues
      where organization_id = p_organization_id and status <> 'resolved';

    with open_issues as (
      select i.id, i.organization_id, i.urgency, i.team_id, i.received_at, i.updated_at,
             i.first_response_at, i.waiting_since, i.reopened_count,
             i.received_at + make_interval(hours => case i.urgency
               when 'critical' then o.target_hours_critical when 'high' then o.target_hours_high
               when 'medium' then o.target_hours_medium else o.target_hours_low end) as response_due,
             -- Time spent waiting on the customer doesn't count (as in src/lib/targets.ts).
             i.received_at + make_interval(hours => case i.urgency
               when 'critical' then o.resolution_hours_critical when 'high' then o.resolution_hours_high
               when 'medium' then o.resolution_hours_medium else o.resolution_hours_low end)
               + make_interval(secs => i.waiting_seconds) as resolution_due
      from public.issues i
      where i.organization_id = p_organization_id and i.status <> 'resolved'
    ),
    candidates as (
      select id, organization_id, reopened_count as spell, 'first_response_breached' as condition, 1 as level,
             format('First response was due %s (%s). None recorded yet: %s late.',
                    to_char(response_due at time zone o.timezone, 'DD Mon HH24:MI'), o.timezone,
                    private.duration_text(now() - response_due)) as reason
        from open_issues
        where s.first_response_enabled and first_response_at is null and now() > response_due
      union all
      select id, organization_id, reopened_count, 'resolution_breached', 2,
             format('Resolution was due %s (%s). Still open: %s late.',
                    to_char(resolution_due at time zone o.timezone, 'DD Mon HH24:MI'), o.timezone,
                    private.duration_text(now() - resolution_due))
        from open_issues
        -- Paused while waiting on the customer.
        where s.resolution_enabled and waiting_since is null and now() > resolution_due
      union all
      select id, organization_id, reopened_count, 'urgent_no_team', case when urgency = 'critical' then 2 else 1 end,
             format('%s issue still has no team after %s.', initcap(urgency), private.duration_text(now() - received_at))
        from open_issues
        where s.urgent_no_team_enabled and urgency in ('critical', 'high') and team_id is null
          and now() >= received_at + make_interval(hours => s.urgent_no_team_hours)
      union all
      select id, organization_id, reopened_count, 'no_team', 1,
             format('Still has no team after %s.', private.duration_text(now() - received_at))
        from open_issues
        where s.no_team_enabled and team_id is null
          and now() >= received_at + make_interval(hours => s.no_team_hours)
      union all
      select id, organization_id, reopened_count, 'no_update', 1,
             format('No update for %s.', private.duration_text(now() - updated_at))
        from open_issues
        where s.no_update_enabled and now() >= updated_at + make_interval(hours => s.no_update_hours)
    ),
    inserted as (
      insert into public.escalations (organization_id, issue_id, condition, level, reason, spell)
      select organization_id, id, condition, level, reason, spell from candidates
      on conflict (issue_id, condition, spell) do nothing
      returning organization_id, issue_id, level, reason
    )
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
    select organization_id, issue_id, null, 'escalated', level::text, reason from inserted;
    get diagnostics created = row_count;

    update public.escalation_runs
      set finished_at = clock_timestamp(), issues_checked = checked, escalations_created = created
      where id = run_id;
  exception when others then
    -- Keep the run in the log with what went wrong; nothing else is saved.
    update public.escalation_runs
      set finished_at = clock_timestamp(), issues_checked = checked, error = left(sqlerrm, 500)
      where id = run_id;
  end;
  return run_id;
end;
$$;

revoke all on function private.run_escalation_check(uuid, text, uuid) from public, anon, authenticated;

-- "Check now": owners and admins, for their own company.
create function public.run_escalation_check(p_organization_id uuid)
returns table (issues_checked integer, escalations_created integer, error text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  s public.escalation_settings;
  run_id uuid;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.has_role(p_organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and admins can run escalation checks.' using errcode = '42501';
  end if;
  select * into s from public.escalation_settings where organization_id = p_organization_id;
  if not (s.first_response_enabled or s.resolution_enabled or s.urgent_no_team_enabled
          or s.no_team_enabled or s.no_update_enabled) then
    raise exception 'Switch on at least one escalation condition first.' using errcode = 'P0001';
  end if;
  run_id := private.run_escalation_check(p_organization_id, 'manual', uid);
  return query select r.issues_checked, r.escalations_created, r.error
    from public.escalation_runs r where r.id = run_id;
end;
$$;

revoke all on function public.run_escalation_check(uuid) from public, anon;
grant execute on function public.run_escalation_check(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Acknowledge (any member of the issue's company)
-- ---------------------------------------------------------------------------

create function public.acknowledge_escalation(p_escalation_id uuid, p_note text default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  note text := nullif(btrim(coalesce(p_note, '')), '');
  e public.escalations;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if char_length(note) > 500 then
    raise exception 'Keep the note to 500 characters or fewer.' using errcode = '22023';
  end if;
  select * into e from public.escalations x where x.id = p_escalation_id for update;
  if e.id is null or not private.is_member(e.organization_id) then
    raise exception 'That escalation was not found.' using errcode = 'P0002';
  end if;
  if e.acknowledged_at is not null then
    raise exception 'This escalation was already acknowledged.' using errcode = 'P0001';
  end if;

  update public.escalations
    set acknowledged_at = now(), acknowledged_by = uid, acknowledge_note = note
    where id = e.id;
  insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
  values (e.organization_id, e.issue_id, uid, 'escalation_acknowledged', e.condition, note);
  return now();
end;
$$;

revoke all on function public.acknowledge_escalation(uuid, text) from public, anon;
grant execute on function public.acknowledge_escalation(uuid, text) to authenticated;
