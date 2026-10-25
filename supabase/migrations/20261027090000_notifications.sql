-- Phase 6 stage 29: in-app notifications (foundation).
--
-- One row per person who should see a notification. Only the database creates
-- them (through private.create_notification, used by later stages), so the
-- browser cannot fake one or address one to somebody else. A person sees only
-- their own notifications, for companies they still belong to, and can only
-- mark their own as read. Notifications hold a short label and an optional
-- link to an issue of the same company, never the customer's message or
-- email address. Nothing is sent outside Buddy.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('escalation', 'urgent_issue', 'import_problem', 'scheduler_failed')),
  -- A short label written by Buddy, for example "Issue escalated: no first response".
  title text not null check (char_length(title) between 1 and 200),
  issue_id uuid,
  -- The same event never notifies the same person twice (for example the escalation's ID).
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, dedupe_key),
  -- The issue must belong to the same company; deleting it deletes its notifications.
  foreign key (organization_id, issue_id) references public.issues (organization_id, id) on delete cascade
);

create index notifications_recipient_idx on public.notifications (recipient_id, organization_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id, organization_id) where read_at is null;
create index notifications_issue_idx on public.notifications (organization_id, issue_id) where issue_id is not null;

-- Read-only from the app: no inserts, updates or deletes, only the functions below.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
alter table public.notifications enable row level security;

create policy "People see their own notifications" on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()) and private.is_member(organization_id));

-- ---------------------------------------------------------------------------
-- Marking as read (own notifications only)
-- ---------------------------------------------------------------------------

-- Returns when it was read. A notification that is not the caller's gives the
-- same "not found" as one that does not exist.
create function public.mark_notification_read(p_notification_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n public.notifications;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  select * into n from public.notifications x
    where x.id = p_notification_id and x.recipient_id = uid for update;
  if not found or not private.is_member(n.organization_id) then
    raise exception 'That notification was not found.' using errcode = 'P0002';
  end if;
  if n.read_at is not null then
    return n.read_at;
  end if;
  update public.notifications set read_at = now() where id = n.id returning read_at into n.read_at;
  return n.read_at;
end;
$$;

-- Marks all of the caller's unread notifications in one company as read and
-- returns how many changed.
create function public.mark_all_notifications_read(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  changed integer;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.is_member(p_organization_id) then
    raise exception 'That workspace was not found.' using errcode = 'P0002';
  end if;
  update public.notifications set read_at = now()
    where recipient_id = uid and organization_id = p_organization_id and read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_notifications_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Creating notifications (database only)
-- ---------------------------------------------------------------------------

-- For the events added in later stages (escalations, urgent issues, import
-- problems, scheduler failures). Not callable from the app. Skips a recipient
-- who is not a member of the company, and a repeat of the same dedupe key.
-- Returns the new notification's ID, or null when nothing was added.
create function private.create_notification(
  p_organization_id uuid,
  p_recipient_id uuid,
  p_kind text,
  p_title text,
  p_dedupe_key text,
  p_issue_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not exists (select 1 from public.organization_members m
                 where m.organization_id = p_organization_id and m.user_id = p_recipient_id) then
    return null;
  end if;
  insert into public.notifications (organization_id, recipient_id, kind, title, issue_id, dedupe_key)
  values (p_organization_id, p_recipient_id, p_kind, left(trim(p_title), 200), p_issue_id, p_dedupe_key)
  on conflict (recipient_id, dedupe_key) do nothing
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function private.create_notification(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
