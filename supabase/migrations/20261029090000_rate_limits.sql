-- Phase 7 stage 37: limits on how often one person can repeat an action
-- (finding F6). Counted per signed-in person in the database, so calling the
-- API directly doesn't get around them. Generous for normal work; they only
-- stop one account from flooding Buddy. Scheduled jobs and imported rows
-- (no signed-in person, or not typed in by hand) are never counted.
--
--   Action                               Limit per person per hour
--   Invitations created                  30
--   Imports started (CSV and Gmail)      30
--   Issues added by hand                 200
--   "Check now" escalation checks        30
--
-- Sign-in, sign-up and email sending have Supabase Auth's own limits.
-- AI analyses are limited by the company and whole-app monthly limits.

create table private.rate_limit_events (
  user_id uuid not null,
  action text not null check (char_length(action) <= 40),
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup_idx on private.rate_limit_events (user_id, action, created_at);

alter table private.rate_limit_events enable row level security;
revoke all on private.rate_limit_events from public, anon, authenticated;

-- Trigger arguments: action key, limit, window in seconds, plain name for the message.
create function private.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  action_key text := tg_argv[0];
  max_count integer := tg_argv[1]::integer;
  window_length interval := make_interval(secs => tg_argv[2]::integer);
  used integer;
begin
  if caller is null then
    return new;
  end if;

  -- One request at a time per person and action, so two at once can't both slip under.
  perform pg_advisory_xact_lock(hashtext('buddy:rate:' || caller::text || ':' || action_key));

  delete from private.rate_limit_events e
  where e.user_id = caller and e.action = action_key and e.created_at < now() - window_length;

  select count(*) into used from private.rate_limit_events e
  where e.user_id = caller and e.action = action_key;

  if used >= max_count then
    raise exception 'Too many % in the last hour (the limit is %). Please wait a while and try again.', tg_argv[3], max_count
      using errcode = 'P0001';
  end if;

  insert into private.rate_limit_events (user_id, action) values (caller, action_key);
  return new;
end;
$$;

revoke all on function private.enforce_rate_limit() from public, anon, authenticated;

create trigger organization_invitations_rate_limit before insert on public.organization_invitations
  for each row execute function private.enforce_rate_limit('invite', '30', '3600', 'invitations');

create trigger import_runs_rate_limit before insert on public.import_runs
  for each row execute function private.enforce_rate_limit('import', '30', '3600', 'imports and Gmail fetches');

create trigger issues_rate_limit before insert on public.issues
  for each row when (new.source = 'manual')
  execute function private.enforce_rate_limit('issue', '200', '3600', 'issues added by hand');

create trigger escalation_runs_rate_limit before insert on public.escalation_runs
  for each row when (new.source = 'manual')
  execute function private.enforce_rate_limit('check', '30', '3600', 'escalation checks');
