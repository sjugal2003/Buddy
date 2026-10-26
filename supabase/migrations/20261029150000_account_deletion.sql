-- Phase 7 stage 37: deleting your own account (finding F9), and only Buddy's
-- server can get the encrypted Gmail token (finding F11).
--
-- * public.account_deletion_plan() says what deleting the signed-in account
--   would do to each of its companies: leave it, delete it (you are its only
--   member), or stop (you are its only owner but others belong to it, or it
--   still has Gmail connected).
-- * public.delete_my_account(p_confirm) does it after the person types their
--   own email: deletes the companies they are alone in, removes them from the
--   rest, takes their email off the company-creators list, and deletes the
--   sign-in itself. Work they did in other companies stays, without their
--   name.
-- * mailbox_token and start_gmail_fetch now also need Buddy's server key
--   (BUDDY_AI_RESULT_KEY, checked against its hash), so a person calling the
--   API directly can no longer get the encrypted Gmail token.

-- ---------------------------------------------------------------------------
-- Deleting your own account
-- ---------------------------------------------------------------------------

create function public.account_deletion_plan()
returns table (organization_id uuid, name text, slug text, outcome text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  return query
  select o.id, o.name, o.slug,
    case
      when (select count(*) from public.organization_members m where m.organization_id = o.id) = 1 then
        case when exists (select 1 from public.mailbox_connections c where c.organization_id = o.id)
          then 'blocked_gmail' else 'delete' end
      when me.role = 'owner'
        and (select count(*) from public.organization_members m
             where m.organization_id = o.id and m.role = 'owner') = 1 then 'blocked_owner'
      else 'leave'
    end
  from public.organization_members me
  join public.organizations o on o.id = me.organization_id
  where me.user_id = caller
  order by o.name;
end;
$$;

revoke all on function public.account_deletion_plan() from public, anon;
grant execute on function public.account_deletion_plan() to authenticated;

-- Returns how many companies were deleted with the account.
create function public.delete_my_account(p_confirm text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  my_email text;
  blocked text;
  deleted integer;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  select lower(u.email) into my_email from auth.users u where u.id = caller;
  if my_email is null or lower(btrim(coalesce(p_confirm, ''))) <> my_email then
    raise exception 'Type your own email address to confirm.' using errcode = '22023';
  end if;

  -- Nobody else changes these companies' members while we decide.
  perform 1 from public.organization_members m
  where m.organization_id in (select x.organization_id from public.organization_members x where x.user_id = caller)
  for update;

  select string_agg(p.name, ', ' order by p.name) into blocked
  from public.account_deletion_plan() p where p.outcome = 'blocked_owner';
  if blocked is not null then
    raise exception 'You are the only owner of %. Make someone else an owner there first, or remove the other members.', blocked
      using errcode = 'P0001';
  end if;

  select string_agg(p.name, ', ' order by p.name) into blocked
  from public.account_deletion_plan() p where p.outcome = 'blocked_gmail';
  if blocked is not null then
    raise exception 'Disconnect Gmail in % first (Data sources), so Google stops Buddy''s access.', blocked
      using errcode = 'P0001';
  end if;

  delete from public.organizations o
  where o.id in (select p.organization_id from public.account_deletion_plan() p where p.outcome = 'delete');
  get diagnostics deleted = row_count;

  delete from private.company_creators c where c.email = my_email;
  delete from private.rate_limit_events e where e.user_id = caller;
  -- Removes the profile and memberships with it; their name is cleared from
  -- everything else they did (those columns are set to empty).
  delete from auth.users u where u.id = caller;

  return deleted;
end;
$$;

revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The encrypted Gmail token goes only to Buddy's server
-- ---------------------------------------------------------------------------

create function private.check_server_key_for_gmail(p_key text)
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
    raise exception 'Gmail can''t be used: this server''s BUDDY_AI_RESULT_KEY is missing or does not match the one set up in the database (see the README).'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.check_server_key_for_gmail(text) from public, anon, authenticated;

drop function public.mailbox_token(uuid);
drop function public.start_gmail_fetch(uuid);

-- Same as 20261026120000_gmail_connection.sql, plus the server key.
create function public.mailbox_token(p_organization_id uuid, p_server_key text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_role(p_organization_id, array['owner', 'admin']) then
    raise exception 'Only owners and admins can use the connected inbox.' using errcode = '42501';
  end if;
  perform private.check_server_key_for_gmail(p_server_key);
  return (select t.encrypted_refresh_token from public.mailbox_tokens t where t.organization_id = p_organization_id);
end;
$$;

-- Same as 20261026150000_gmail_fetch.sql, plus the server key.
create function public.start_gmail_fetch(p_organization_id uuid, p_server_key text)
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
  perform private.check_server_key_for_gmail(p_server_key);
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

revoke all on function public.mailbox_token(uuid, text) from public, anon;
revoke all on function public.start_gmail_fetch(uuid, text) from public, anon;
grant execute on function public.mailbox_token(uuid, text) to authenticated;
grant execute on function public.start_gmail_fetch(uuid, text) to authenticated;
