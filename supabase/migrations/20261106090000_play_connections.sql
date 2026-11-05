-- Improvement B, step 1: each company can connect its own Google Play app and
-- fetch its recent reviews (read-only) as issues.
--
-- * public.source_connections says which app is connected, by whom and when.
--   Every member of the company can see it; nobody writes to it directly.
--   One connection per kind per company. 'google_play' is the only kind.
-- * public.source_credentials holds the company's Google service-account key,
--   already encrypted by Buddy's server (AES-256-GCM, GMAIL_TOKEN_KEY). Nobody
--   can read or write it directly; only the functions below reach it, and the
--   one that hands it back also needs Buddy's server key (BUDDY_AI_RESULT_KEY).
-- * Reviews are saved through public.import_issues, like CSV rows and Gmail
--   messages, so each one is checked again here and the same review never
--   becomes two issues. Each fetch is an entry in import_runs, counted in the
--   existing limit of 30 imports and fetches an hour.
-- * Nothing here can post, reply to or change a review.

-- ---------------------------------------------------------------------------
-- Where issues can come from
-- ---------------------------------------------------------------------------

alter table public.import_runs drop constraint import_runs_source_check;
alter table public.import_runs add constraint import_runs_source_check
  check (source in ('csv', 'gmail', 'google_play'));

alter table public.issues drop constraint issues_source_check;
alter table public.issues add constraint issues_source_check
  check (source in ('manual', 'csv', 'gmail', 'google_play'));

-- ---------------------------------------------------------------------------
-- Connections and their keys
-- ---------------------------------------------------------------------------

create table public.source_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('google_play')),
  -- The app's package name, for example com.example.shop.
  package_name text not null check (
    char_length(package_name) <= 150
    and package_name ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'
  ),
  -- The Google service account Buddy signs in as. Not a secret: it is shown
  -- so the owner can check it matches the one given access in Play Console.
  account_email text not null check (
    account_email = lower(account_email)
    and char_length(account_email) <= 254
    and account_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz not null default now(),
  last_fetched_at timestamptz,
  unique (organization_id, kind),
  unique (id, organization_id)
);

revoke all on public.source_connections from anon, authenticated;
grant select on public.source_connections to authenticated;
alter table public.source_connections enable row level security;

create policy "Members see their company's connections" on public.source_connections
  for select to authenticated
  using (private.is_member(organization_id));

-- Each connect checks the key with Google, so it is limited like other repeated actions.
create trigger source_connections_rate_limit before insert on public.source_connections
  for each row execute function private.enforce_rate_limit('source_connect', '20', '3600', 'connection changes');

create table public.source_credentials (
  connection_id uuid primary key,
  organization_id uuid not null,
  -- "v1:<iv>:<tag>:<ciphertext>" from the server's AES-256-GCM encryption.
  encrypted_credential text not null check (
    char_length(encrypted_credential) between 10 and 8000 and encrypted_credential like 'v1:%'
  ),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.source_connections (id, organization_id) on delete cascade
);

-- No rights and no policies: only the security-definer functions below reach it.
revoke all on public.source_credentials from anon, authenticated;
alter table public.source_credentials enable row level security;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Like private.check_server_key_for_gmail, with a message about Google Play.
create function private.check_server_key_for_sources(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  expected text;
begin
  select s.ai_result_key_hash into expected from private.platform_settings s where s.id;
  if expected is null or p_key is null or encode(sha256(convert_to(p_key, 'UTF8')), 'hex') <> expected then
    raise exception 'Google Play can''t be used: this server''s BUDDY_AI_RESULT_KEY is missing or does not match the one set up in the database (see the README).'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.check_server_key_for_sources(text) from public, anon, authenticated;

-- Connects (or replaces) the company's Google Play app. Owners only. The
-- server has already checked the key with Google before calling this.
create function public.save_source_connection(
  p_organization_id uuid,
  p_kind text,
  p_package_name text,
  p_account_email text,
  p_encrypted_credential text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  package text := trim(coalesce(p_package_name, ''));
  account text := lower(trim(coalesce(p_account_email, '')));
  conn_id uuid;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.has_role(p_organization_id, array['owner']) then
    raise exception 'Only owners can connect Google Play.' using errcode = '42501';
  end if;
  if p_kind is distinct from 'google_play' then
    raise exception 'That kind of connection is not available.' using errcode = '22023';
  end if;
  if char_length(package) > 150 or package !~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$' then
    raise exception 'Enter the app''s package name, for example com.example.shop.' using errcode = '22023';
  end if;
  if char_length(account) > 254 or account !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'The service account key has no valid account address.' using errcode = '22023';
  end if;
  if p_encrypted_credential is null or p_encrypted_credential not like 'v1:%'
     or char_length(p_encrypted_credential) not between 10 and 8000 then
    raise exception 'The key could not be saved.' using errcode = '22023';
  end if;

  insert into public.source_connections as c (organization_id, kind, package_name, account_email, connected_by)
  values (p_organization_id, p_kind, package, account, uid)
  on conflict (organization_id, kind) do update
    set package_name = excluded.package_name,
        account_email = excluded.account_email,
        connected_by = excluded.connected_by,
        connected_at = now(),
        -- Another app starts afresh.
        last_fetched_at = case when c.package_name = excluded.package_name then c.last_fetched_at end
  returning id into conn_id;

  insert into public.source_credentials (connection_id, organization_id, encrypted_credential)
  values (conn_id, p_organization_id, p_encrypted_credential)
  on conflict (connection_id) do update
    set encrypted_credential = excluded.encrypted_credential, updated_at = now();
  return conn_id;
end;
$$;

-- Removes the connection and deletes its key. Owners only. Issues already fetched stay.
create function public.disconnect_source(p_organization_id uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_role(p_organization_id, array['owner']) then
    raise exception 'Only owners can disconnect Google Play.' using errcode = '42501';
  end if;
  delete from public.source_connections where organization_id = p_organization_id and kind = p_kind;
  return found;
end;
$$;

-- Starts a fetch for the company's connection. Owners and admins only, one
-- fetch at a time per company and kind. Returns the new import's ID, the
-- package name and the encrypted key (useless without the server's key).
create function public.start_source_fetch(p_organization_id uuid, p_kind text, p_server_key text)
returns table (run_id uuid, package_name text, encrypted_credential text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  conn public.source_connections;
  credential text;
  new_run uuid;
begin
  if uid is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if not private.has_role(p_organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and admins can fetch reviews.' using errcode = '42501';
  end if;
  perform private.check_server_key_for_sources(p_server_key);
  -- Locking the connection makes two presses at once wait for each other.
  select * into conn from public.source_connections c
    where c.organization_id = p_organization_id and c.kind = p_kind for update;
  if not found then
    raise exception 'Google Play is not connected.' using errcode = 'P0002';
  end if;
  select t.encrypted_credential into credential from public.source_credentials t where t.connection_id = conn.id;
  if credential is null then
    raise exception 'Google Play is not connected.' using errcode = 'P0002';
  end if;

  -- A fetch that never finished (for example the server stopped) is closed after 10 minutes.
  update public.import_runs r
    set status = 'failed', finished_at = now(), error = 'Did not finish.'
    where r.organization_id = p_organization_id and r.source = conn.kind and r.status = 'running'
      and r.started_at < now() - interval '10 minutes';
  if exists (select 1 from public.import_runs r
             where r.organization_id = p_organization_id and r.source = conn.kind and r.status = 'running') then
    raise exception 'A fetch is already running. Wait a minute and try again.' using errcode = 'P0001';
  end if;

  insert into public.import_runs (organization_id, source, file_name, started_by)
  values (p_organization_id, conn.kind, conn.package_name, uid)
  returning id into new_run;
  return query select new_run, conn.package_name, credential;
end;
$$;

-- Closes a fetch started by the same person. p_error marks it as stopped;
-- reviews already saved stay.
create function public.finish_source_fetch(p_run_id uuid, p_error text default null)
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
  if not found or run.source <> 'google_play' or not private.has_role(run.organization_id, array['owner', 'admin']) then
    raise exception 'That fetch was not found.' using errcode = 'P0002';
  end if;
  if run.started_by is distinct from uid then
    raise exception 'Only the person who started this fetch can finish it.' using errcode = '42501';
  end if;
  if run.status <> 'running' then
    raise exception 'This fetch has already finished.' using errcode = 'P0001';
  end if;

  update public.import_runs
    set status = case when p_error is null then 'finished' else 'failed' end,
        finished_at = now(),
        error = left(p_error, 500)
    where id = p_run_id;

  -- Only for the app this fetch read: a reconnect to another app in the meantime starts afresh.
  if p_error is null then
    update public.source_connections c
      set last_fetched_at = now()
      where c.organization_id = run.organization_id and c.kind = run.source and c.package_name = run.file_name;
  end if;
end;
$$;

revoke all on function public.save_source_connection(uuid, text, text, text, text) from public, anon;
revoke all on function public.disconnect_source(uuid, text) from public, anon;
revoke all on function public.start_source_fetch(uuid, text, text) from public, anon;
revoke all on function public.finish_source_fetch(uuid, text) from public, anon;
grant execute on function public.save_source_connection(uuid, text, text, text, text) to authenticated;
grant execute on function public.disconnect_source(uuid, text) to authenticated;
grant execute on function public.start_source_fetch(uuid, text, text) to authenticated;
grant execute on function public.finish_source_fetch(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Import problem notifications name the source
-- ---------------------------------------------------------------------------

-- Same as in 20261027120000_notification_events.sql, plus Google Play.
create or replace function private.notify_import_problem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  what text := case new.source when 'gmail' then 'Gmail fetch' when 'google_play' then 'Google Play fetch' else 'CSV import' end;
begin
  if old.status = 'running' and new.status = 'failed' then
    perform private.notify_staff(new.organization_id, 'import_problem',
      format('%s stopped with an error. See the import history.', what), 'import:' || new.id);
  elsif old.status = 'running' and new.status = 'finished' and new.rejected > 0 then
    perform private.notify_staff(new.organization_id, 'import_problem',
      format('%s finished, but %s %s could not be saved. See the import history.', what, new.rejected,
             case when new.rejected = 1 then 'row' else 'rows' end),
      'import:' || new.id);
  end if;
  return null;
end;
$$;
