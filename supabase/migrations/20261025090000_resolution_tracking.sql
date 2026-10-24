-- Phase 4 stage 16: resolution targets, first response, reopening, time spent
-- waiting on the customer, and fuller issue history.
--
-- Deadlines themselves are not stored: they are worked out from received_at,
-- the company's targets and the columns below, so changing a target updates
-- every open issue at once.

-- ---------------------------------------------------------------------------
-- Resolution targets (hours from arrival, per urgency)
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column resolution_hours_critical integer not null default 8 check (resolution_hours_critical between 1 and 2160),
  add column resolution_hours_high integer not null default 24 check (resolution_hours_high between 1 and 2160),
  add column resolution_hours_medium integer not null default 72 check (resolution_hours_medium between 1 and 2160),
  add column resolution_hours_low integer not null default 120 check (resolution_hours_low between 1 and 2160);

-- The existing "Owners and admins edit the company profile" policy decides who.
grant update (resolution_hours_critical, resolution_hours_high, resolution_hours_medium, resolution_hours_low)
  on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- Issue lifecycle columns. Set only by the database, never by the browser.
-- ---------------------------------------------------------------------------

alter table public.issues
  add column first_response_by uuid references public.profiles (id) on delete set null,
  add column reopened_count integer not null default 0 check (reopened_count >= 0),
  -- Total seconds spent in "Waiting on customer" before the current spell.
  add column waiting_seconds integer not null default 0 check (waiting_seconds >= 0),
  -- When the current "Waiting on customer" spell started, or null.
  add column waiting_since timestamptz;

-- The first response is recorded only through record_first_response below,
-- so it can't be backdated or set from the browser.
revoke update (first_response_at) on public.issues from authenticated;

create function private.issue_track_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.reopened_count := 0;
    new.waiting_seconds := 0;
    new.waiting_since := case when new.status = 'waiting_on_customer' then now() end;
    return new;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'waiting_on_customer' and old.waiting_since is not null then
      new.waiting_seconds := old.waiting_seconds
        + greatest(0, extract(epoch from now() - old.waiting_since))::integer;
      new.waiting_since := null;
    end if;
    if new.status = 'waiting_on_customer' then
      new.waiting_since := now();
    end if;
    if old.status = 'resolved' then
      new.reopened_count := old.reopened_count + 1;
    end if;
  end if;
  return new;
end;
$$;

create trigger issue_track_lifecycle before insert or update of status on public.issues
  for each row execute function private.issue_track_lifecycle();

-- ---------------------------------------------------------------------------
-- Record the first response
-- ---------------------------------------------------------------------------

create function public.record_first_response(p_issue_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rec record;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  select i.id, i.organization_id, i.first_response_at into rec
    from public.issues i where i.id = p_issue_id for update;
  if not found or not private.is_member(rec.organization_id) then
    raise exception 'That issue was not found.' using errcode = 'P0002';
  end if;
  if rec.first_response_at is not null then
    raise exception 'The first response was already recorded.' using errcode = 'P0001';
  end if;
  update public.issues set first_response_at = now(), first_response_by = uid where id = p_issue_id;
  return now();
end;
$$;

revoke all on function public.record_first_response(uuid) from public, anon;
grant execute on function public.record_first_response(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- History: category changes, first response, resolved and reopened
-- ---------------------------------------------------------------------------

alter table public.issue_activity drop constraint issue_activity_kind_check;
alter table public.issue_activity add constraint issue_activity_kind_check
  check (kind in ('created', 'status_changed', 'team_changed', 'assignee_changed', 'escalated',
                  'ai_analysed', 'ai_accepted',
                  'category_changed', 'first_response', 'resolved', 'reopened'));

-- Same as before, plus the new kinds. Resolving and reopening are written as
-- their own kinds instead of a plain status change.
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

  if new.team_id is distinct from old.team_id then
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

-- accept_issue_analysis as in stage 13, plus the flag above.
create or replace function public.accept_issue_analysis(p_analysis_id uuid, p_fields text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  a public.issue_analyses;
  i public.issues;
  field text;
  changed integer := 0;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if p_fields is null or cardinality(p_fields) = 0
     or not p_fields <@ array['sentiment', 'intent', 'urgency', 'category', 'summary'] then
    raise exception 'Choose which AI suggestions to use.' using errcode = '22023';
  end if;

  select * into a from public.issue_analyses x where x.id = p_analysis_id;
  if a.id is null or not private.is_member(a.organization_id) then
    raise exception 'That analysis was not found.' using errcode = 'P0002';
  end if;
  if a.status <> 'done' or a.issue_id is null then
    raise exception 'That analysis has no suggestions to use.' using errcode = 'P0001';
  end if;

  select * into i from public.issues x where x.id = a.issue_id for update;
  -- Tells the history trigger that this change is already recorded as
  -- "ai_accepted", so it doesn't also write "category_changed".
  perform set_config('buddy.ai_accept', 'on', true);

  foreach field in array p_fields loop
    if field = 'sentiment' and i.sentiment is distinct from a.sentiment then
      update public.issues set sentiment = a.sentiment, sentiment_score = coalesce(a.sentiment_score, 0)
      where id = i.id;
      insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
      values (i.organization_id, i.id, caller, 'ai_accepted', 'sentiment:' || i.sentiment, a.sentiment);
      changed := changed + 1;
    elsif field = 'intent' and i.intent is distinct from a.intent then
      update public.issues set intent = a.intent where id = i.id;
      insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
      values (i.organization_id, i.id, caller, 'ai_accepted', 'intent:' || i.intent, a.intent);
      changed := changed + 1;
    elsif field = 'urgency' and i.urgency is distinct from a.urgency then
      update public.issues set urgency = a.urgency where id = i.id;
      insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
      values (i.organization_id, i.id, caller, 'ai_accepted', 'urgency:' || i.urgency, a.urgency);
      changed := changed + 1;
    elsif field = 'category' and a.category_id is not null and i.category_id is distinct from a.category_id then
      update public.issues set category_id = a.category_id where id = i.id;
      insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
      values (i.organization_id, i.id, caller, 'ai_accepted',
              'category:' || private.category_name(i.category_id), private.category_name(a.category_id));
      changed := changed + 1;
    elsif field = 'summary' then
      -- Summary, themes and next step are AI-only fields, so they are simply kept up to date.
      update public.issues set summary = a.summary, themes = a.themes, suggested_action = a.suggested_action
      where id = i.id;
    end if;
  end loop;

  if changed > 0 then
    update public.issues set analysis_source = 'ai', confidence = a.confidence where id = i.id;
  end if;
  perform set_config('buddy.ai_accept', '', true);
  return changed;
end;
$$;
