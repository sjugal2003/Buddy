-- Phase 5 stage 22: where issues come from, the customer's email address, and
-- the import log. Imports (CSV in stage 23, Gmail later) only add issues
-- through public.import_issues, which owners and admins run for their own
-- company. Nothing here changes or deletes existing rows: existing issues
-- become source 'manual' with no email address.

-- ---------------------------------------------------------------------------
-- Import log
-- ---------------------------------------------------------------------------

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null check (source in ('csv', 'gmail')),
  -- The uploaded file's name, for people to recognise the import. The file itself is never stored.
  file_name text not null default '' check (char_length(file_name) <= 200),
  started_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'finished', 'failed')),
  rows_examined integer not null default 0 check (rows_examined >= 0),
  imported integer not null default 0 check (imported >= 0),
  skipped_duplicate integer not null default 0 check (skipped_duplicate >= 0),
  rejected integer not null default 0 check (rejected >= 0),
  -- Rejected rows: row number and reason only, never the customer's text. At most 500 kept.
  problems jsonb not null default '[]'
    check (jsonb_typeof(problems) = 'array' and jsonb_array_length(problems) <= 500),
  error text check (char_length(error) <= 500),
  unique (id, organization_id)
);

create index import_runs_org_idx on public.import_runs (organization_id, started_at desc);

revoke all on public.import_runs from anon, authenticated;
grant select on public.import_runs to authenticated;
alter table public.import_runs enable row level security;

create policy "Members see their company's imports" on public.import_runs
  for select to authenticated
  using (private.is_member(organization_id));

-- ---------------------------------------------------------------------------
-- Issues: source and customer email
-- ---------------------------------------------------------------------------

alter table public.issues
  add column source text not null default 'manual' check (source in ('manual', 'csv', 'gmail')),
  -- The record's ID in its source (a CSV ID column, a Gmail message ID, or a fingerprint).
  add column source_record_id text check (char_length(source_record_id) between 1 and 200),
  add column import_run_id uuid,
  add column customer_email text check (
    customer_email is null or (
      customer_email = lower(customer_email)
      and char_length(customer_email) <= 254
      and customer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  ),
  -- Imported issues always say which record they came from; typed-in ones never do.
  add constraint issues_source_record_check check ((source = 'manual') = (source_record_id is null)),
  -- An import run of the same company; deleting a run (only with its company) keeps the issue.
  add constraint issues_import_run_fkey foreign key (import_run_id, organization_id)
    references public.import_runs (id, organization_id) on delete set null (import_run_id);

-- The same source record can only become one issue per company, even when two
-- imports run at the same moment.
create unique index issues_source_record_idx
  on public.issues (organization_id, source, source_record_id)
  where source_record_id is not null;

-- Members may type an email address on a new issue. Source fields are set only
-- by import_issues; nobody changes what the customer sent afterwards.
grant insert (customer_email) on public.issues to authenticated;

-- ---------------------------------------------------------------------------
-- Import functions (owners and admins, own company only)
-- ---------------------------------------------------------------------------

create function public.start_import(p_organization_id uuid, p_source text, p_file_name text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  run_id uuid;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.has_role(p_organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and admins can import issues.' using errcode = '42501';
  end if;
  -- Gmail fetches get their own entry point with the mailbox connection (stage 26).
  if p_source is distinct from 'csv' then
    raise exception 'That import type is not available yet.' using errcode = '22023';
  end if;
  insert into public.import_runs (organization_id, source, file_name, started_by)
  values (p_organization_id, p_source, left(coalesce(trim(p_file_name), ''), 200), uid)
  returning id into run_id;
  return run_id;
end;
$$;

-- Adds up to 500 rows to a running import. Each row is checked here again,
-- whatever the browser already checked. Returns one outcome per row:
-- {"row": n, "outcome": "imported" | "duplicate" | "rejected", "reason"?, "issue_id"?}.
-- p_as_history: the rows are past conversations, saved as resolved at the time
-- they were received, so they never show as missed targets or get escalated.
create function public.import_issues(p_run_id uuid, p_rows jsonb, p_as_history boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  run public.import_runs;
  r jsonb;
  results jsonb := '[]';
  new_problems jsonb := '[]';
  row_no integer;
  v_name text;
  v_email text;
  v_channel text;
  v_subject text;
  v_message text;
  v_received timestamptz;
  v_record text;
  reason text;
  new_id uuid;
  n_imported integer := 0;
  n_duplicate integer := 0;
  n_rejected integer := 0;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  select * into run from public.import_runs where id = p_run_id for update;
  if not found or not private.has_role(run.organization_id, array['owner', 'admin']) then
    raise exception 'That import was not found.' using errcode = 'P0002';
  end if;
  if run.started_by is distinct from uid then
    raise exception 'Only the person who started this import can add to it.' using errcode = '42501';
  end if;
  if run.status <> 'running' then
    raise exception 'This import has already finished. Start a new one.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Send between 1 and 500 rows at a time.' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) <> 'object' then
      n_rejected := n_rejected + 1;
      results := results || jsonb_build_object('row', null, 'outcome', 'rejected', 'reason', 'The row is not readable.');
      continue;
    end if;
    row_no := case when jsonb_typeof(r -> 'row') = 'number' then (r ->> 'row')::numeric::integer end;
    v_name := trim(coalesce(r ->> 'customer_name', ''));
    v_email := nullif(lower(trim(coalesce(r ->> 'customer_email', ''))), '');
    v_channel := coalesce(r ->> 'channel', '');
    v_subject := trim(coalesce(r ->> 'subject', ''));
    v_message := trim(coalesce(r ->> 'message', ''));
    v_record := nullif(trim(coalesce(r ->> 'record_id', '')), '');
    v_received := null;
    reason := null;

    begin
      v_received := (r ->> 'received_at')::timestamptz;
    exception when others then
      reason := 'The received time is not a date.';
    end;

    if reason is not null then
      null;
    elsif row_no is null or row_no < 1 then
      reason := 'The row number is missing.';
    elsif v_message = '' then
      reason := 'The message is empty.';
    elsif char_length(v_message) > 10000 then
      reason := 'The message is longer than 10,000 characters.';
    elsif v_name = '' then
      reason := 'The customer name is empty.';
    elsif char_length(v_name) > 120 then
      reason := 'The customer name is longer than 120 characters.';
    elsif v_subject = '' then
      reason := 'The subject is empty.';
    elsif char_length(v_subject) > 200 then
      reason := 'The subject is longer than 200 characters.';
    elsif v_channel not in ('email', 'live_chat', 'app_review', 'survey', 'social', 'phone_transcript') then
      reason := 'The channel is not one Buddy knows.';
    elsif v_email is not null and (char_length(v_email) > 254
          or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      reason := 'The email address is not valid.';
    elsif v_received is null then
      reason := 'The received time is missing.';
    elsif v_received > now() + interval '5 minutes' then
      reason := 'The received time is in the future.';
    elsif v_record is not null and char_length(v_record) > 200 then
      reason := 'The ID is longer than 200 characters.';
    end if;

    if reason is not null then
      n_rejected := n_rejected + 1;
      results := results || jsonb_build_object('row', row_no, 'outcome', 'rejected', 'reason', reason);
      if jsonb_array_length(new_problems) + jsonb_array_length(run.problems) < 500 then
        new_problems := new_problems || jsonb_build_object('row', row_no, 'reason', reason);
      end if;
      continue;
    end if;

    -- Without an ID column the record is known by who wrote what, when.
    if v_record is null then
      v_record := 'fp:' || encode(sha256(convert_to(
        lower(v_name) || chr(31) || to_char(v_received at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || chr(31) || v_message,
        'UTF8')), 'hex');
    end if;

    new_id := null;
    insert into public.issues (organization_id, customer_name, customer_email, channel, subject, message,
                               received_at, status, created_by, source, source_record_id, import_run_id)
    values (run.organization_id, v_name, v_email, v_channel, v_subject, v_message,
            v_received, case when p_as_history then 'resolved' else 'new' end, uid,
            run.source, v_record, run.id)
    on conflict (organization_id, source, source_record_id) where source_record_id is not null do nothing
    returning id into new_id;

    if new_id is null then
      n_duplicate := n_duplicate + 1;
      results := results || jsonb_build_object('row', row_no, 'outcome', 'duplicate');
    else
      if p_as_history then
        -- Resolved when it happened, not today, so this week's numbers stay true.
        update public.issues set resolved_at = v_received where id = new_id;
      end if;
      n_imported := n_imported + 1;
      results := results || jsonb_build_object('row', row_no, 'outcome', 'imported', 'issue_id', new_id);
    end if;
  end loop;

  update public.import_runs
    set rows_examined = rows_examined + jsonb_array_length(p_rows),
        imported = imported + n_imported,
        skipped_duplicate = skipped_duplicate + n_duplicate,
        rejected = rejected + n_rejected,
        problems = run.problems || new_problems
    where id = p_run_id;
  return results;
end;
$$;

-- Closes an import. p_error marks it failed (for example the browser could not
-- send every piece); the rows already saved stay, and the counts say how many.
create function public.finish_import(p_run_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  run public.import_runs;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  select * into run from public.import_runs where id = p_run_id for update;
  if not found or not private.has_role(run.organization_id, array['owner', 'admin']) then
    raise exception 'That import was not found.' using errcode = 'P0002';
  end if;
  if run.status <> 'running' then
    raise exception 'This import has already finished.' using errcode = 'P0001';
  end if;
  update public.import_runs
    set status = case when p_error is null then 'finished' else 'failed' end,
        finished_at = now(),
        error = left(p_error, 500)
    where id = p_run_id;
end;
$$;

revoke all on function public.start_import(uuid, text, text) from public, anon;
revoke all on function public.import_issues(uuid, jsonb, boolean) from public, anon;
revoke all on function public.finish_import(uuid, text) from public, anon;
grant execute on function public.start_import(uuid, text, text) to authenticated;
grant execute on function public.import_issues(uuid, jsonb, boolean) to authenticated;
grant execute on function public.finish_import(uuid, text) to authenticated;
