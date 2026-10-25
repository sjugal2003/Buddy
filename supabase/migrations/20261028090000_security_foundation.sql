-- Phase 7 stage 36: security foundation.
--
-- * Creating a company is by invitation only: only email addresses on Buddy's
--   own list (private.company_creators) can create one. Anyone can still make
--   an account, but without an invitation or a place on the list it can do
--   nothing. Everyone who already owns a company is put on the list, so
--   nothing changes for them.
-- * A limit on AI analyses for the whole of Buddy (all companies together),
--   on top of each company's own monthly limit, so sign-ups can never spend
--   more than the owner of Buddy chose. Default 300 a month.
-- * Tidies a trigger function that still had the default execute grant.
--
-- Both settings live in the private schema, which the app's API cannot reach.
-- Buddy's administrator changes them in the Supabase SQL Editor (see README).

-- ---------------------------------------------------------------------------
-- Settings for the whole of Buddy (exactly one row)
-- ---------------------------------------------------------------------------

create table private.platform_settings (
  id boolean primary key default true check (id),
  ai_monthly_cap integer not null default 300 check (ai_monthly_cap between 0 and 100000),
  updated_at timestamptz not null default now()
);

insert into private.platform_settings (id) values (true);

alter table private.platform_settings enable row level security;
revoke all on private.platform_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may create a company
-- ---------------------------------------------------------------------------

create table private.company_creators (
  email text primary key check (email = lower(email) and char_length(email) between 3 and 254),
  added_at timestamptz not null default now()
);

alter table private.company_creators enable row level security;
revoke all on private.company_creators from public, anon, authenticated;

-- Current company owners keep the ability they already had.
insert into private.company_creators (email)
select distinct lower(u.email)
from auth.users u
join public.organization_members m on m.user_id = u.id and m.role = 'owner'
where u.email is not null
on conflict do nothing;

-- True when the signed-in person's confirmed email is on the list.
create function private.can_create_company(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join private.company_creators c on c.email = lower(u.email)
    where u.id = p_user and u.email_confirmed_at is not null
  );
$$;

revoke all on function private.can_create_company(uuid) from public, anon, authenticated;

-- For the onboarding page: may I create a company?
create function public.can_create_company()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  return private.can_create_company(auth.uid());
end;
$$;

revoke all on function public.can_create_company() from public, anon;
grant execute on function public.can_create_company() to authenticated;

-- Same as before (20261023120100_security.sql), plus the list check.
create or replace function public.create_organization(
  p_name text,
  p_slug text,
  p_industry text default '',
  p_timezone text default 'UTC'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  new_id uuid;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  if not private.can_create_company(caller) then
    raise exception 'Buddy is invite-only for now, so this account can''t create a company. Ask a company owner for an invitation.'
      using errcode = 'P0001';
  end if;

  -- A simple brake on abuse until proper limits arrive with billing.
  if (select count(*) from public.organization_members m
      where m.user_id = caller and m.role = 'owner') >= 10 then
    raise exception 'You already own the maximum of 10 workspaces.' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, slug, industry, timezone, created_by)
  values (p_name, p_slug, coalesce(p_industry, ''), coalesce(p_timezone, 'UTC'), caller)
  returning id into new_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_id, caller, 'owner');

  insert into public.automation_settings (organization_id) values (new_id);

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI limit for the whole of Buddy
-- ---------------------------------------------------------------------------

create index issue_analyses_created_idx on public.issue_analyses (created_at);

-- Same as before (20261024090000_ai_analysis.sql), plus the Buddy-wide limit.
create or replace function public.start_issue_analysis(p_issue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  org public.organizations;
  issue_org uuid;
  used integer;
  cap integer;
  new_id uuid;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  select i.organization_id into issue_org from public.issues i where i.id = p_issue_id;
  if issue_org is null or not private.is_member(issue_org) then
    raise exception 'That issue was not found.' using errcode = 'P0002';
  end if;

  select * into org from public.organizations o where o.id = issue_org for update;

  if not org.ai_enabled then
    raise exception 'AI analysis is turned off for this company.' using errcode = 'P0001';
  end if;

  select count(*) into used
  from public.issue_analyses a
  where a.organization_id = org.id
    and a.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';

  if used >= org.ai_monthly_limit then
    raise exception 'This company has used all % AI analyses for this month.', org.ai_monthly_limit
      using errcode = 'P0001';
  end if;

  -- One request at a time across all companies, so two at once cannot both
  -- take the last analysis of the month.
  perform pg_advisory_xact_lock(hashtext('buddy:ai-monthly-cap'));
  select s.ai_monthly_cap into cap from private.platform_settings s where s.id;
  select count(*) into used
  from public.issue_analyses a
  where a.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';

  if used >= coalesce(cap, 0) then
    raise exception 'Buddy has used all of this month''s AI analyses (a limit for the whole app). It starts again on the 1st of next month.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.issue_analyses a
    where a.issue_id = p_issue_id and a.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Please wait 30 seconds before analysing this issue again.' using errcode = 'P0001';
  end if;

  insert into public.issue_analyses (organization_id, issue_id, requested_by)
  values (org.id, p_issue_id, caller)
  returning id into new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tidying
-- ---------------------------------------------------------------------------

-- A trigger function: only the trigger runs it.
revoke all on function private.create_escalation_settings() from public, anon, authenticated;
