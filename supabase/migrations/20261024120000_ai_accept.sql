-- Phase 3 stage 13: copy AI suggestions onto an issue.
--
-- Members cannot change an issue's sentiment, type, urgency or summary
-- directly (see the column grants in the security migration). This function
-- is the one way to do it, and only with the values of a finished analysis
-- of that same issue. Every accepted field is written to the issue history.

create function private.category_name(category uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.name from public.categories c where c.id = category), 'No category');
$$;

create function public.accept_issue_analysis(p_analysis_id uuid, p_fields text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  a public.issue_analyses;
  i public.issues;
  field text;
  changed integer := 0;
begin
  if caller is null then
    raise exception 'You need to sign in first.' using errcode = '42501';
  end if;
  if p_fields is null or cardinality(p_fields) = 0
     or not p_fields <@ array['sentiment', 'intent', 'urgency', 'category', 'summary'] then
    raise exception 'Choose which AI suggestions to use.' using errcode = '22023';
  end if;

  select * into a from public.issue_analyses x where x.id = p_analysis_id;
  if a.id is null or not private.is_member(a.organization_id) then
    raise exception 'That analysis was not found.' using errcode = 'P0002';
  end if;
  if a.status <> 'done' or a.issue_id is null then
    raise exception 'That analysis has no suggestions to use.' using errcode = 'P0001';
  end if;

  select * into i from public.issues x where x.id = a.issue_id for update;

  foreach field in array p_fields loop
    if field = 'sentiment' and i.sentiment is distinct from a.sentiment then
      update public.issues set sentiment = a.sentiment, sentiment_score = coalesce(a.sentiment_score, 0)
      where id = i.id;
      insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
      values (i.organization_id, i.id, caller, 'ai_accepted', 'sentiment:' || i.sentiment, a.sentiment);
      changed := changed + 1;
    elsif field = 'intent' and i.intent is distinct from a.intent then
      update public.issues set intent = a.intent where id = i.id;
      insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
      values (i.organization_id, i.id, caller, 'ai_accepted', 'intent:' || i.intent, a.intent);
      changed := changed + 1;
    elsif field = 'urgency' and i.urgency is distinct from a.urgency then
      update public.issues set urgency = a.urgency where id = i.id;
      insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
      values (i.organization_id, i.id, caller, 'ai_accepted', 'urgency:' || i.urgency, a.urgency);
      changed := changed + 1;
    elsif field = 'category' and a.category_id is not null and i.category_id is distinct from a.category_id then
      update public.issues set category_id = a.category_id where id = i.id;
      insert into public.issue_activity (organization_id, issue_id, actor_id, kind, from_value, to_value)
      values (i.organization_id, i.id, caller, 'ai_accepted',
              'category:' || private.category_name(i.category_id), private.category_name(a.category_id));
      changed := changed + 1;
    elsif field = 'summary' then
      -- Summary, themes and next step are AI-only fields, so they are simply kept up to date.
      update public.issues set summary = a.summary, themes = a.themes, suggested_action = a.suggested_action
      where id = i.id;
    end if;
  end loop;

  if changed > 0 then
    update public.issues set analysis_source = 'ai', confidence = a.confidence where id = i.id;
  end if;
  return changed;
end;
$$;

revoke all on function private.category_name(uuid) from public;
revoke all on function public.accept_issue_analysis(uuid, text[]) from public, anon;
grant execute on function public.accept_issue_analysis(uuid, text[]) to authenticated;
