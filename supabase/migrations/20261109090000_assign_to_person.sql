-- Assign issues to a person (improvement after D, step 2).
--
-- * issues.assignee_id is the member an issue is given to. A foreign key to
--   organization_members makes sure they belong to the issue's company, and
--   clears it when they leave the company or delete their account.
-- * assignee_name keeps being filled in, from the member's name, so the
--   history, reports and exports work as before. Older issues keep the name
--   that was typed until someone picks a member.
-- * The member gets a notification in Buddy when someone else gives them an
--   issue. The title names only the issue's reference.

alter table public.issues add column assignee_id uuid;
alter table public.issues add constraint issues_assignee_member_fkey
  foreign key (organization_id, assignee_id)
  references public.organization_members (organization_id, user_id) on delete set null (assignee_id);
create index issues_assignee_idx on public.issues (organization_id, assignee_id) where assignee_id is not null;

-- Members change it like the other handling fields; the policy "Members
-- update issue handling" already limits it to their own company's issues.
grant update (assignee_id) on public.issues to authenticated;

-- ---------------------------------------------------------------------------
-- Keep the name in step
-- ---------------------------------------------------------------------------

create function private.issue_set_assignee_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null then
    select left(coalesce(nullif(trim(p.full_name), ''), 'Unnamed member'), 120) into new.assignee_name
    from public.profiles p where p.id = new.assignee_id;
  elsif tg_op = 'UPDATE' and old.assignee_id is not null then
    -- Unassigned, or the member left the company. (A typed name can only replace
    -- a member by unassigning first, so the two never disagree.)
    new.assignee_name := null;
  end if;
  return new;
end;
$$;

revoke all on function private.issue_set_assignee_name() from public, anon, authenticated;

create trigger issue_set_assignee_name before insert or update of assignee_id, assignee_name on public.issues
  for each row execute function private.issue_set_assignee_name();

-- Giving issues to people is limited like other repeated actions.
create trigger issues_assign_rate_limit before update of assignee_id on public.issues
  for each row when (new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id)
  execute function private.enforce_rate_limit('assign', '300', '3600', 'assignments');

-- ---------------------------------------------------------------------------
-- "Assigned to you" notifications
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('escalation', 'urgent_issue', 'import_problem', 'scheduler_failed', 'team_issue',
                  'repeated_problem', 'assigned'));

create function private.notify_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nobody is told about an issue they gave to themselves.
  if new.assignee_id is distinct from auth.uid() then
    perform private.create_notification(
      new.organization_id, new.assignee_id, 'assigned',
      format('%s was assigned to you.', new.reference),
      -- Each assignment is its own event; giving it to the same person again later notifies again.
      format('assigned:%s:%s', new.id, extract(epoch from clock_timestamp())),
      new.id);
  end if;
  return null;
end;
$$;

revoke all on function private.notify_assignee() from public, anon, authenticated;

create trigger issues_notify_assignee after update of assignee_id on public.issues
  for each row when (new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id)
  execute function private.notify_assignee();
