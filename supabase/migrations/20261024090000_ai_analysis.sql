-- Phase 3 stage 12: AI analysis switches, the analysis record, and the two
-- functions that are the only way to add to it.
--
-- AI calls run on Buddy's server with the signed-in user's own session (no
-- secret key), so the database is where the per-company monthly limit is
-- enforced: start_issue_analysis reserves one analysis before the server
-- calls the AI, and refuses once the company has used its allowance.

-- ---------------------------------------------------------------------------
-- Company switches (off by default)
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column ai_enabled boolean not null default false,
  add column ai_monthly_limit integer not null default 500 check (ai_monthly_limit between 0 and 2000);

-- The existing "Owners and admins edit the company profile" policy decides who.
grant update (ai_enabled, ai_monthly_limit) on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- One row per analysis attempt
-- ---------------------------------------------------------------------------

create table public.issue_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Cleared (not deleted) when the issue is deleted, so the monthly count stays right.
  issue_id uuid,
  -- pending: reserved, the AI is being asked. done / failed: final, never changed again.
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  failure_reason text check (char_length(failure_reason) <= 200),
  sentiment text check (sentiment in ('positive', 'neutral', 'negative', 'very_negative')),
  sentiment_score numeric(3, 2) check (sentiment_score between -1 and 1),
  intent text check (intent in ('complaint', 'question', 'request', 'bug_report', 'cancellation', 'praise')),
  urgency text check (urgency in ('low', 'medium', 'high', 'critical')),
  category_id uuid,
  themes text[] not null default '{}' check (cardinality(themes) <= 5),
  summary text not null default '' check (char_length(summary) <= 400),
  suggested_action text not null default '' check (char_length(suggested_action) <= 300),
  confidence numeric(3, 2) check (confidence between 0 and 1),
  model text not null default '' check (char_length(model) <= 80),
  input_tokens integer not null default 0 check (input_tokens between 0 and 1000000),
  output_tokens integer not null default 0 check (output_tokens between 0 and 1000000),
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  -- A finished analysis has its answer; a failed one says why.
  check (status <> 'done' or (sentiment is not null and intent is not null and urgency is not null and summary <> '')),
  foreign key (organization_id, issue_id)
    references public.issues (organization_id, id) on delete set null (issue_id),
  foreign key (organization_id, category_id)
    references public.categories (organization_id, id) on delete set null (category_id)
);

create index issue_analyses_org_created_idx on public.issue_analyses (organization_id, created_at desc);
create index issue_analyses_issue_idx on public.issue_analyses (issue_id, created_at desc);

-- Read-only for users. Rows change only through the functions below.
revoke all on public.issue_analyses from anon, authenticated;
grant select on public.issue_analyses to authenticated;

alter table public.issue_analyses enable row level security;

create policy "Members see their company's analyses" on public.issue_analyses
  for select to authenticated
  using (private.is_member(organization_id));

-- History can now say an issue was analysed, and (stage 13) that a person
-- accepted an AI value.
alter table public.issue_activity drop constraint issue_activity_kind_check;
alter table public.issue_activity add constraint issue_activity_kind_check
  check (kind in ('created', 'status_changed', 'team_changed', 'assignee_changed', 'escalated',
                  'ai_analysed', 'ai_accepted'));

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Reserve one analysis for an issue, or refuse with a plain reason. Locks
-- the company row so two requests at once cannot both take the last one.
create function public.start_issue_analysis(p_issue_id uuid)
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
  new_id uuid;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;

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

-- Record the answer for an analysis the caller started in the last five
-- minutes. p_result is either
--   {"ok": true, "sentiment": ..., "sentiment_score": ..., "intent": ..., "urgency": ...,
--    "category_id": ... or null, "themes": [...], "summary": ..., "suggested_action": ...,
--    "confidence": ..., "model": ..., "input_tokens": ..., "output_tokens": ...}
-- or {"ok": false, "reason": "..."}. The table's checks reject anything out of range,
-- and the category must belong to the same company.
create function public.finish_issue_analysis(p_analysis_id uuid, p_result jsonb)
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

revoke all on function public.start_issue_analysis(uuid) from public, anon;
revoke all on function public.finish_issue_analysis(uuid, jsonb) from public, anon;
grant execute on function public.start_issue_analysis(uuid) to authenticated;
grant execute on function public.finish_issue_analysis(uuid, jsonb) to authenticated;
