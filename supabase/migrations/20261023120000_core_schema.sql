-- Buddy Phase 2: core tables.
--
-- Every company-owned table carries organization_id. Access rules live in the
-- next migration (security.sql); nothing here is reachable by app users until
-- those rules grant it.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- People and companies
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  -- Used in the URL (/w/<slug>): 3 to 40 lowercase letters, digits or hyphens.
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (char_length(name) between 1 and 100),
  industry text not null default '' check (char_length(industry) <= 100),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  -- First-response targets in hours, per urgency.
  target_hours_critical integer not null default 1 check (target_hours_critical between 1 and 720),
  target_hours_high integer not null default 4 check (target_hours_high between 1 and 720),
  target_hours_medium integer not null default 12 check (target_hours_medium between 1 and 720),
  target_hours_low integer not null default 24 check (target_hours_low between 1 and 720),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_id_idx on public.organization_members (user_id);

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (
    email = lower(email)
    and char_length(email) <= 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  -- Invitations can never create owners.
  role text not null check (role in ('admin', 'member')),
  -- Only a SHA-256 hash of the invite code is stored, never the code itself.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references public.profiles (id) on delete set null default auth.uid(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- At most one open invitation per email per company.
create unique index organization_invitations_open_idx
  on public.organization_invitations (organization_id, email)
  where accepted_at is null;

-- ---------------------------------------------------------------------------
-- Company configuration
-- ---------------------------------------------------------------------------

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  lead_name text not null default '' check (char_length(lead_name) <= 80),
  -- Display only. Nothing is sent to this address in Phase 2.
  email text not null default '' check (char_length(email) <= 254),
  color text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  -- Lets other tables reference (organization_id, id) so links cannot cross companies.
  unique (organization_id, id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

-- ---------------------------------------------------------------------------
-- Customer issues
-- ---------------------------------------------------------------------------

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  reference text not null
    default ('ISS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
    check (char_length(reference) between 1 and 40),
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  channel text not null
    check (channel in ('email', 'live_chat', 'app_review', 'survey', 'social', 'phone_transcript')),
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 1 and 10000),
  received_at timestamptz not null default now(),

  -- Classification. Entered by hand in Phase 2; AI fills it from Phase 3.
  sentiment text not null default 'neutral'
    check (sentiment in ('positive', 'neutral', 'negative', 'very_negative')),
  sentiment_score numeric(3, 2) not null default 0 check (sentiment_score between -1 and 1),
  intent text not null default 'question'
    check (intent in ('complaint', 'question', 'request', 'bug_report', 'cancellation', 'praise')),
  urgency text not null default 'medium' check (urgency in ('low', 'medium', 'high', 'critical')),
  category_id uuid,
  themes text[] not null default '{}' check (cardinality(themes) <= 20),
  summary text not null default '' check (char_length(summary) <= 1000),
  suggested_action text not null default '' check (char_length(suggested_action) <= 1000),
  confidence numeric(3, 2) check (confidence between 0 and 1),
  analysis_source text not null default 'manual' check (analysis_source in ('manual', 'demo', 'ai')),

  -- Handling
  team_id uuid,
  assignee_name text check (char_length(assignee_name) <= 120),
  status text not null default 'new'
    check (status in ('new', 'open', 'in_progress', 'waiting_on_customer', 'escalated', 'resolved')),
  first_response_at timestamptz,
  resolved_at timestamptz,

  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, reference),
  unique (organization_id, id),
  -- The team and category must belong to the same company as the issue.
  -- If the team or category is deleted, only that column is cleared.
  foreign key (organization_id, team_id)
    references public.teams (organization_id, id) on delete set null (team_id),
  foreign key (organization_id, category_id)
    references public.categories (organization_id, id) on delete set null (category_id)
);

create index issues_org_status_idx on public.issues (organization_id, status);
create index issues_org_received_idx on public.issues (organization_id, received_at desc);
create index issues_org_team_idx on public.issues (organization_id, team_id);

-- History of changes. Written only by the trigger below.
create table public.issue_activity (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  issue_id uuid not null,
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null
    check (kind in ('created', 'status_changed', 'team_changed', 'assignee_changed', 'escalated')),
  from_value text,
  to_value text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, issue_id)
    references public.issues (organization_id, id) on delete cascade
);

create index issue_activity_issue_idx on public.issue_activity (issue_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Routing rules and automation
-- ---------------------------------------------------------------------------

-- A rule's conditions: a list of 1 to 20 {"field": ..., "value": "..."} items.
create function private.valid_rule_conditions(conditions jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(conditions) = 'array'
    and jsonb_array_length(conditions) between 1 and 20
    and not exists (
      select 1
      from jsonb_array_elements(conditions) as c (item)
      where jsonb_typeof(c.item) <> 'object'
        or c.item ->> 'field' is null
        or c.item ->> 'field' not in ('category', 'urgency', 'sentiment', 'intent', 'channel', 'keyword')
        or jsonb_typeof(c.item -> 'value') <> 'string'
        or char_length(c.item ->> 'value') not between 1 and 200
    );
$$;

create table public.routing_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  enabled boolean not null default true,
  match_mode text not null default 'any' check (match_mode in ('all', 'any')),
  conditions jsonb not null check (private.valid_rule_conditions(conditions)),
  team_id uuid not null,
  -- Lower numbers are checked first.
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A team that rules point at cannot be deleted until the rules change.
  foreign key (organization_id, team_id) references public.teams (organization_id, id)
);

create index routing_rules_org_position_idx on public.routing_rules (organization_id, position);

-- One row per company. Escalation and notification rules stay as JSON lists
-- (checked by the server) until Phases 4 and 6 build the engines that run them.
create table public.automation_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  analysis_schedule text not null default 'hourly'
    check (analysis_schedule in ('every_15_min', 'hourly', 'every_6_hours', 'daily')),
  escalation_rules jsonb not null default '[]'
    check (jsonb_typeof(escalation_rules) = 'array' and jsonb_array_length(escalation_rules) <= 50),
  notification_rules jsonb not null default '[]'
    check (jsonb_typeof(notification_rules) = 'array' and jsonb_array_length(notification_rules) <= 50),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.teams
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.categories
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.issues
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.routing_rules
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.automation_settings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Issue bookkeeping: resolved_at and the activity history
-- ---------------------------------------------------------------------------

create function private.issue_set_resolved_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status is distinct from 'resolved') then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create trigger issue_set_resolved_at before insert or update of status on public.issues
  for each row execute function private.issue_set_resolved_at();

create function private.team_name(team uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select t.name from public.teams t where t.id = team), 'Unassigned');
$$;

-- Runs as the table owner so app users never need (or get) insert rights on
-- issue_activity. Team names are copied so history stays readable if a team
-- is renamed or deleted later.
create function private.issue_record_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, to_value)
    values (new.organization_id, new.id, actor, 'created', new.status);
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
    values (new.organization_id, new.id, actor, 'status_changed', old.status, new.status);
  end if;

  if new.team_id is distinct from old.team_id then
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
    values (new.organization_id, new.id, actor, 'team_changed',
            private.team_name(old.team_id), private.team_name(new.team_id));
  end if;

  if new.assignee_name is distinct from old.assignee_name then
    insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
    values (new.organization_id, new.id, actor, 'assignee_changed', old.assignee_name, new.assignee_name);
  end if;

  return null;
end;
$$;

create trigger issue_record_activity after insert or update on public.issues
  for each row execute function private.issue_record_activity();

-- ---------------------------------------------------------------------------
-- Create a profile for every new sign-up
-- ---------------------------------------------------------------------------

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
