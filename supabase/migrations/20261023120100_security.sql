-- Buddy Phase 2: who can see and change what.
--
-- Three layers:
--   1. Table privileges: an allowlist of what signed-in users may do at all
--      (for example, members may only update an issue's handling columns).
--      Signed-out visitors (anon) get nothing.
--   2. Row Level Security: which rows, based on organisation membership.
--   3. Functions for membership changes, so nobody can write memberships
--      directly or grant themselves a role.

-- ---------------------------------------------------------------------------
-- Membership helpers (private schema: not callable through the public API)
-- ---------------------------------------------------------------------------

-- security definer: reads organization_members without going through its own
-- RLS policy, which would otherwise call this function again.
create function private.is_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  );
$$;

create function private.has_role(org uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = any (roles)
  );
$$;

-- True when the signed-in user and another user belong to a common company.
create function private.shares_org_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.has_role(uuid, text[]) to authenticated;
grant execute on function private.shares_org_with(uuid) to authenticated;
-- Used by the check constraint on routing_rules.conditions.
grant execute on function private.valid_rule_conditions(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Table privileges (allowlist)
-- ---------------------------------------------------------------------------

revoke all on
  public.profiles, public.organizations, public.organization_members,
  public.organization_invitations, public.teams, public.categories, public.issues,
  public.issue_activity, public.routing_rules, public.automation_settings
from anon, authenticated;

grant select on
  public.profiles, public.organizations, public.organization_members,
  public.organization_invitations, public.teams, public.categories, public.issues,
  public.issue_activity, public.routing_rules, public.automation_settings
to authenticated;

grant update (full_name) on public.profiles to authenticated;

grant update (name, industry, timezone,
              target_hours_critical, target_hours_high, target_hours_medium, target_hours_low)
  on public.organizations to authenticated;

grant insert (organization_id, email, role, token_hash, invited_by) on public.organization_invitations to authenticated;
grant delete on public.organization_invitations to authenticated;

grant insert (organization_id, name, lead_name, email, color) on public.teams to authenticated;
grant update (name, lead_name, email, color) on public.teams to authenticated;
grant delete on public.teams to authenticated;

grant insert (organization_id, name) on public.categories to authenticated;
grant update (name) on public.categories to authenticated;
grant delete on public.categories to authenticated;

grant insert (organization_id, reference, customer_name, channel, subject, message, received_at,
              sentiment, sentiment_score, intent, urgency, category_id, themes, summary,
              suggested_action, team_id, assignee_name, status, created_by)
  on public.issues to authenticated;
-- Members may change how an issue is handled, never what the customer wrote.
grant update (status, team_id, assignee_name, first_response_at) on public.issues to authenticated;
grant delete on public.issues to authenticated;

grant insert (organization_id, name, enabled, match_mode, conditions, team_id, position)
  on public.routing_rules to authenticated;
grant update (name, enabled, match_mode, conditions, team_id, position) on public.routing_rules to authenticated;
grant delete on public.routing_rules to authenticated;

grant update (analysis_schedule, escalation_rules, notification_rules) on public.automation_settings to authenticated;

-- organization_members and issue_activity: read-only for users. Memberships
-- change only through the functions in section 3; activity only through the
-- issue trigger.

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.teams enable row level security;
alter table public.categories enable row level security;
alter table public.issues enable row level security;
alter table public.issue_activity enable row level security;
alter table public.routing_rules enable row level security;
alter table public.automation_settings enable row level security;

-- profiles
create policy "See yourself and people in your companies" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.shares_org_with(id));
create policy "Edit your own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- organizations
create policy "Members see their company" on public.organizations
  for select to authenticated
  using (private.is_member(id));
create policy "Owners and admins edit the company profile" on public.organizations
  for update to authenticated
  using (private.has_role(id, array['owner', 'admin']))
  with check (private.has_role(id, array['owner', 'admin']));

-- organization_members
create policy "Members see who is in their company" on public.organization_members
  for select to authenticated
  using (private.is_member(organization_id));

-- organization_invitations
create policy "Owners and admins see invitations" on public.organization_invitations
  for select to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));
create policy "Owners and admins invite" on public.organization_invitations
  for insert to authenticated
  with check (
    private.has_role(organization_id, array['owner', 'admin'])
    and invited_by = (select auth.uid())
  );
create policy "Owners and admins cancel invitations" on public.organization_invitations
  for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));

-- teams
create policy "Members see teams" on public.teams
  for select to authenticated
  using (private.is_member(organization_id));
create policy "Owners and admins add teams" on public.teams
  for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin']));
create policy "Owners and admins edit teams" on public.teams
  for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']))
  with check (private.has_role(organization_id, array['owner', 'admin']));
create policy "Owners and admins delete teams" on public.teams
  for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));

-- categories
create policy "Members see categories" on public.categories
  for select to authenticated
  using (private.is_member(organization_id));
create policy "Owners and admins add categories" on public.categories
  for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin']));
create policy "Owners and admins edit categories" on public.categories
  for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']))
  with check (private.has_role(organization_id, array['owner', 'admin']));
create policy "Owners and admins delete categories" on public.categories
  for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));

-- issues
create policy "Members see issues" on public.issues
  for select to authenticated
  using (private.is_member(organization_id));
create policy "Members create issues" on public.issues
  for insert to authenticated
  with check (
    private.is_member(organization_id)
    and created_by = (select auth.uid())
    -- Only the server's AI step (Phase 3) may label an issue as analysed.
    and analysis_source = 'manual'
  );
create policy "Members update issue handling" on public.issues
  for update to authenticated
  using (private.is_member(organization_id))
  with check (private.is_member(organization_id));
create policy "Owners and admins delete issues" on public.issues
  for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));

-- issue_activity
create policy "Members see issue history" on public.issue_activity
  for select to authenticated
  using (private.is_member(organization_id));

-- routing_rules
create policy "Members see routing rules" on public.routing_rules
  for select to authenticated
  using (private.is_member(organization_id));
create policy "Owners and admins add routing rules" on public.routing_rules
  for insert to authenticated
  with check (private.has_role(organization_id, array['owner', 'admin']));
create policy "Owners and admins edit routing rules" on public.routing_rules
  for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']))
  with check (private.has_role(organization_id, array['owner', 'admin']));
create policy "Owners and admins delete routing rules" on public.routing_rules
  for delete to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']));

-- automation_settings
create policy "Members see automation settings" on public.automation_settings
  for select to authenticated
  using (private.is_member(organization_id));
create policy "Owners and admins edit automation settings" on public.automation_settings
  for update to authenticated
  using (private.has_role(organization_id, array['owner', 'admin']))
  with check (private.has_role(organization_id, array['owner', 'admin']));

create function private.automation_set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger automation_set_updated_by before update on public.automation_settings
  for each row execute function private.automation_set_updated_by();

-- ---------------------------------------------------------------------------
-- 3. Membership functions (the only way memberships change)
-- ---------------------------------------------------------------------------

-- Create a company. The caller becomes its only owner.
create function public.create_organization(
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

-- Accept an invitation with the code from the invite link. Works only for the
-- invited email address, after that address has been confirmed.
create function public.accept_invitation(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
  caller_confirmed timestamptz;
  invite public.organization_invitations;
  org_slug text;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  select lower(u.email), u.email_confirmed_at into caller_email, caller_confirmed
  from auth.users u where u.id = caller;

  if caller_confirmed is null then
    raise exception 'Confirm your email address before accepting an invitation.' using errcode = '42501';
  end if;

  select * into invite
  from public.organization_invitations i
  where i.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and i.accepted_at is null
    and i.expires_at > now()
  for update;

  if invite.id is null then
    raise exception 'This invitation is not valid or has expired.' using errcode = 'P0002';
  end if;

  if invite.email <> caller_email then
    raise exception 'This invitation was sent to a different email address.' using errcode = '42501';
  end if;

  -- Someone already in the company keeps their current role.
  insert into public.organization_members (organization_id, user_id, role)
  values (invite.organization_id, caller, invite.role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations
  set accepted_at = now(), accepted_by = caller
  where id = invite.id;

  select o.slug into org_slug from public.organizations o where o.id = invite.organization_id;
  return org_slug;
end;
$$;

-- Change another member's role. Owners only, and never your own role, so a
-- company always keeps at least one owner.
create function public.set_member_role(p_organization_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not private.has_role(p_organization_id, array['owner']) then
    raise exception 'Only an owner can change roles.' using errcode = '42501';
  end if;
  if p_user_id = caller then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('owner', 'admin', 'member') then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;

  update public.organization_members
  set role = p_role
  where organization_id = p_organization_id and user_id = p_user_id;

  if not found then
    raise exception 'That person is not a member of this workspace.' using errcode = 'P0002';
  end if;
end;
$$;

-- Remove a member, or leave a company yourself.
--   Owners can remove anyone else. Admins can remove admins and members.
--   Anyone can leave, except the last owner.
create function public.remove_member(p_organization_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  target_role text;
begin
  if caller is null or not private.is_member(p_organization_id) then
    raise exception 'You are not a member of this workspace.' using errcode = '42501';
  end if;

  select m.role into target_role
  from public.organization_members m
  where m.organization_id = p_organization_id and m.user_id = p_user_id
  for update;

  if target_role is null then
    raise exception 'That person is not a member of this workspace.' using errcode = 'P0002';
  end if;

  if p_user_id = caller then
    if target_role = 'owner' and (
      select count(*) from public.organization_members m
      where m.organization_id = p_organization_id and m.role = 'owner'
    ) = 1 then
      raise exception 'Make someone else an owner before you leave.' using errcode = '42501';
    end if;
  elsif private.has_role(p_organization_id, array['owner']) then
    null;
  elsif private.has_role(p_organization_id, array['admin']) and target_role <> 'owner' then
    null;
  else
    raise exception 'You do not have permission to remove this member.' using errcode = '42501';
  end if;

  delete from public.organization_members
  where organization_id = p_organization_id and user_id = p_user_id;
end;
$$;

revoke all on function public.create_organization(text, text, text, text) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.create_organization(text, text, text, text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
