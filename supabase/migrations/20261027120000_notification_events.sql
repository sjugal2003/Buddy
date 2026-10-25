-- Phase 6 stage 30: what creates notifications.
--
-- Owners and admins of a company are notified, inside Buddy only, when:
--   * an escalation is recorded (by "Check now" or the 15-minute check),
--   * an open issue becomes High or Critical urgency (typed in, or set later
--     by a person or the AI),
--   * a CSV import or Gmail fetch stops with an error or rejects rows.
-- Each event notifies each person once (private.create_notification skips
-- repeats and anyone who is not a member). Titles are written here from
-- Buddy's own values, never from the customer's message, name or email.
-- Members get none: teams have no member list, so nobody can say which
-- members an issue concerns.

-- Notifies every owner and admin of the company. Returns how many were added.
create function private.notify_staff(
  p_organization_id uuid,
  p_kind text,
  p_title text,
  p_dedupe_key text,
  p_issue_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  person uuid;
  added integer := 0;
begin
  for person in
    select m.user_id from public.organization_members m
    where m.organization_id = p_organization_id and m.role in ('owner', 'admin')
    order by m.user_id
  loop
    if private.create_notification(p_organization_id, person, p_kind, p_title, p_dedupe_key, p_issue_id) is not null then
      added := added + 1;
    end if;
  end loop;
  return added;
end;
$$;

revoke all on function private.notify_staff(uuid, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Escalations
-- ---------------------------------------------------------------------------

create function private.escalation_label(p_condition text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_condition
    when 'first_response_breached' then 'first-response target missed'
    when 'resolution_breached' then 'resolution target missed'
    when 'urgent_no_team' then 'urgent issue still has no team'
    when 'no_team' then 'open issue has no team'
    when 'no_update' then 'no update for too long'
    else 'needs attention'
  end;
$$;

revoke all on function private.escalation_label(text) from public, anon, authenticated;

-- Once per check, after its escalations are saved. Up to 10 new escalations
-- for a company each get their own notification linking to the issue; more
-- than that become one summary, so switching a condition on for many old
-- issues does not bury everything else.
create function private.notify_new_escalations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org record;
  e record;
begin
  for org in
    select n.organization_id, count(*) as total from new_escalations n group by n.organization_id
  loop
    if org.total <= 10 then
      for e in
        select n.id, n.issue_id, n.level, n.condition, i.reference
        from new_escalations n join public.issues i on i.id = n.issue_id
        where n.organization_id = org.organization_id
        order by n.created_at, n.id
      loop
        perform private.notify_staff(org.organization_id, 'escalation',
          format('Escalated (level %s): %s, %s', e.level, private.escalation_label(e.condition), e.reference),
          'escalation:' || e.id, e.issue_id);
      end loop;
    else
      perform private.notify_staff(org.organization_id, 'escalation',
        format('%s issues escalated in one check. See the Issues list.', org.total),
        'escalations:' || gen_random_uuid());
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function private.notify_new_escalations() from public, anon, authenticated;

create trigger escalations_notify
  after insert on public.escalations
  referencing new table as new_escalations
  for each statement execute function private.notify_new_escalations();

-- ---------------------------------------------------------------------------
-- Urgent issues
-- ---------------------------------------------------------------------------

-- When an open issue is created as, or changed to, High or Critical. Once per
-- issue: lowering and raising it again does not notify a second time.
create function private.notify_urgent_issue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.urgency in ('high', 'critical') and new.status <> 'resolved'
     and (tg_op = 'INSERT' or old.urgency not in ('high', 'critical')) then
    perform private.notify_staff(new.organization_id, 'urgent_issue',
      format('%s issue: %s', case new.urgency when 'critical' then 'Critical' else 'High urgency' end, new.reference),
      'urgent_issue:' || new.id, new.id);
  end if;
  return null;
end;
$$;

revoke all on function private.notify_urgent_issue() from public, anon, authenticated;

create trigger issues_notify_urgent
  after insert or update of urgency on public.issues
  for each row execute function private.notify_urgent_issue();

-- ---------------------------------------------------------------------------
-- Import and fetch problems
-- ---------------------------------------------------------------------------

-- When an import or fetch finishes: one notification if it stopped with an
-- error or some rows could not be saved. A clean import notifies nobody.
create function private.notify_import_problem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  what text := case new.source when 'gmail' then 'Gmail fetch' else 'CSV import' end;
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

revoke all on function private.notify_import_problem() from public, anon, authenticated;

create trigger import_runs_notify
  after update of status on public.import_runs
  for each row execute function private.notify_import_problem();
