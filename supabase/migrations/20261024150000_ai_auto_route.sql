-- Phase 3 stage 14: optional automatic routing after AI analysis.
--
-- Off by default. When an owner switches it on, Buddy gives a newly analysed
-- issue that has no team yet the team its first matching routing rule names.
-- The team change itself is an ordinary issue update made with the user's
-- own session, so the existing issue rules and history apply unchanged.

alter table public.organizations
  add column ai_auto_route boolean not null default false;

-- The "Owners and admins edit the company profile" policy lets admins update
-- the row; the trigger below narrows this one column to owners.
grant update (ai_auto_route) on public.organizations to authenticated;

create function private.only_owner_sets_auto_route()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- auth.uid() is empty only for direct database access (migrations, admin
  -- tools), never for a request from the app.
  if new.ai_auto_route is distinct from old.ai_auto_route
     and (select auth.uid()) is not null
     and not private.has_role(new.id, array['owner']) then
    raise exception 'Only an owner can change automatic routing.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger organizations_only_owner_sets_auto_route
  before update of ai_auto_route on public.organizations
  for each row execute function private.only_owner_sets_auto_route();
