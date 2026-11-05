-- Improvement D, step 1: similar issues and "same problem" links.
--
-- * similar_issues() lists up to 5 issues of the same company whose subject
--   and message look alike, using Postgres's free text-similarity extension
--   (pg_trgm). No AI, nothing leaves the database, nothing is stored. It runs
--   with the caller's own access (security invoker), so Row Level Security
--   decides what it can see.
-- * issues.duplicate_of marks an issue as another report of a main issue in
--   the same company. Links are one level deep: never chains or loops. Only
--   link_duplicate / unlink_duplicate change it, and each writes the history.
--   Linking never changes an issue's status, team, assignee or deadlines.
-- * If the main issue is deleted, its links are cleared.

-- ---------------------------------------------------------------------------
-- Text similarity
-- ---------------------------------------------------------------------------

-- Supabase keeps extensions in the "extensions" schema. If pg_trgm was turned
-- on somewhere else before, move it there so the names below work.
do $$
begin
  if exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname <> 'extensions'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end;
$$;
create extension if not exists pg_trgm with schema extensions;

-- What is compared: the subject, and the subject with the start of the message.
create index issues_subject_trgm_idx on public.issues
  using gin (subject extensions.gin_trgm_ops);
create index issues_text_trgm_idx on public.issues
  using gin ((subject || ' ' || left(message, 500)) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- "Same problem" links
-- ---------------------------------------------------------------------------

alter table public.issues add column duplicate_of uuid;
alter table public.issues add constraint issues_duplicate_not_self check (duplicate_of is distinct from id);
-- The main issue must be in the same company. Deleting it clears only this column.
alter table public.issues add constraint issues_duplicate_of_fkey
  foreign key (organization_id, duplicate_of)
  references public.issues (organization_id, id) on delete set null (duplicate_of);
create index issues_duplicate_of_idx on public.issues (organization_id, duplicate_of)
  where duplicate_of is not null;

-- No new rights: people can read the column with the issue (existing select
-- grant and policy), but only the functions below can change it.

alter table public.issue_activity drop constraint issue_activity_kind_check;
alter table public.issue_activity add constraint issue_activity_kind_check
  check (kind in ('created', 'status_changed', 'team_changed', 'assignee_changed', 'escalated',
                  'ai_analysed', 'ai_accepted',
                  'category_changed', 'first_response', 'resolved', 'reopened',
                  'escalation_acknowledged',
                  'routing_applied', 'routing_dismissed',
                  'duplicate_linked', 'duplicate_unlinked'));

-- Linking and unlinking are limited like other repeated actions.
create trigger issue_activity_duplicate_rate_limit before insert on public.issue_activity
  for each row when (new.kind in ('duplicate_linked', 'duplicate_unlinked'))
  execute function private.enforce_rate_limit('duplicate_link', '200', '3600', '"same problem" changes');

-- ---------------------------------------------------------------------------
-- Similar issues
-- ---------------------------------------------------------------------------

-- Up to 5 issues like p_issue_id, most alike first: open ones, or resolved in
-- the last 30 days. Leaves out the issue itself and the issues already linked
-- with it (its main issue, its reports, and the main issue's other reports).
-- score is between 0 and 1.
create function public.similar_issues(p_issue_id uuid)
returns table (
  id uuid,
  reference text,
  subject text,
  status text,
  received_at timestamptz,
  duplicate_of uuid,
  score real
)
language sql
stable
security invoker
set search_path = ''
set pg_trgm.similarity_threshold = '0.3'
as $$
  with t as (
    select i.id, i.organization_id, i.duplicate_of, i.subject,
           i.subject || ' ' || left(i.message, 500) as body
    from public.issues i
    where i.id = p_issue_id
  )
  select x.id, x.reference, x.subject, x.status, x.received_at, x.duplicate_of,
         greatest(extensions.similarity(x.subject, t.subject),
                  extensions.similarity(x.subject || ' ' || left(x.message, 500), t.body)) as score
  from t
  join public.issues x on x.organization_id = t.organization_id
  where x.id <> t.id
    and (x.status <> 'resolved' or x.resolved_at >= now() - interval '30 days')
    and (x.subject operator(extensions.%) t.subject
         or (x.subject || ' ' || left(x.message, 500)) operator(extensions.%) t.body)
    and x.id is distinct from t.duplicate_of
    and x.duplicate_of is distinct from t.id
    and (t.duplicate_of is null or x.duplicate_of is distinct from t.duplicate_of)
  order by score desc, x.received_at desc, x.id
  limit 5;
$$;

revoke all on function public.similar_issues(uuid) from public, anon;
grant execute on function public.similar_issues(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Link and unlink (any member of the company)
-- ---------------------------------------------------------------------------

-- Marks p_issue_id as another report of p_main_id. If p_main_id is itself a
-- report of another issue, the link goes to that main issue instead, so links
-- stay one level deep. Returns the main issue's reference.
create function public.link_duplicate(p_issue_id uuid, p_main_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  i public.issues;
  m public.issues;
  previous text;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if p_issue_id is null or p_main_id is null or p_issue_id = p_main_id then
    raise exception 'An issue can''t be linked to itself.' using errcode = '22023';
  end if;
  -- Both rows are locked in the same order, so two links at once wait for each other.
  perform 1 from public.issues x where x.id in (p_issue_id, p_main_id) order by x.id for update;

  select * into i from public.issues x where x.id = p_issue_id;
  if i.id is null or not private.is_member(i.organization_id) then
    raise exception 'That issue was not found.' using errcode = 'P0002';
  end if;
  select * into m from public.issues x where x.id = p_main_id and x.organization_id = i.organization_id;
  if m.id is null then
    raise exception 'That issue was not found.' using errcode = 'P0002';
  end if;
  if m.duplicate_of is not null then
    select * into m from public.issues x where x.id = m.duplicate_of for update;
  end if;

  if m.id = i.id then
    raise exception 'That issue is already linked to this one.' using errcode = 'P0001';
  end if;
  if i.duplicate_of is not distinct from m.id then
    raise exception 'This issue is already linked to %.', m.reference using errcode = 'P0001';
  end if;
  if exists (select 1 from public.issues x where x.organization_id = i.organization_id and x.duplicate_of = i.id) then
    raise exception 'Other reports are linked to this issue, so it can''t be linked to another one. Link the other issue to this one instead.'
      using errcode = 'P0001';
  end if;

  select x.reference into previous from public.issues x where x.id = i.duplicate_of;
  update public.issues x set duplicate_of = m.id where x.id = i.id;
  insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
  values (i.organization_id, i.id, uid, 'duplicate_linked', previous, m.reference);
  return m.reference;
end;
$$;

-- Removes the issue's link. Returns false if it had none.
create function public.unlink_duplicate(p_issue_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  i public.issues;
  previous text;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  select * into i from public.issues x where x.id = p_issue_id for update;
  if i.id is null or not private.is_member(i.organization_id) then
    raise exception 'That issue was not found.' using errcode = 'P0002';
  end if;
  if i.duplicate_of is null then
    return false;
  end if;
  select x.reference into previous from public.issues x where x.id = i.duplicate_of;
  update public.issues x set duplicate_of = null where x.id = i.id;
  insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value)
  values (i.organization_id, i.id, uid, 'duplicate_unlinked', previous);
  return true;
end;
$$;

revoke all on function public.link_duplicate(uuid, uuid) from public, anon;
revoke all on function public.unlink_duplicate(uuid) from public, anon;
grant execute on function public.link_duplicate(uuid, uuid) to authenticated;
grant execute on function public.unlink_duplicate(uuid) to authenticated;
