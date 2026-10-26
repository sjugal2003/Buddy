-- Phase 7 stage 37: deleting customer data and keeping it only as long as
-- needed (finding F3).
--
-- * Only a company's owner can delete issues, through two functions:
--   delete_issue (one issue) and delete_customer_data (every issue from one
--   customer email). Owners and admins could delete issues directly before;
--   that is closed, so every deletion goes through the log below.
-- * public.deletion_log records each deletion: when, who, what kind and how
--   many issues. Never the customer's name, email or message. Owners can read
--   it; nobody can change it.
-- * organizations.retention_days: delete resolved issues this many days after
--   they were resolved (empty = keep them). Owners set it with
--   set_retention_days; the daily clean-up applies it and logs what it deleted.
-- * When an issue goes, the AI's summary, next step and themes for it are
--   cleared too. The analysis rows stay (without text) so the monthly AI
--   count can't be reset by deleting issues.

-- ---------------------------------------------------------------------------
-- AI analyses keep no text from deleted issues
-- ---------------------------------------------------------------------------

alter table public.issue_analyses drop constraint issue_analyses_check;
alter table public.issue_analyses add constraint issue_analyses_check
  check (status <> 'done' or issue_id is null
    or (sentiment is not null and intent is not null and urgency is not null and summary <> ''));

create function private.clear_deleted_issue_analyses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.issue_analyses
    set issue_id = null, summary = '', suggested_action = '', themes = '{}'
    where organization_id = old.organization_id and issue_id = old.id;
  return old;
end;
$$;

revoke all on function private.clear_deleted_issue_analyses() from public, anon, authenticated;

create trigger issues_clear_analyses before delete on public.issues
  for each row execute function private.clear_deleted_issue_analyses();

-- ---------------------------------------------------------------------------
-- Deletion log
-- ---------------------------------------------------------------------------

create table public.deletion_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Empty for the automatic clean-up, or when the person's account is gone.
  deleted_by uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('issue', 'customer', 'retention')),
  issue_count integer not null check (issue_count >= 0),
  -- Buddy's own issue reference for a single issue (ISS-...), never customer text.
  reference text check (char_length(reference) <= 40),
  created_at timestamptz not null default now()
);

create index deletion_log_org_created_idx on public.deletion_log (organization_id, created_at desc);

alter table public.deletion_log enable row level security;
revoke all on public.deletion_log from public, anon, authenticated;
grant select on public.deletion_log to authenticated;

create policy "Owners see their company's deletion log" on public.deletion_log
  for select to authenticated
  using (private.has_role(organization_id, array['owner']));

-- ---------------------------------------------------------------------------
-- Only owners delete, and only through these functions
-- ---------------------------------------------------------------------------

drop policy "Owners and admins delete issues" on public.issues;
revoke delete on public.issues from authenticated;

create function public.delete_issue(p_issue_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target public.issues;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  select * into target from public.issues i where i.id = p_issue_id;
  if target.id is null or not private.is_member(target.organization_id) then
    raise exception 'That issue was not found.' using errcode = 'P0002';
  end if;
  if not private.has_role(target.organization_id, array['owner']) then
    raise exception 'Only the company''s owner can delete issues.' using errcode = 'P0001';
  end if;

  delete from public.issues i where i.id = target.id;

  insert into public.deletion_log (organization_id, deleted_by, kind, issue_count, reference)
  values (target.organization_id, caller, 'issue', 1, target.reference);

  return target.reference;
end;
$$;

revoke all on function public.delete_issue(uuid) from public, anon;
grant execute on function public.delete_issue(uuid) to authenticated;

-- Every issue in the company with this customer email. Returns how many.
create function public.delete_customer_data(p_org uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  wanted text := lower(btrim(coalesce(p_email, '')));
  n integer;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.is_member(p_org) then
    raise exception 'That company was not found.' using errcode = 'P0002';
  end if;
  if not private.has_role(p_org, array['owner']) then
    raise exception 'Only the company''s owner can delete a customer''s data.' using errcode = 'P0001';
  end if;
  if wanted !~ '^[^@\s]+@[^@\s]+$' or char_length(wanted) > 254 then
    raise exception 'Enter the customer''s email address.' using errcode = '22023';
  end if;

  delete from public.issues i where i.organization_id = p_org and i.customer_email = wanted;
  get diagnostics n = row_count;

  if n > 0 then
    insert into public.deletion_log (organization_id, deleted_by, kind, issue_count)
    values (p_org, caller, 'customer', n);
  end if;

  return n;
end;
$$;

revoke all on function public.delete_customer_data(uuid, text) from public, anon;
grant execute on function public.delete_customer_data(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- How long resolved issues are kept
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column retention_days integer check (retention_days between 30 and 3650);

create function public.set_retention_days(p_org uuid, p_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.is_member(p_org) then
    raise exception 'That company was not found.' using errcode = 'P0002';
  end if;
  if not private.has_role(p_org, array['owner']) then
    raise exception 'Only the company''s owner can change how long issues are kept.' using errcode = 'P0001';
  end if;
  if p_days is not null and p_days not between 30 and 3650 then
    raise exception 'Choose between 30 days and 10 years, or keep issues.' using errcode = '22023';
  end if;

  update public.organizations o set retention_days = p_days, updated_at = now() where o.id = p_org;
  return p_days;
end;
$$;

revoke all on function public.set_retention_days(uuid, integer) from public, anon;
grant execute on function public.set_retention_days(uuid, integer) to authenticated;

-- Deletes resolved issues older than each company's setting (at most 5,000
-- per company per run; the rest go the next day). Database owner only.
create function private.apply_retention()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  org record;
  n integer;
  total integer := 0;
begin
  for org in
    select o.id, o.retention_days from public.organizations o where o.retention_days is not null
  loop
    delete from public.issues i
    where i.id in (
      select x.id from public.issues x
      where x.organization_id = org.id
        and x.status = 'resolved'
        and x.resolved_at < now() - make_interval(days => org.retention_days)
      limit 5000
    );
    get diagnostics n = row_count;
    if n > 0 then
      insert into public.deletion_log (organization_id, deleted_by, kind, issue_count)
      values (org.id, null, 'retention', n);
      total := total + n;
    end if;
  end loop;
  return total;
end;
$$;

revoke all on function private.apply_retention() from public, anon, authenticated;

-- Same as before (20261027150000_scheduler_reliability.sql), plus retention.
create or replace function private.run_daily_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed integer;
  notes integer;
  runs integer;
  kept integer;
begin
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

  kept := private.apply_retention();

  return jsonb_build_object('imports_closed', closed, 'notifications_deleted', notes,
    'check_logs_deleted', runs, 'issues_past_retention_deleted', kept);
end;
$$;

revoke all on function private.run_daily_cleanup() from public, anon, authenticated;
