-- Phase 5 stage 26: "Fetch new email".
--
-- An owner or admin presses the button; the server reads new emails from the
-- connected inbox (read-only) and saves each one as an issue through the same
-- public.import_issues as CSV imports, so every email is checked again here
-- and the same email never becomes two issues. Each fetch is an entry in
-- import_runs (source 'gmail'). Nothing here changes existing issues.

-- Where the next fetch starts: the received time of the newest email fetched.
-- It replaces last_history_id from stage 25, which was never used.
alter table public.mailbox_connections add column fetched_until timestamptz;

-- Same as stage 25, except that a different inbox resets fetched_until.
create or replace function public.save_mailbox_connection(p_organization_id uuid, p_email text, p_encrypted_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  email text := lower(trim(coalesce(p_email, '')));
  conn_id uuid;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.has_role(p_organization_id, array['owner']) then
    raise exception 'Only owners can connect an inbox.' using errcode = '42501';
  end if;
  if char_length(email) > 254 or email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Google did not return a valid email address.' using errcode = '22023';
  end if;
  if p_encrypted_token is null or p_encrypted_token not like 'v1:%'
     or char_length(p_encrypted_token) not between 10 and 4000 then
    raise exception 'The sign-in could not be saved.' using errcode = '22023';
  end if;

  -- A different inbox starts afresh; the same one keeps where fetching got to.
  insert into public.mailbox_connections as c (organization_id, email_address, connected_by)
  values (p_organization_id, email, uid)
  on conflict (organization_id) do update
    set email_address = excluded.email_address,
        connected_by = excluded.connected_by,
        connected_at = now(),
        fetched_until = case when c.email_address = excluded.email_address then c.fetched_until end,
        last_fetched_at = case when c.email_address = excluded.email_address then c.last_fetched_at end
  returning id into conn_id;

  insert into public.mailbox_tokens (connection_id, organization_id, encrypted_refresh_token)
  values (conn_id, p_organization_id, p_encrypted_token)
  on conflict (connection_id) do update
    set encrypted_refresh_token = excluded.encrypted_refresh_token, updated_at = now();
  return conn_id;
end;
$$;

alter table public.mailbox_connections drop column last_history_id;

-- Starts a fetch for the company's inbox. Owners and admins only, one fetch at
-- a time per company. Returns what the server needs: the new import's ID, the
-- inbox, where to start, and the encrypted token (useless without the
-- server's key).
create function public.start_gmail_fetch(p_organization_id uuid)
returns table (run_id uuid, email_address text, fetched_until timestamptz, encrypted_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  conn public.mailbox_connections;
  token text;
  new_run uuid;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.has_role(p_organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and admins can fetch email.' using errcode = '42501';
  end if;
  -- Locking the connection makes two presses at once wait for each other.
  select * into conn from public.mailbox_connections c where c.organization_id = p_organization_id for update;
  if not found then
    raise exception 'No Gmail inbox is connected.' using errcode = 'P0002';
  end if;
  select t.encrypted_refresh_token into token from public.mailbox_tokens t where t.connection_id = conn.id;
  if token is null then
    raise exception 'No Gmail inbox is connected.' using errcode = 'P0002';
  end if;

  -- A fetch that never finished (for example the server stopped) is closed after 10 minutes.
  update public.import_runs r
    set status = 'failed', finished_at = now(), error = 'Did not finish.'
    where r.organization_id = p_organization_id and r.source = 'gmail' and r.status = 'running'
      and r.started_at < now() - interval '10 minutes';
  if exists (select 1 from public.import_runs r
             where r.organization_id = p_organization_id and r.source = 'gmail' and r.status = 'running') then
    raise exception 'A fetch is already running. Wait a minute and try again.' using errcode = 'P0001';
  end if;

  insert into public.import_runs (organization_id, source, file_name, started_by)
  values (p_organization_id, 'gmail', conn.email_address, uid)
  returning id into new_run;
  return query select new_run, conn.email_address, conn.fetched_until, token;
end;
$$;

-- Closes a fetch started by the same person. p_fetched_until is the received
-- time of the newest email it saved (or found already saved); the inbox's
-- starting point only ever moves forward. p_error marks the fetch as stopped;
-- emails already saved stay.
create function public.finish_gmail_fetch(p_run_id uuid, p_fetched_until timestamptz, p_error text default null)
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
  select * into run from public.import_runs r where r.id = p_run_id for update;
  if not found or run.source <> 'gmail' or not private.has_role(run.organization_id, array['owner', 'admin']) then
    raise exception 'That fetch was not found.' using errcode = 'P0002';
  end if;
  if run.started_by is distinct from uid then
    raise exception 'Only the person who started this fetch can finish it.' using errcode = '42501';
  end if;
  if run.status <> 'running' then
    raise exception 'This fetch has already finished.' using errcode = 'P0001';
  end if;
  if p_fetched_until > now() + interval '5 minutes' then
    raise exception 'The fetch time is in the future.' using errcode = '22023';
  end if;

  update public.import_runs
    set status = case when p_error is null then 'finished' else 'failed' end,
        finished_at = now(),
        error = left(p_error, 500)
    where id = p_run_id;

  -- Only for the inbox this fetch read: a reconnect to another address in the meantime starts afresh.
  update public.mailbox_connections c
    set fetched_until = case
          when p_fetched_until is null then c.fetched_until
          else greatest(coalesce(c.fetched_until, p_fetched_until), p_fetched_until)
        end,
        last_fetched_at = case when p_error is null then now() else c.last_fetched_at end
    where c.organization_id = run.organization_id and c.email_address = run.file_name;
end;
$$;

revoke all on function public.start_gmail_fetch(uuid) from public, anon;
revoke all on function public.finish_gmail_fetch(uuid, timestamptz, text) from public, anon;
grant execute on function public.start_gmail_fetch(uuid) to authenticated;
grant execute on function public.finish_gmail_fetch(uuid, timestamptz, text) to authenticated;
