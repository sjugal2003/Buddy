-- Improvement F: team members and in-app team notifications.
--
-- * public.team_members links people who already belong to a company to its
--   teams. Only owners and admins add or remove them; every member can see
--   who is in which team. A team and a person can only be linked inside the
--   same company (both foreign keys include organization_id), and leaving the
--   company or deleting the team removes the link.
-- * When an open issue is given a team (on insert or update, by a person, a
--   routing rule or automatic routing), that team's members get a
--   'team_issue' notification, except the person who made the change. Moving
--   an issue away and back to the same team does not notify again. More than
--   10 issues reaching one team in one statement become one summary.
-- * Escalations now also notify the members of the escalated issue's team,
--   on top of owners and admins. Each person still gets each escalation once.
-- * Titles hold the team's name and the issue reference, never the customer's
--   message, name or email. Nothing is sent outside Buddy.

-- ---------------------------------------------------------------------------
-- Team members
-- ---------------------------------------------------------------------------

create table public.team_members (
  organization_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  added_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id),
  foreign key (organization_id, team_id) references public.teams (organization_id, id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

create index team_members_org_idx on public.team_members (organization_id, team_id);
create index team_members_user_idx on public.team_members (organization_id, user_id);

-- Members read; owners and admins add and remove. No updates: remove and add again.
revoke all on public.team_members from anon, authenticated;
grant select on public.team_members to authenticated;
grant insert (organization_id, team_id, user_id) on public.team_members to authenticated;
grant delete on public.team_members to authenticated;
alter table public.team_members enable row level security;

create policy "Members see team members" on public.team_members
  for select to authenticated
  using (private.is_member(organization_id));
create policy "Owners and admins add team members" on public.team_members
  for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin']));
create policy "Owners and admins remove team members" on public.team_members
  for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));

create trigger team_members_rate_limit before insert on public.team_members
  for each row execute function private.enforce_rate_limit('team_member', '200', '3600', 'team member changes');

-- ---------------------------------------------------------------------------
-- Notifying a team
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('escalation', 'urgent_issue', 'import_problem', 'scheduler_failed', 'team_issue'));

-- Notifies every member of one team, optionally skipping one person (the one
-- who made the change). create_notification skips people who have left the
-- company and repeats of the same key. Returns how many were added.
create function private.notify_team(
  p_organization_id uuid,
  p_team_id uuid,
  p_kind text,
  p_title text,
  p_dedupe_key text,
  p_issue_id uuid default null,
  p_skip uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  person uuid;
  added integer := 0;
begin
  if p_team_id is null then
    return 0;
  end if;
  for person in
    select tm.user_id from public.team_members tm
    where tm.organization_id = p_organization_id and tm.team_id = p_team_id
      and tm.user_id is distinct from p_skip
    order by tm.user_id
  loop
    if private.create_notification(p_organization_id, person, p_kind, p_title, p_dedupe_key, p_issue_id) is not null then
      added := added + 1;
    end if;
  end loop;
  return added;
end;
$$;

revoke all on function private.notify_team(uuid, uuid, text, text, text, uuid, uuid) from public, anon, authenticated;

-- Shared by the insert and update triggers below. `changed` holds the open
-- issues that just got a (new) team.
create function private.notify_team_issues(changed jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  grp record;
  i record;
begin
  for grp in
    select (c ->> 'organization_id')::uuid as organization_id, (c ->> 'team_id')::uuid as team_id,
           t.name as team_name, count(*) as total
    from jsonb_array_elements(changed) c
    join public.teams t on t.id = (c ->> 'team_id')::uuid
    group by 1, 2, t.name
  loop
    if grp.total <= 10 then
      for i in
        select (c ->> 'id')::uuid as id, c ->> 'reference' as reference
        from jsonb_array_elements(changed) c
        where (c ->> 'team_id')::uuid = grp.team_id
        order by c ->> 'reference'
      loop
        perform private.notify_team(grp.organization_id, grp.team_id, 'team_issue',
          format('New issue for %s: %s', grp.team_name, i.reference),
          'team_issue:' || i.id || ':' || grp.team_id, i.id, actor);
      end loop;
    else
      perform private.notify_team(grp.organization_id, grp.team_id, 'team_issue',
        format('%s new issues for %s. See the Issues list.', grp.total, grp.team_name),
        'team_issues:' || gen_random_uuid(), null, actor);
    end if;
  end loop;
end;
$$;

revoke all on function private.notify_team_issues(jsonb) from public, anon, authenticated;

create function private.notify_team_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'organization_id', n.organization_id, 'team_id', n.team_id, 'reference', n.reference)), '[]')
    into changed
  from new_issues n
  where n.team_id is not null and n.status <> 'resolved';
  if jsonb_array_length(changed) > 0 then
    perform private.notify_team_issues(changed);
  end if;
  return null;
end;
$$;

create function private.notify_team_on_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'organization_id', n.organization_id, 'team_id', n.team_id, 'reference', n.reference)), '[]')
    into changed
  from new_issues n join old_issues o on o.id = n.id
  where n.team_id is not null and n.team_id is distinct from o.team_id and n.status <> 'resolved';
  if jsonb_array_length(changed) > 0 then
    perform private.notify_team_issues(changed);
  end if;
  return null;
end;
$$;

revoke all on function private.notify_team_on_insert() from public, anon, authenticated;
revoke all on function private.notify_team_on_update() from public, anon, authenticated;

-- Statement-level, so a change to many issues at once can become one summary.
-- (Transition tables can't be combined with a column list or two events.)
create trigger issues_notify_team_insert
  after insert on public.issues
  referencing new table as new_issues
  for each statement execute function private.notify_team_on_insert();

create trigger issues_notify_team_update
  after update on public.issues
  referencing old table as old_issues new table as new_issues
  for each statement execute function private.notify_team_on_update();

-- ---------------------------------------------------------------------------
-- Escalations also reach the issue's team
-- ---------------------------------------------------------------------------

-- Same as in 20261027120000_notification_events.sql, plus notify_team. The
-- dedupe key is the same, so an owner who is also in the team gets one.
create or replace function private.notify_new_escalations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org record;
  e record;
  summary_title text;
  summary_key text;
  team uuid;
begin
  for org in
    select n.organization_id, count(*) as total from new_escalations n group by n.organization_id
  loop
    if org.total <= 10 then
      for e in
        select n.id, n.issue_id, n.level, n.condition, i.reference, i.team_id
        from new_escalations n join public.issues i on i.id = n.issue_id
        where n.organization_id = org.organization_id
        order by n.created_at, n.id
      loop
        perform private.notify_staff(org.organization_id, 'escalation',
          format('Escalated (level %s): %s, %s', e.level, private.escalation_label(e.condition), e.reference),
          'escalation:' || e.id, e.issue_id);
        perform private.notify_team(org.organization_id, e.team_id, 'escalation',
          format('Escalated (level %s): %s, %s', e.level, private.escalation_label(e.condition), e.reference),
          'escalation:' || e.id, e.issue_id);
      end loop;
    else
      summary_title := format('%s issues escalated in one check. See the Issues list.', org.total);
      summary_key := 'escalations:' || gen_random_uuid();
      perform private.notify_staff(org.organization_id, 'escalation', summary_title, summary_key);
      for team in
        select distinct i.team_id
        from new_escalations n join public.issues i on i.id = n.issue_id
        where n.organization_id = org.organization_id and i.team_id is not null
      loop
        perform private.notify_team(org.organization_id, team, 'escalation', summary_title, summary_key);
      end loop;
    end if;
  end loop;
  return null;
end;
$$;
