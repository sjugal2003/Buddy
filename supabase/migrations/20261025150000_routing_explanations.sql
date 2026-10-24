-- Phase 4 stage 18: routing explanations, conflicts, Dismiss suggestion and
-- routing history.
--
-- Which rule matches is worked out by the app (src/lib/routing.ts), which
-- explains the match and shows a conflict when matching rules name different
-- teams. The database records what happened: a team set by a rule, or a
-- suggestion a person dismissed.

-- ---------------------------------------------------------------------------
-- Dismissed suggestions
-- ---------------------------------------------------------------------------

-- Set only by dismiss_routing_suggestion; cleared when the issue's category,
-- urgency, type or channel changes, because the suggestion may then differ.
alter table public.issues add column routing_dismissed_at timestamptz;

create function private.issue_reset_routing_dismissal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is distinct from old.category_id
     or new.urgency is distinct from old.urgency
     or new.intent is distinct from old.intent
     or new.channel is distinct from old.channel then
    new.routing_dismissed_at := null;
  end if;
  return new;
end;
$$;

create trigger issue_reset_routing_dismissal before update on public.issues
  for each row when (old.routing_dismissed_at is not null)
  execute function private.issue_reset_routing_dismissal();

-- ---------------------------------------------------------------------------
-- History kinds
-- ---------------------------------------------------------------------------

alter table public.issue_activity drop constraint issue_activity_kind_check;
alter table public.issue_activity add constraint issue_activity_kind_check
  check (kind in ('created', 'status_changed', 'team_changed', 'assignee_changed', 'escalated',
                  'ai_analysed', 'ai_accepted',
                  'category_changed', 'first_response', 'resolved', 'reopened',
                  'escalation_acknowledged',
                  'routing_applied', 'routing_dismissed'));

-- As in stage 16, except a team set by apply_routing_rule isn't recorded twice.
create or replace function private.issue_record_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  kind text;
begin
  if tg_op = 'INSERT' then
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, to_value)
    values (new.organization_id, new.id, actor, 'created', new.status);
    return null;
  end if;

  if new.status is distinct from old.status then
    kind := case
      when new.status = 'resolved' then 'resolved'
      when old.status = 'resolved' then 'reopened'
      else 'status_changed'
    end;
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
    values (new.organization_id, new.id, actor, kind, old.status, new.status);
  end if;

  -- apply_routing_rule records its own "routing_applied" entry instead.
  if new.team_id is distinct from old.team_id
     and coalesce(current_setting('buddy.routing_rule', true), '') = '' then
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
    values (new.organization_id, new.id, actor, 'team_changed',
            private.team_name(old.team_id), private.team_name(new.team_id));
  end if;

  if new.category_id is distinct from old.category_id
     and coalesce(current_setting('buddy.ai_accept', true), '') <> 'on' then
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
    values (new.organization_id, new.id, actor, 'category_changed',
            private.category_name(old.category_id), private.category_name(new.category_id));
  end if;

  if new.assignee_name is distinct from old.assignee_name then
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
    values (new.organization_id, new.id, actor, 'assignee_changed', old.assignee_name, new.assignee_name);
  end if;

  if new.first_response_at is not null and old.first_response_at is null then
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, to_value)
    values (new.organization_id, new.id, actor, 'first_response', new.first_response_at::text);
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply a rule's team
-- ---------------------------------------------------------------------------

-- Gives the issue the team of one of its company's enabled rules, and records
-- which rule did it. Changes nothing (returns false) if the issue's team is no
-- longer p_expected_team (null means "still has no team"), so a team someone
-- chose in the meantime is never overwritten. The app decides which rule
-- matches; a member could already set any team of their company by hand, so
-- this gives nobody a new power.
create function public.apply_routing_rule(p_issue_id uuid, p_rule_id uuid, p_expected_team uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  i public.issues;
  r public.routing_rules;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  select * into i from public.issues x where x.id = p_issue_id for update;
  if i.id is null or not private.is_member(i.organization_id) then
    raise exception 'That issue was not found.' using errcode = 'P0002';
  end if;
  select * into r from public.routing_rules x where x.id = p_rule_id and x.organization_id = i.organization_id;
  if r.id is null then
    raise exception 'That routing rule no longer exists.' using errcode = 'P0002';
  end if;
  if not r.enabled then
    raise exception 'That routing rule is switched off.' using errcode = 'P0001';
  end if;
  if i.team_id is distinct from p_expected_team then
    return false;
  end if;
  if i.team_id is not distinct from r.team_id then
    return false;
  end if;

  perform set_config('buddy.routing_rule', r.id::text, true);
  update public.issues set team_id = r.team_id where id = i.id;
  perform set_config('buddy.routing_rule', '', true);
  insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
  values (i.organization_id, i.id, uid, 'routing_applied', r.name, private.team_name(r.team_id));
  return true;
end;
$$;

revoke all on function public.apply_routing_rule(uuid, uuid, uuid) from public, anon;
grant execute on function public.apply_routing_rule(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Dismiss a suggestion (any member)
-- ---------------------------------------------------------------------------

create function public.dismiss_routing_suggestion(p_issue_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  i public.issues;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  select * into i from public.issues x where x.id = p_issue_id for update;
  if i.id is null or not private.is_member(i.organization_id) then
    raise exception 'That issue was not found.' using errcode = 'P0002';
  end if;
  if i.routing_dismissed_at is not null then
    raise exception 'The routing suggestion was already dismissed.' using errcode = 'P0001';
  end if;
  update public.issues set routing_dismissed_at = now() where id = i.id;
  insert into public.issue_activity (organization_id, issue_id, actor_id, kind)
  values (i.organization_id, i.id, uid, 'routing_dismissed');
  return now();
end;
$$;

revoke all on function public.dismiss_routing_suggestion(uuid) from public, anon;
grant execute on function public.dismiss_routing_suggestion(uuid) to authenticated;
