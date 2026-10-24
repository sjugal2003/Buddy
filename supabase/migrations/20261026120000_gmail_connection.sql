-- Phase 5 stage 25: one connected Gmail inbox per company, read-only.
--
-- mailbox_connections says which inbox is connected, by whom and when; every
-- member of the company can see it. The Gmail sign-in token is kept apart in
-- mailbox_tokens, which nobody can read or write directly: only the functions
-- below reach it. The token arrives already encrypted by the server with a
-- key that never leaves the server (GMAIL_TOKEN_KEY), so even the value these
-- functions return cannot be used without that key.
--
-- Nothing here reads, sends or changes email; fetching is stage 26.

create table public.mailbox_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  provider text not null default 'gmail' check (provider in ('gmail')),
  email_address text not null check (
    email_address = lower(email_address)
    and char_length(email_address) <= 254
    and email_address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz not null default now(),
  -- Where the next fetch starts (stage 26).
  last_history_id text check (char_length(last_history_id) <= 40),
  last_fetched_at timestamptz,
  unique (id, organization_id)
);

revoke all on public.mailbox_connections from anon, authenticated;
grant select on public.mailbox_connections to authenticated;
alter table public.mailbox_connections enable row level security;

create policy "Members see their company's inbox connection" on public.mailbox_connections
  for select to authenticated
  using (private.is_member(organization_id));

create table public.mailbox_tokens (
  connection_id uuid primary key,
  organization_id uuid not null,
  -- "v1:<iv>:<tag>:<ciphertext>" from the server's AES-256-GCM encryption.
  encrypted_refresh_token text not null check (
    char_length(encrypted_refresh_token) between 10 and 4000 and encrypted_refresh_token like 'v1:%'
  ),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.mailbox_connections (id, organization_id) on delete cascade
);

-- No rights and no policies: only the security-definer functions below reach it.
revoke all on public.mailbox_tokens from anon, authenticated;
alter table public.mailbox_tokens enable row level security;

-- Connects (or replaces) the company's inbox. Owners only.
create function public.save_mailbox_connection(p_organization_id uuid, p_email text, p_encrypted_token text)
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
        last_history_id = case when c.email_address = excluded.email_address then c.last_history_id end,
        last_fetched_at = case when c.email_address = excluded.email_address then c.last_fetched_at end
  returning id into conn_id;

  insert into public.mailbox_tokens (connection_id, organization_id, encrypted_refresh_token)
  values (conn_id, p_organization_id, p_encrypted_token)
  on conflict (connection_id) do update
    set encrypted_refresh_token = excluded.encrypted_refresh_token, updated_at = now();
  return conn_id;
end;
$$;

-- The encrypted token, for the server to fetch email (stage 26) or to sign
-- out of Google when disconnecting. Owners and admins of the company only.
create function public.mailbox_token(p_organization_id uuid)
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
  return (select t.encrypted_refresh_token from public.mailbox_tokens t where t.organization_id = p_organization_id);
end;
$$;

-- Removes the connection and its token. Owners only. Issues already fetched stay.
create function public.disconnect_mailbox(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.has_role(p_organization_id, array['owner']) then
    raise exception 'Only owners can disconnect the inbox.' using errcode = '42501';
  end if;
  delete from public.mailbox_connections where organization_id = p_organization_id;
  return found;
end;
$$;

revoke all on function public.save_mailbox_connection(uuid, text, text) from public, anon;
revoke all on function public.mailbox_token(uuid) from public, anon;
revoke all on function public.disconnect_mailbox(uuid) from public, anon;
grant execute on function public.save_mailbox_connection(uuid, text, text) to authenticated;
grant execute on function public.mailbox_token(uuid) to authenticated;
grant execute on function public.disconnect_mailbox(uuid) to authenticated;
