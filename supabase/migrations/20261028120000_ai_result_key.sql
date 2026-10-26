-- Phase 7 stage 36, part 2: only Buddy's server can record AI results.
--
-- AI calls run with the signed-in person's own session (no secret database
-- key), so until now a member could call finish_issue_analysis themselves
-- and store a made-up "AI" answer for an issue in their own company (finding
-- F5). Now starting and finishing an analysis also need BUDDY_AI_RESULT_KEY,
-- a random key that exists only in the server's settings. The database keeps
-- only its SHA-256 hash, set once in the SQL Editor (README: "AI result
-- key"). Until that is done, analyses are refused with a plain message
-- before anything is sent to the AI.

alter table private.platform_settings
  add column ai_result_key_hash text check (ai_result_key_hash ~ '^[0-9a-f]{64}$');

-- Refuses unless the key matches the stored hash.
create function private.check_ai_result_key(p_key text)
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
  if expected is null then
    raise exception 'AI results can''t be saved yet: Buddy''s AI result key is not set up in the database (see the README).'
      using errcode = 'P0001';
  end if;
  if p_key is null or encode(sha256(convert_to(p_key, 'UTF8')), 'hex') <> expected then
    raise exception 'AI results can''t be saved: this server''s BUDDY_AI_RESULT_KEY does not match the one set up in the database.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.check_ai_result_key(text) from public, anon, authenticated;

-- The old versions, callable without the key, are removed.
drop function public.start_issue_analysis(uuid);
drop function public.finish_issue_analysis(uuid, jsonb);

-- Same as 20261028090000_security_foundation.sql, plus the key check.
create function public.start_issue_analysis(p_issue_id uuid, p_server_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  org public.organizations;
  issue_org uuid;
  used integer;
  cap integer;
  new_id uuid;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  -- Only Buddy's server knows the key, so a member can't start one directly.
  perform private.check_ai_result_key(p_server_key);

  select i.organization_id into issue_org from public.issues i where i.id = p_issue_id;
  if issue_org is null or not private.is_member(issue_org) then
    raise exception 'That issue was not found.' using errcode = 'P0002';
  end if;

  select * into org from public.organizations o where o.id = issue_org for update;

  if not org.ai_enabled then
    raise exception 'AI analysis is turned off for this company.' using errcode = 'P0001';
  end if;

  select count(*) into used
  from public.issue_analyses a
  where a.organization_id = org.id
    and a.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';

  if used >= org.ai_monthly_limit then
    raise exception 'This company has used all % AI analyses for this month.', org.ai_monthly_limit
      using errcode = 'P0001';
  end if;

  -- One request at a time across all companies, so two at once cannot both
  -- take the last analysis of the month.
  perform pg_advisory_xact_lock(hashtext('buddy:ai-monthly-cap'));
  select s.ai_monthly_cap into cap from private.platform_settings s where s.id;
  select count(*) into used
  from public.issue_analyses a
  where a.created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';

  if used >= coalesce(cap, 0) then
    raise exception 'Buddy has used all of this month''s AI analyses (a limit for the whole app). It starts again on the 1st of next month.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.issue_analyses a
    where a.issue_id = p_issue_id and a.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Please wait 30 seconds before analysing this issue again.' using errcode = 'P0001';
  end if;

  insert into public.issue_analyses (organization_id, issue_id, requested_by)
  values (org.id, p_issue_id, caller)
  returning id into new_id;

  return new_id;
end;
$$;

-- Same as 20261024090000_ai_analysis.sql, plus the key check.
create function public.finish_issue_analysis(p_analysis_id uuid, p_result jsonb, p_server_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  rec public.issue_analyses;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

  -- Only Buddy's server knows the key, so a member can't record a made-up answer.
  perform private.check_ai_result_key(p_server_key);

  select * into rec from public.issue_analyses a
  where a.id = p_analysis_id
    and a.requested_by = caller
    and a.status = 'pending'
    and a.created_at > now() - interval '5 minutes'
  for update;

  if rec.id is null or not private.is_member(rec.organization_id) then
    raise exception 'That analysis was not found or has already finished.' using errcode = 'P0002';
  end if;

  if jsonb_typeof(p_result) <> 'object' then
    raise exception 'The analysis result is not valid.' using errcode = '22023';
  end if;

  if coalesce((p_result ->> 'ok')::boolean, false) then
    update public.issue_analyses set
      status = 'done',
      sentiment = p_result ->> 'sentiment',
      sentiment_score = (p_result ->> 'sentiment_score')::numeric,
      intent = p_result ->> 'intent',
      urgency = p_result ->> 'urgency',
      category_id = (p_result ->> 'category_id')::uuid,
      themes = coalesce(array(select jsonb_array_elements_text(p_result -> 'themes')), '{}'),
      summary = coalesce(p_result ->> 'summary', ''),
      suggested_action = coalesce(p_result ->> 'suggested_action', ''),
      confidence = (p_result ->> 'confidence')::numeric,
      model = coalesce(p_result ->> 'model', ''),
      input_tokens = coalesce((p_result ->> 'input_tokens')::integer, 0),
      output_tokens = coalesce((p_result ->> 'output_tokens')::integer, 0),
      finished_at = now()
    where id = rec.id;

    if rec.issue_id is not null then
      insert into public.issue_activity (organization_id, issue_id, actor_id, kind, to_value)
      values (rec.organization_id, rec.issue_id, caller, 'ai_analysed', p_result ->> 'urgency');
    end if;
  else
    update public.issue_analyses set
      status = 'failed',
      failure_reason = left(coalesce(p_result ->> 'reason', 'unknown'), 200),
      model = left(coalesce(p_result ->> 'model', ''), 80),
      input_tokens = coalesce((p_result ->> 'input_tokens')::integer, 0),
      output_tokens = coalesce((p_result ->> 'output_tokens')::integer, 0),
      finished_at = now()
    where id = rec.id;
  end if;
end;
$$;

revoke all on function public.start_issue_analysis(uuid, text) from public, anon;
revoke all on function public.finish_issue_analysis(uuid, jsonb, text) from public, anon;
grant execute on function public.start_issue_analysis(uuid, text) to authenticated;
grant execute on function public.finish_issue_analysis(uuid, jsonb, text) to authenticated;
