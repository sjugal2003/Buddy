-- Buddy security tests: tenant isolation, roles and invitations.
--
-- Creates two fictional companies with test users, then acts as each user
-- (the same way Supabase does for real requests) and checks what they can
-- and cannot see or change. Everything runs inside one transaction that is
-- rolled back at the end, so no test data is left behind.
--
-- Any failed check stops the script with an error starting "FAIL:".
-- Success ends with a row showing how many checks passed.

begin;

-- ---------------------------------------------------------------------------
-- Test helpers (rolled back with everything else)
-- ---------------------------------------------------------------------------

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.pass(label text) returns void language plpgsql as $$
begin
  perform set_config('tests.passed', (coalesce(nullif(current_setting('tests.passed', true), ''), '0')::int + 1)::text, true);
  raise notice 'PASS: %', label;
end;
$$;

-- The statement must fail.
create function tests.expect_error(statement text, label text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    perform tests.pass(label || ' (refused: ' || sqlerrm || ')');
    return;
  end;
  raise exception 'FAIL: % (statement was allowed: %)', label, statement;
end;
$$;

-- The query must return exactly this many rows.
create function tests.expect_rows(query text, expected int, label text) returns void language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || query || ') as q' into n;
  if n <> expected then
    raise exception 'FAIL: % (expected % rows, got %)', label, expected, n;
  end if;
  perform tests.pass(label);
end;
$$;

-- The insert/update/delete must succeed and touch exactly this many rows.
create function tests.expect_affected(statement text, expected int, label text) returns void language plpgsql as $$
declare n int;
begin
  execute statement;
  get diagnostics n = row_count;
  if n <> expected then
    raise exception 'FAIL: % (expected % rows changed, got %)', label, expected, n;
  end if;
  perform tests.pass(label);
end;
$$;

-- Act as a signed-in user, or as a signed-out visitor when user_id is null.
-- Sets both the current and the older per-claim setting that auth.uid() reads.
create function tests.act_as(user_id uuid) returns void language plpgsql as $$
begin
  if user_id is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', user_id::text, true);
  end if;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- Readable names for the test users.
select set_config('t.a_owner',  'a0000000-0000-4000-8000-000000000001', true);
select set_config('t.a_member', 'a0000000-0000-4000-8000-000000000002', true);
select set_config('t.b_owner',  'b0000000-0000-4000-8000-000000000001', true);
select set_config('t.outsider', 'c0000000-0000-4000-8000-000000000001', true);
select set_config('t.invitee',  'd0000000-0000-4000-8000-000000000001', true);
select set_config('t.unconfirmed', 'e0000000-0000-4000-8000-000000000001', true);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'owner-a@example.com',   now(), '{"full_name":"Alice Owner"}'),
  ('a0000000-0000-4000-8000-000000000002', 'member-a@example.com',  now(), '{"full_name":"Arjun Member"}'),
  ('b0000000-0000-4000-8000-000000000001', 'owner-b@example.com',   now(), '{"full_name":"Bea Owner"}'),
  ('c0000000-0000-4000-8000-000000000001', 'outsider@example.com',  now(), '{"full_name":"Carl Outsider"}'),
  ('d0000000-0000-4000-8000-000000000001', 'invitee@example.com',   now(), '{"full_name":"Dana Invitee"}'),
  ('e0000000-0000-4000-8000-000000000001', 'late@example.com',      null,  '{"full_name":"Eli Unconfirmed"}');

-- Only these six users, so accounts left by other tests don't change the count.
select tests.expect_rows($q$select 1 from public.profiles where id in (
  select id from auth.users where email like any (array[
    'owner-a@example.com', 'member-a@example.com', 'owner-b@example.com',
    'outsider@example.com', 'invitee@example.com', 'late@example.com']))$q$, 6,
  'a profile is created for every sign-up');

-- ---------------------------------------------------------------------------
-- Setup through the app's own paths: each owner creates their company
-- ---------------------------------------------------------------------------

set local role authenticated;

select tests.act_as(current_setting('t.a_owner')::uuid);
select public.create_organization('Company A', 'company-a', 'Testing', 'UTC');
select tests.act_as(current_setting('t.b_owner')::uuid);
select public.create_organization('Company B', 'company-b', 'Testing', 'UTC');

reset role;
select set_config('t.org_a', (select id::text from public.organizations where slug = 'company-a'), true);
select set_config('t.org_b', (select id::text from public.organizations where slug = 'company-b'), true);

-- Company A: owner adds a team, category, issue and rule, and invites a member.
set local role authenticated;
select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_affected(format(
  $q$insert into public.teams (organization_id, name) values (%L, 'A Support'), (%L, 'A Billing')$q$,
  current_setting('t.org_a'), current_setting('t.org_a')), 2, 'owner A adds teams');
select tests.expect_affected(format(
  $q$insert into public.categories (organization_id, name) values (%L, 'A Refunds')$q$,
  current_setting('t.org_a')), 1, 'owner A adds a category');
select tests.expect_affected(format(
  $q$insert into public.issues (organization_id, reference, customer_name, channel, subject, message)
     values (%L, 'A-1', 'Customer One', 'email', 'Refund please', 'I was charged twice.')$q$,
  current_setting('t.org_a')), 1, 'owner A creates an issue');
select tests.expect_affected(format(
  $q$insert into public.routing_rules (organization_id, name, conditions, team_id)
     select %L, 'Refunds to billing', '[{"field":"keyword","value":"refund"}]', id
     from public.teams where name = 'A Billing'$q$,
  current_setting('t.org_a')), 1, 'owner A adds a routing rule');
select tests.expect_affected(format(
  $q$insert into public.organization_invitations (organization_id, email, role, token_hash) values
     (%L, 'member-a@example.com', 'member', encode(sha256(convert_to('tok-member-a', 'UTF8')), 'hex')),
     (%L, 'invitee@example.com',  'member', encode(sha256(convert_to('tok-invitee', 'UTF8')), 'hex')),
     (%L, 'late@example.com',     'member', encode(sha256(convert_to('tok-late', 'UTF8')), 'hex'))$q$,
  current_setting('t.org_a'), current_setting('t.org_a'), current_setting('t.org_a')), 3, 'owner A invites people');

select tests.act_as(current_setting('t.a_member')::uuid);
select tests.expect_rows($q$select 1 where public.accept_invitation('tok-member-a') = 'company-a'$q$, 1,
  'invited member accepts the invitation');

-- Company B: owner adds a team, issue and rule.
select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_affected(format(
  $q$insert into public.teams (organization_id, name) values (%L, 'B Support')$q$,
  current_setting('t.org_b')), 1, 'owner B adds a team');
select tests.expect_affected(format(
  $q$insert into public.issues (organization_id, reference, customer_name, channel, subject, message, team_id)
     select %L, 'B-1', 'Customer Two', 'live_chat', 'Late order', 'Where is my order?', id
     from public.teams where name = 'B Support'$q$,
  current_setting('t.org_b')), 1, 'owner B creates an issue');
select tests.expect_affected(format(
  $q$insert into public.routing_rules (organization_id, name, conditions, team_id)
     select %L, 'Orders', '[{"field":"keyword","value":"order"}]', id from public.teams where name = 'B Support'$q$,
  current_setting('t.org_b')), 1, 'owner B adds a routing rule');

reset role;
select set_config('t.issue_a', (select id::text from public.issues where reference = 'A-1'), true);
select set_config('t.issue_b', (select id::text from public.issues where reference = 'B-1'), true);
select set_config('t.team_b', (select id::text from public.teams where name = 'B Support'), true);
select set_config('t.team_a_support', (select id::text from public.teams where name = 'A Support'), true);
insert into public.categories (organization_id, name) values (current_setting('t.org_b')::uuid, 'B Returns');
select set_config('t.rule_a', (select id::text from public.routing_rules where name = 'Refunds to billing'), true);
select set_config('t.rule_b', (select id::text from public.routing_rules where name = 'Orders'), true);
select set_config('t.cat_a', (select id::text from public.categories where name = 'A Refunds'), true);
select set_config('t.cat_b', (select id::text from public.categories where name = 'B Returns'), true);

-- ---------------------------------------------------------------------------
-- Signed-out visitor
-- ---------------------------------------------------------------------------

set local role anon;
select tests.act_as(null);
select tests.expect_error('select * from public.issues', 'signed-out visitor cannot read issues');
select tests.expect_error('select * from public.organizations', 'signed-out visitor cannot read companies');
select tests.expect_error('select * from public.profiles', 'signed-out visitor cannot read profiles');
select tests.expect_error($q$select public.create_organization('X', 'xxx')$q$, 'signed-out visitor cannot create a company');

-- ---------------------------------------------------------------------------
-- Signed-in user who belongs to no company
-- ---------------------------------------------------------------------------

set local role authenticated;
select tests.act_as(current_setting('t.outsider')::uuid);
select tests.expect_rows('select 1 from public.organizations', 0, 'outsider sees no companies');
select tests.expect_rows('select 1 from public.issues', 0, 'outsider sees no issues');
select tests.expect_rows('select 1 from public.teams', 0, 'outsider sees no teams');
select tests.expect_rows('select 1 from public.organization_members', 0, 'outsider sees no memberships');
select tests.expect_rows('select 1 from public.profiles', 1, 'outsider sees only their own profile');
select tests.expect_error(format(
  $q$insert into public.organization_members (organization_id, user_id, role) values (%L, %L, 'owner')$q$,
  current_setting('t.org_a'), current_setting('t.outsider')), 'outsider cannot add themselves to company A');
select tests.expect_error(format(
  $q$insert into public.issues (organization_id, customer_name, channel, subject, message) values (%L, 'X', 'email', 'X', 'X')$q$,
  current_setting('t.org_a')), 'outsider cannot create an issue in company A');
select tests.expect_affected(format(
  $q$update public.issues set status = 'resolved' where id = %L$q$, current_setting('t.issue_a')), 0,
  'outsider cannot update company A issue');
select tests.expect_error($q$select public.accept_invitation('tok-invitee')$q$,
  'outsider cannot use an invitation sent to someone else');

-- ---------------------------------------------------------------------------
-- Member of company A trying to reach company B
-- ---------------------------------------------------------------------------

select tests.act_as(current_setting('t.a_member')::uuid);
select tests.expect_rows('select 1 from public.organizations', 1, 'member A sees only company A');
select tests.expect_rows($q$select 1 from public.issues where reference = 'A-1'$q$, 1, 'member A sees company A issues');
select tests.expect_rows(format('select 1 from public.issues where organization_id = %L', current_setting('t.org_b')), 0,
  'member A sees none of company B issues');
select tests.expect_rows(format('select 1 from public.teams where organization_id = %L', current_setting('t.org_b')), 0,
  'member A sees none of company B teams');
select tests.expect_rows(format('select 1 from public.routing_rules where organization_id = %L', current_setting('t.org_b')), 0,
  'member A sees none of company B routing rules');
select tests.expect_rows(format('select 1 from public.automation_settings where organization_id = %L', current_setting('t.org_b')), 0,
  'member A sees none of company B settings');
select tests.expect_rows(format('select 1 from public.organization_members where organization_id = %L', current_setting('t.org_b')), 0,
  'member A sees none of company B members');
select tests.expect_rows(format('select 1 from public.profiles where id = %L', current_setting('t.b_owner')), 0,
  'member A cannot see company B owner profile');
select tests.expect_rows(format('select 1 from public.profiles where id = %L', current_setting('t.a_owner')), 1,
  'member A can see a colleague in company A');
select tests.expect_affected(format(
  $q$update public.issues set status = 'resolved' where id = %L$q$, current_setting('t.issue_b')), 0,
  'member A cannot update company B issue');
select tests.expect_affected(format('delete from public.issues where id = %L', current_setting('t.issue_b')), 0,
  'member A cannot delete company B issue');
select tests.expect_error(format(
  $q$insert into public.issues (organization_id, customer_name, channel, subject, message) values (%L, 'X', 'email', 'X', 'X')$q$,
  current_setting('t.org_b')), 'member A cannot create an issue in company B');
select tests.expect_error(format(
  $q$insert into public.issues (organization_id, customer_name, channel, subject, message, team_id)
     values (%L, 'X', 'email', 'X', 'X', %L)$q$,
  current_setting('t.org_a'), current_setting('t.team_b')), 'an issue in A cannot be given a team from B');
select tests.expect_error(format(
  $q$update public.issues set team_id = %L where id = %L$q$, current_setting('t.team_b'), current_setting('t.issue_a')),
  'an existing issue in A cannot be moved to a team from B');
select tests.expect_error(format(
  $q$update public.issues set organization_id = %L where id = %L$q$, current_setting('t.org_b'), current_setting('t.issue_a')),
  'an issue cannot be moved to another company');
select tests.expect_affected(format(
  $q$update public.teams set name = 'Hacked' where id = %L$q$, current_setting('t.team_b')), 0,
  'member A cannot rename company B team');

-- ---------------------------------------------------------------------------
-- Member of company A: what a plain member can and cannot do at home
-- ---------------------------------------------------------------------------

select tests.expect_affected(format(
  $q$insert into public.issues (organization_id, customer_name, channel, subject, message)
     values (%L, 'Customer Three', 'survey', 'Slow app', 'The app is slow.')$q$,
  current_setting('t.org_a')), 1, 'member A creates an issue in company A');
select tests.expect_error(format(
  $q$insert into public.issues (organization_id, customer_name, channel, subject, message, analysis_source)
     values (%L, 'X', 'email', 'X', 'X', 'ai')$q$,
  current_setting('t.org_a')), 'member cannot label an issue as AI-analysed');
select tests.expect_error(format(
  $q$insert into public.issues (organization_id, customer_name, channel, subject, message, created_by)
     values (%L, 'X', 'email', 'X', 'X', %L)$q$,
  current_setting('t.org_a'), current_setting('t.a_owner')), 'member cannot create an issue in someone else''s name');
select tests.expect_affected(format(
  $q$update public.issues set status = 'in_progress', team_id = %L, assignee_name = 'Arjun' where id = %L$q$,
  current_setting('t.team_a_support'), current_setting('t.issue_a')), 1, 'member A updates status, team and assignee');
select tests.expect_rows(format(
  $q$select 1 from public.issue_activity where issue_id = %L and kind in ('status_changed', 'team_changed', 'assignee_changed')
     and actor_id = %L$q$, current_setting('t.issue_a'), current_setting('t.a_member')), 3,
  'the changes are recorded in the history with the right person');
select tests.expect_rows(format(
  $q$select 1 from public.issue_activity where issue_id = %L and kind = 'team_changed' and to_value = 'A Support'$q$,
  current_setting('t.issue_a')), 1, 'history shows the team name');
select tests.expect_affected(format(
  $q$update public.issues set category_id = %L where id = %L$q$, current_setting('t.cat_a'), current_setting('t.issue_a')), 1,
  'member A sets a company A category on the issue');
select tests.expect_error(format(
  $q$update public.issues set category_id = %L where id = %L$q$, current_setting('t.cat_b'), current_setting('t.issue_a')),
  'an issue in A cannot be given a category from B');
select tests.expect_rows(format('select 1 from public.categories where organization_id = %L', current_setting('t.org_b')), 0,
  'member A sees none of company B categories');
select tests.expect_affected(format(
  $q$update public.categories set name = 'Renamed' where id = %L$q$, current_setting('t.cat_a')), 0,
  'member cannot rename categories');
select tests.expect_affected(format(
  $q$update public.organizations set target_hours_critical = 2 where id = %L$q$, current_setting('t.org_a')), 0,
  'member cannot change response targets');
select tests.expect_affected(format(
  $q$update public.routing_rules set enabled = false where id = %L$q$, current_setting('t.rule_a')), 0,
  'member cannot switch a routing rule off');
select tests.expect_affected(format(
  $q$update public.routing_rules set position = 5 where id = %L$q$, current_setting('t.rule_a')), 0,
  'member cannot reorder routing rules');
select tests.expect_affected(format('delete from public.routing_rules where id = %L', current_setting('t.rule_a')), 0,
  'member cannot delete routing rules');
select tests.expect_rows(format('select 1 from public.routing_rules where id = %L', current_setting('t.rule_a')), 1,
  'member can read company A routing rules');
select tests.expect_affected(format(
  $q$update public.issues set status = 'resolved' where id = %L and resolved_at is null$q$, current_setting('t.issue_a')), 1,
  'member A resolves the issue');
select tests.expect_rows(format('select 1 from public.issues where id = %L and resolved_at is not null', current_setting('t.issue_a')), 1,
  'resolving sets the resolved time');
select tests.expect_error(format(
  $q$update public.issues set message = 'changed' where id = %L$q$, current_setting('t.issue_a')),
  'member cannot rewrite the customer message');
select tests.expect_error(format(
  $q$insert into public.issue_activity (organization_id, issue_id, kind) values (%L, %L, 'escalated')$q$,
  current_setting('t.org_a'), current_setting('t.issue_a')), 'member cannot write history directly');
select tests.expect_error('delete from public.issue_activity', 'member cannot delete history');
select tests.expect_error($q$update public.issue_activity set to_value = 'x'$q$, 'member cannot edit history');
select tests.expect_affected(format('delete from public.issues where id = %L', current_setting('t.issue_a')), 0,
  'member cannot delete issues');
select tests.expect_error(format(
  $q$insert into public.teams (organization_id, name) values (%L, 'Rogue team')$q$, current_setting('t.org_a')),
  'member cannot add teams');
select tests.expect_affected(format(
  $q$update public.teams set name = 'Renamed' where id = %L$q$, current_setting('t.team_a_support')), 0,
  'member cannot rename teams');
select tests.expect_error(format(
  $q$insert into public.routing_rules (organization_id, name, conditions, team_id)
     values (%L, 'Rogue', '[{"field":"keyword","value":"x"}]', %L)$q$,
  current_setting('t.org_a'), current_setting('t.team_a_support')), 'member cannot add routing rules');
select tests.expect_affected(format(
  $q$update public.automation_settings set analysis_schedule = 'daily' where organization_id = %L$q$,
  current_setting('t.org_a')), 0, 'member cannot change automation settings');
select tests.expect_affected(format(
  $q$update public.organizations set name = 'Renamed' where id = %L$q$, current_setting('t.org_a')), 0,
  'member cannot rename the company');
select tests.expect_error(format(
  $q$update public.organization_members set role = 'owner' where user_id = %L$q$, current_setting('t.a_member')),
  'member cannot edit their own membership row');
select tests.expect_error(format(
  $q$select public.set_member_role(%L, %L, 'owner')$q$, current_setting('t.org_a'), current_setting('t.a_member')),
  'member cannot promote themselves');
select tests.expect_error(format(
  $q$select public.set_member_role(%L, %L, 'member')$q$, current_setting('t.org_a'), current_setting('t.a_owner')),
  'member cannot demote the owner');
select tests.expect_error(format(
  $q$insert into public.organization_invitations (organization_id, email, role, token_hash)
     values (%L, 'friend@example.com', 'admin', repeat('a', 64))$q$, current_setting('t.org_a')),
  'member cannot invite people');
select tests.expect_rows('select 1 from public.organization_invitations', 0, 'member cannot see invitations');
select tests.expect_error(format(
  $q$select public.remove_member(%L, %L)$q$, current_setting('t.org_a'), current_setting('t.a_owner')),
  'member cannot remove the owner');
select tests.expect_affected($q$update public.profiles set full_name = 'Arjun M.' where id = auth.uid()$q$, 1,
  'member edits their own name');
select tests.expect_affected(format(
  $q$update public.profiles set full_name = 'Hacked' where id = %L$q$, current_setting('t.a_owner')), 0,
  'member cannot edit a colleague''s name');

-- ---------------------------------------------------------------------------
-- Owner of company A
-- ---------------------------------------------------------------------------

select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_affected(format(
  $q$update public.teams set name = 'Hacked' where id = %L$q$, current_setting('t.team_b')), 0,
  'owner A cannot rename company B team');
select tests.expect_error(format(
  $q$insert into public.teams (organization_id, name) values (%L, 'Rogue team')$q$, current_setting('t.org_b')),
  'owner A cannot add a team to company B');
select tests.expect_error(format(
  $q$select public.set_member_role(%L, %L, 'member')$q$, current_setting('t.org_b'), current_setting('t.b_owner')),
  'owner A cannot change roles in company B');
select tests.expect_error(format(
  $q$select public.remove_member(%L, %L)$q$, current_setting('t.org_b'), current_setting('t.b_owner')),
  'owner A cannot remove company B owner');
select tests.expect_rows(format('select 1 from public.organization_invitations where organization_id = %L', current_setting('t.org_a')), 3,
  'owner A sees company A invitations');
select tests.expect_error(format(
  $q$insert into public.routing_rules (organization_id, name, conditions, team_id)
     values (%L, 'Cross', '[{"field":"keyword","value":"x"}]', %L)$q$,
  current_setting('t.org_a'), current_setting('t.team_b')), 'a rule in A cannot send issues to a team in B');
select tests.expect_error(format(
  $q$insert into public.routing_rules (organization_id, name, conditions, team_id)
     values (%L, 'Bad', '[{"field":"password","value":"x"}]', %L)$q$,
  current_setting('t.org_a'), current_setting('t.team_a_support')), 'a rule with an unknown field is rejected');
select tests.expect_error(format(
  $q$insert into public.routing_rules (organization_id, name, conditions, team_id)
     values (%L, 'Empty', '[]', %L)$q$,
  current_setting('t.org_a'), current_setting('t.team_a_support')), 'a rule with no conditions is rejected');
select tests.expect_affected(format(
  $q$update public.automation_settings set analysis_schedule = 'daily' where organization_id = %L$q$,
  current_setting('t.org_a')), 1, 'owner A changes automation settings');
select tests.expect_rows(format(
  'select 1 from public.automation_settings where organization_id = %L and updated_by = %L',
  current_setting('t.org_a'), current_setting('t.a_owner')), 1, 'settings record who changed them');
select tests.expect_error(format(
  $q$update public.organizations set slug = 'stolen' where id = %L$q$, current_setting('t.org_a')),
  'nobody can change a company''s web address after creation');
select tests.expect_error(format(
  $q$select public.set_member_role(%L, %L, 'member')$q$, current_setting('t.org_a'), current_setting('t.a_owner')),
  'owner cannot change their own role');
select tests.expect_error(format(
  $q$select public.remove_member(%L, %L)$q$, current_setting('t.org_a'), current_setting('t.a_owner')),
  'the last owner cannot leave');
select tests.expect_error($q$select public.create_organization('Bad slug', 'Not A Slug!')$q$,
  'a company web address with invalid characters is rejected');
select tests.expect_error($q$select public.create_organization('Copy', 'company-b')$q$,
  'a company web address that is taken is rejected');
select public.set_member_role(current_setting('t.org_a')::uuid, current_setting('t.a_member')::uuid, 'admin');
select tests.pass('owner A promotes the member to admin');

-- ---------------------------------------------------------------------------
-- The promoted admin
-- ---------------------------------------------------------------------------

select tests.act_as(current_setting('t.a_member')::uuid);
select tests.expect_affected(format(
  $q$insert into public.teams (organization_id, name) values (%L, 'A Retention')$q$, current_setting('t.org_a')), 1,
  'admin adds a team');
select tests.expect_affected(format(
  $q$update public.organizations set target_hours_critical = 2, industry = 'Retail' where id = %L$q$, current_setting('t.org_a')), 1,
  'admin edits the company profile and response targets');
select tests.expect_error(format(
  $q$update public.organizations set target_hours_low = 0 where id = %L$q$, current_setting('t.org_a')),
  'a response target below 1 hour is rejected');
select tests.expect_affected(format(
  $q$update public.categories set name = 'A Refunds and credits' where id = %L$q$, current_setting('t.cat_a')), 1,
  'admin renames a category');
select tests.expect_affected(format('delete from public.categories where id = %L', current_setting('t.cat_a')), 1,
  'admin deletes a category');
select tests.expect_rows(format('select 1 from public.issues where id = %L and category_id is null', current_setting('t.issue_a')), 1,
  'deleting a category clears it from issues');
select tests.expect_affected(format('delete from public.categories where id = %L', current_setting('t.cat_b')), 0,
  'admin of A cannot delete company B categories');
select tests.expect_affected(format(
  $q$update public.routing_rules set enabled = false, position = 3, name = 'Refunds (paused)',
     conditions = '[{"field":"urgency","value":"high"},{"field":"keyword","value":"refund"}]', match_mode = 'all'
     where id = %L$q$, current_setting('t.rule_a')), 1,
  'admin edits, pauses and reorders a routing rule');
select tests.expect_error(format(
  $q$update public.routing_rules set team_id = %L where id = %L$q$, current_setting('t.team_b'), current_setting('t.rule_a')),
  'a rule in A cannot be pointed at a team in B');
select tests.expect_error(format(
  $q$update public.routing_rules set conditions = '[{"field":"keyword","value":""}]' where id = %L$q$, current_setting('t.rule_a')),
  'a rule with an empty condition value is rejected');
select tests.expect_error(format(
  $q$update public.routing_rules set match_mode = 'some' where id = %L$q$, current_setting('t.rule_a')),
  'a rule with an unknown match mode is rejected');
select tests.expect_affected(format(
  $q$update public.routing_rules set enabled = false where id = %L$q$, current_setting('t.rule_b')), 0,
  'admin of A cannot change company B routing rules');
select tests.expect_affected(format('delete from public.routing_rules where id = %L', current_setting('t.rule_b')), 0,
  'admin of A cannot delete company B routing rules');
select tests.expect_affected(format('delete from public.routing_rules where id = %L', current_setting('t.rule_a')), 1,
  'admin deletes a routing rule');
select tests.expect_error(format(
  $q$select public.set_member_role(%L, %L, 'owner')$q$, current_setting('t.org_a'), current_setting('t.a_member')),
  'admin cannot make themselves owner');
select tests.expect_error(format(
  $q$select public.remove_member(%L, %L)$q$, current_setting('t.org_a'), current_setting('t.a_owner')),
  'admin cannot remove the owner');
select tests.expect_rows(format('select 1 from public.issues where organization_id = %L', current_setting('t.org_b')), 0,
  'admin of A still sees nothing in company B');

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

select tests.act_as(current_setting('t.unconfirmed')::uuid);
select tests.expect_error($q$select public.accept_invitation('tok-late')$q$,
  'an unconfirmed email cannot accept an invitation');

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error($q$select public.accept_invitation('wrong-code')$q$, 'a wrong invite code is rejected');
select tests.expect_rows($q$select 1 where public.accept_invitation('tok-invitee') = 'company-a'$q$, 1,
  'the invited person joins company A');
select tests.expect_rows(format(
  $q$select 1 from public.organization_members where user_id = auth.uid() and organization_id = %L and role = 'member'$q$,
  current_setting('t.org_a')), 1, 'they join with the role on the invitation');
select tests.expect_error($q$select public.accept_invitation('tok-invitee')$q$, 'an invitation cannot be used twice');

reset role;
update public.organization_invitations set expires_at = now() - interval '1 minute'
  where token_hash = encode(sha256(convert_to('tok-late', 'UTF8')), 'hex');
update auth.users set email_confirmed_at = now() where id = current_setting('t.unconfirmed')::uuid;
set local role authenticated;
select tests.act_as(current_setting('t.unconfirmed')::uuid);
select tests.expect_error($q$select public.accept_invitation('tok-late')$q$, 'an expired invitation is rejected');

-- ---------------------------------------------------------------------------
-- Owner of company B looking at company A
-- ---------------------------------------------------------------------------

select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_rows('select 1 from public.organizations', 1, 'owner B sees only company B');
select tests.expect_rows(format('select 1 from public.issues where organization_id = %L', current_setting('t.org_a')), 0,
  'owner B sees none of company A issues');
select tests.expect_rows(format('select 1 from public.issue_activity where organization_id = %L', current_setting('t.org_a')), 0,
  'owner B sees none of company A history');
select tests.expect_rows(format('select 1 from public.organization_invitations where organization_id = %L', current_setting('t.org_a')), 0,
  'owner B sees none of company A invitations');
select tests.expect_affected(format('delete from public.issues where organization_id = %L', current_setting('t.org_a')), 0,
  'owner B cannot delete company A issues');

-- ---------------------------------------------------------------------------
-- AI analysis (Phase 3): switches, the monthly limit and the analysis record
-- (the invitee is a plain member of company A; Arjun was made an admin above)
-- ---------------------------------------------------------------------------

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_affected(format('update public.organizations set ai_enabled = true where id = %L',
  current_setting('t.org_a')), 0, 'a member cannot switch AI on');
select tests.expect_error(format('select public.start_issue_analysis(%L)', current_setting('t.issue_a')),
  'no analysis while AI is off');

select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_error(format('update public.organizations set ai_monthly_limit = 2001 where id = %L',
  current_setting('t.org_a')), 'the monthly limit cannot go above 2,000');
select tests.expect_affected(format('update public.organizations set ai_enabled = true, ai_monthly_limit = 2 where id = %L',
  current_setting('t.org_a')), 1, 'owner A switches AI on with a limit of 2');
select tests.expect_affected(format($q$insert into public.categories (organization_id, name) values (%L, 'A Billing')$q$,
  current_setting('t.org_a')), 1, 'owner A adds a category for the AI to use');
select set_config('t.cat_a2', (select id::text from public.categories where name = 'A Billing'), true);

select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_error(format('select public.start_issue_analysis(%L)', current_setting('t.issue_a')),
  'owner B cannot start an analysis of a company A issue');
select tests.act_as(current_setting('t.outsider')::uuid);
select tests.expect_error(format('select public.start_issue_analysis(%L)', current_setting('t.issue_a')),
  'an outsider cannot start an analysis');

select tests.act_as(current_setting('t.invitee')::uuid);
select set_config('t.an1', public.start_issue_analysis(current_setting('t.issue_a')::uuid)::text, true);
select tests.expect_rows(format($q$select 1 from public.issue_analyses where id = %L and status = 'pending'$q$,
  current_setting('t.an1')), 1, 'a member starts an analysis');
select tests.expect_error(format('select public.start_issue_analysis(%L)', current_setting('t.issue_a')),
  'the same issue cannot be analysed again within 30 seconds');
select tests.expect_error(format(
  $q$insert into public.issue_analyses (organization_id, issue_id, status, summary) values (%L, %L, 'done', 'x')$q$,
  current_setting('t.org_a'), current_setting('t.issue_a')), 'nobody can add analyses directly');

select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_error(format($q$select public.finish_issue_analysis(%L, '{"ok": false, "reason": "x"}')$q$,
  current_setting('t.an1')), 'owner B cannot finish a company A analysis');
select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_error(format($q$select public.finish_issue_analysis(%L, '{"ok": false, "reason": "x"}')$q$,
  current_setting('t.an1')), 'only the person who started an analysis can finish it');

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format(
  $q$select public.finish_issue_analysis(%L, jsonb_build_object('ok', true, 'sentiment', 'negative',
     'sentiment_score', -0.5, 'intent', 'complaint', 'urgency', 'high', 'category_id', %L, 'summary', 'x'))$q$,
  current_setting('t.an1'), current_setting('t.cat_b')), 'an analysis cannot use another company''s category');
select tests.expect_error(format(
  $q$select public.finish_issue_analysis(%L, jsonb_build_object('ok', true, 'sentiment', 'negative',
     'sentiment_score', -0.5, 'intent', 'complaint', 'urgency', 'extreme', 'summary', 'x'))$q$,
  current_setting('t.an1')), 'an analysis cannot use an unknown urgency');
select tests.expect_rows(format(
  $q$select public.finish_issue_analysis(%L, jsonb_build_object('ok', true, 'sentiment', 'negative',
     'sentiment_score', -0.5, 'intent', 'complaint', 'urgency', 'high', 'category_id', %L,
     'themes', jsonb_build_array('refund'), 'summary', 'Charged twice.', 'suggested_action', 'Refund it.',
     'confidence', 0.9, 'model', 'fake', 'input_tokens', 0, 'output_tokens', 0))$q$,
  current_setting('t.an1'), current_setting('t.cat_a2')), 1, 'the member records the answer');
select tests.expect_rows(format($q$select 1 from public.issue_analyses where id = %L and status = 'done' and urgency = 'high'$q$,
  current_setting('t.an1')), 1, 'the analysis is saved as done');
select tests.expect_rows(format($q$select 1 from public.issue_activity where issue_id = %L and kind = 'ai_analysed'$q$,
  current_setting('t.issue_a')), 1, 'the issue history records the analysis');
select tests.expect_error(format($q$select public.finish_issue_analysis(%L, '{"ok": false, "reason": "x"}')$q$,
  current_setting('t.an1')), 'a finished analysis cannot be changed');
select tests.expect_error(format($q$update public.issue_analyses set urgency = 'low' where id = %L$q$,
  current_setting('t.an1')), 'nobody can edit analyses directly');
select tests.expect_error(format('delete from public.issue_analyses where id = %L', current_setting('t.an1')),
  'nobody can delete analyses');

select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_rows('select 1 from public.issue_analyses', 0, 'owner B sees none of company A analyses');

-- Move the first analysis out of the 30-second window to test the monthly limit.
reset role;
update public.issue_analyses set created_at = now() - interval '1 minute' where id = current_setting('t.an1')::uuid;
set local role authenticated;
select tests.act_as(current_setting('t.invitee')::uuid);
select set_config('t.an2', public.start_issue_analysis(current_setting('t.issue_a')::uuid)::text, true);
select tests.expect_rows(format($q$select public.finish_issue_analysis(%L, '{"ok": false, "reason": "unavailable"}')$q$,
  current_setting('t.an2')), 1, 'a failed analysis is recorded');
select tests.expect_rows(format($q$select 1 from public.issue_analyses where id = %L and status = 'failed'$q$,
  current_setting('t.an2')), 1, 'it is saved as failed');
reset role;
update public.issue_analyses set created_at = now() - interval '1 minute' where id = current_setting('t.an2')::uuid;
set local role authenticated;
select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format('select public.start_issue_analysis(%L)', current_setting('t.issue_a')),
  'no more analyses once the monthly limit is used (failed ones count too)');

-- Accepting AI suggestions (stage 13)
select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_error(format($q$select public.accept_issue_analysis(%L, array['urgency'])$q$,
  current_setting('t.an1')), 'owner B cannot use a company A analysis');
select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format($q$select public.accept_issue_analysis(%L, array['status'])$q$,
  current_setting('t.an1')), 'only AI fields can be accepted');
select tests.expect_error(format($q$select public.accept_issue_analysis(%L, array['urgency'])$q$,
  current_setting('t.an2')), 'a failed analysis cannot be accepted');
select tests.expect_error(format($q$update public.issues set urgency = 'low' where id = %L$q$,
  current_setting('t.issue_a')), 'a member still cannot set urgency directly');
select tests.expect_rows(format($q$select 1 where public.accept_issue_analysis(%L, array['urgency', 'category', 'summary']) = 2$q$,
  current_setting('t.an1')), 1, 'a member accepts the AI urgency and category');
select tests.expect_rows(format($q$select 1 from public.issues where id = %L and urgency = 'high' and category_id = %L
  and analysis_source = 'ai' and summary = 'Charged twice.'$q$,
  current_setting('t.issue_a'), current_setting('t.cat_a2')), 1, 'the issue now has the AI values');
select tests.expect_rows(format($q$select 1 from public.issue_activity where issue_id = %L and kind = 'ai_accepted'$q$,
  current_setting('t.issue_a')), 2, 'each accepted value is in the history');
select tests.expect_rows(format($q$select 1 where public.accept_issue_analysis(%L, array['urgency']) = 0$q$,
  current_setting('t.an1')), 1, 'accepting the same value again changes nothing');

-- Automatic routing switch (stage 14): owners only
select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_affected(format('update public.organizations set ai_auto_route = true where id = %L',
  current_setting('t.org_a')), 0, 'a member cannot switch automatic routing on');
select tests.act_as(current_setting('t.a_member')::uuid);
select tests.expect_error(format('update public.organizations set ai_auto_route = true where id = %L',
  current_setting('t.org_a')), 'an admin cannot switch automatic routing on');
select tests.expect_affected(format('update public.organizations set ai_auto_route = false, ai_monthly_limit = 2 where id = %L',
  current_setting('t.org_a')), 1, 'an admin can still save the other AI settings without changing it');
select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_affected(format('update public.organizations set ai_auto_route = true where id = %L',
  current_setting('t.org_a')), 0, 'owner B cannot switch it on for company A');
select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_affected(format('update public.organizations set ai_auto_route = true where id = %L',
  current_setting('t.org_a')), 1, 'owner A switches automatic routing on');

-- ---------------------------------------------------------------------------
-- Resolution tracking (Phase 4 stage 16)
-- ---------------------------------------------------------------------------

select tests.expect_rows(format($q$select 1 from public.issue_activity where issue_id = %L and kind = 'category_changed'
  and to_value = 'A Billing'$q$, current_setting('t.issue_a')), 0, 'accepting an AI category is recorded once (as ai_accepted), not twice');

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format($q$update public.issues set first_response_at = now() - interval '1 day' where id = %L$q$,
  current_setting('t.issue_a')), 'a member cannot set or backdate the first response directly');
select tests.expect_error(format($q$update public.issues set reopened_count = 0, waiting_seconds = 0 where id = %L$q$,
  current_setting('t.issue_a')), 'a member cannot change the reopen count or waiting time');
select tests.expect_affected(format('update public.organizations set resolution_hours_critical = 1 where id = %L',
  current_setting('t.org_a')), 0, 'a member cannot change resolution targets');

select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_error(format('select public.record_first_response(%L)', current_setting('t.issue_a')),
  'owner B cannot record a first response on a company A issue');

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_rows(format('select 1 where public.record_first_response(%L) is not null', current_setting('t.issue_a')), 1,
  'a member records the first response');
select tests.expect_rows(format('select 1 from public.issues where id = %L and first_response_at is not null and first_response_by = %L',
  current_setting('t.issue_a'), current_setting('t.invitee')), 1, 'it stores when and who');
select tests.expect_error(format('select public.record_first_response(%L)', current_setting('t.issue_a')),
  'the first response cannot be recorded twice');
select tests.expect_rows(format($q$select 1 from public.issue_activity where issue_id = %L and kind = 'first_response'
  and actor_id = %L$q$, current_setting('t.issue_a'), current_setting('t.invitee')), 1, 'the first response is in the history');

select tests.expect_affected(format($q$update public.issues set status = 'waiting_on_customer' where id = %L$q$,
  current_setting('t.issue_a')), 1, 'a member sets Waiting on customer');
select tests.expect_rows(format('select 1 from public.issues where id = %L and waiting_since is not null',
  current_setting('t.issue_a')), 1, 'the waiting spell starts');
reset role;
update public.issues set waiting_since = now() - interval '2 hours' where id = current_setting('t.issue_a')::uuid;
set local role authenticated;
select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_affected(format($q$update public.issues set status = 'in_progress' where id = %L$q$,
  current_setting('t.issue_a')), 1, 'a member moves it back to In progress');
select tests.expect_rows(format('select 1 from public.issues where id = %L and waiting_since is null and waiting_seconds >= 7200',
  current_setting('t.issue_a')), 1, 'the waiting time is added up');

select set_config('t.reopens', (select reopened_count::text from public.issues where id = current_setting('t.issue_a')::uuid), true);
select tests.expect_affected(format($q$update public.issues set status = 'resolved' where id = %L$q$,
  current_setting('t.issue_a')), 1, 'a member resolves the issue');
select tests.expect_rows(format($q$select 1 from (select kind from public.issue_activity where issue_id = %L
  order by id desc limit 1) x where kind = 'resolved'$q$, current_setting('t.issue_a')), 1, 'resolving is in the history');
select tests.expect_affected(format($q$update public.issues set status = 'open' where id = %L$q$,
  current_setting('t.issue_a')), 1, 'a member reopens the issue');
select tests.expect_rows(format($q$select 1 from public.issues where id = %L and reopened_count = %s + 1 and resolved_at is null$q$,
  current_setting('t.issue_a'), current_setting('t.reopens')), 1, 'reopening counts and clears the resolved time');
select tests.expect_rows(format($q$select 1 from (select kind, from_value, to_value from public.issue_activity
  where issue_id = %L order by id desc limit 1) x where kind = 'reopened' and from_value = 'resolved' and to_value = 'open'$q$,
  current_setting('t.issue_a')), 1, 'reopening is in the history');

select tests.expect_affected(format('update public.issues set category_id = %L where id = %L',
  current_setting('t.cat_a2'), current_setting('t.issue_a')), 1, 'a member sets the category');
select tests.expect_affected(format('update public.issues set category_id = null where id = %L',
  current_setting('t.issue_a')), 1, 'a member clears the category');
select tests.expect_rows(format($q$select 1 from (select kind, from_value, to_value from public.issue_activity
  where issue_id = %L order by id desc limit 1) x where kind = 'category_changed' and from_value = 'A Billing' and to_value = 'No category'$q$,
  current_setting('t.issue_a')), 1, 'category changes are in the history');

select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_rows(format('select 1 from public.issue_activity where issue_id = %L', current_setting('t.issue_a')), 0,
  'owner B cannot read company A history');

select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_error(format('update public.organizations set resolution_hours_low = 2161 where id = %L',
  current_setting('t.org_a')), 'resolution targets cannot go above 2,160 hours');
select tests.expect_affected(format('update public.organizations set resolution_hours_critical = 10 where id = %L',
  current_setting('t.org_a')), 1, 'owner A changes a resolution target');

-- ---------------------------------------------------------------------------
-- Escalations (Phase 4 stage 17)
-- ---------------------------------------------------------------------------

reset role;
select tests.expect_rows(format('select 1 from public.escalation_settings where organization_id in (%L, %L)',
  current_setting('t.org_a'), current_setting('t.org_b')), 2, 'every company has escalation settings');
select tests.expect_rows(format($q$select 1 from public.escalation_settings where organization_id = %L
  and not (first_response_enabled or resolution_enabled or urgent_no_team_enabled or no_team_enabled or no_update_enabled)$q$,
  current_setting('t.org_a')), 1, 'all escalation conditions start off');
set local role authenticated;

select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_error(format('select * from public.run_escalation_check(%L)', current_setting('t.org_a')),
  'a check needs at least one condition switched on');

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_affected(format('update public.escalation_settings set no_team_enabled = true where organization_id = %L',
  current_setting('t.org_a')), 0, 'a member cannot change escalation settings');
select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_affected(format('update public.escalation_settings set no_team_enabled = true where organization_id = %L',
  current_setting('t.org_a')), 0, 'owner B cannot change company A escalation settings');
select tests.expect_rows(format('select 1 from public.escalation_settings where organization_id = %L', current_setting('t.org_a')), 0,
  'owner B cannot read company A escalation settings');

select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_error(format('update public.escalation_settings set no_update_hours = 0 where organization_id = %L',
  current_setting('t.org_a')), 'escalation thresholds are checked');
select tests.expect_affected(format($q$update public.escalation_settings set first_response_enabled = true,
  resolution_enabled = true, urgent_no_team_enabled = true, urgent_no_team_hours = 0, no_team_enabled = true,
  no_team_hours = 0, no_update_enabled = true, no_update_hours = 1 where organization_id = %L$q$,
  current_setting('t.org_a')), 1, 'owner A switches on every condition');

-- A critical issue with no team that arrived 30 days ago and hasn't changed for 10.
select tests.expect_affected(format(
  $q$insert into public.issues (organization_id, reference, customer_name, channel, subject, message, urgency)
     values (%L, 'A-ESC', 'Customer Esc', 'email', 'Still broken', 'Nothing works.', 'critical')$q$,
  current_setting('t.org_a')), 1, 'owner A creates a critical issue with no team');
reset role;
select set_config('t.issue_esc', (select id::text from public.issues where reference = 'A-ESC'), true);
set local session_replication_role = replica;
update public.issues set received_at = now() - interval '30 days', updated_at = now() - interval '10 days'
  where id = current_setting('t.issue_esc')::uuid;
set local session_replication_role = origin;
set local role authenticated;

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format('select * from public.run_escalation_check(%L)', current_setting('t.org_a')),
  'a member cannot run an escalation check');
select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_error(format('select * from public.run_escalation_check(%L)', current_setting('t.org_a')),
  'owner B cannot run a check for company A');
select tests.expect_error(format($q$select private.run_escalation_check(%L, 'manual', null)$q$, current_setting('t.org_a')),
  'nobody can call the internal check directly');

select tests.act_as(current_setting('t.a_member')::uuid);
select tests.expect_rows(format('select 1 from public.run_escalation_check(%L) where error is null and escalations_created >= 5',
  current_setting('t.org_a')), 1, 'an admin runs the check');
select tests.expect_rows(format('select 1 from public.escalations where issue_id = %L', current_setting('t.issue_esc')), 5,
  'the issue is escalated once for each condition it meets');
select tests.expect_rows(format($q$select 1 from public.escalations where issue_id = %L and condition = 'urgent_no_team'
  and level = 2 and reason = 'Critical issue still has no team after 30 d.'$q$, current_setting('t.issue_esc')), 1,
  'a critical issue with no team is level 2, with a plain reason');
select tests.expect_rows(format($q$select 1 from public.escalations where issue_id = %L and condition = 'first_response_breached'
  and level = 1 and reason like 'First response was due %% (UTC). None recorded yet: %% late.'$q$, current_setting('t.issue_esc')), 1,
  'a first-response breach says when it was due');
select tests.expect_rows(format($q$select 1 from public.issues where id = %L and status = 'new' and urgency = 'critical'
  and team_id is null$q$, current_setting('t.issue_esc')), 1, 'escalating does not change the issue status, urgency or team');
select tests.expect_rows(format($q$select 1 from public.issue_activity where issue_id = %L and kind = 'escalated'$q$,
  current_setting('t.issue_esc')), 5, 'each escalation is in the history');
select tests.expect_rows(format('select 1 from public.run_escalation_check(%L) where escalations_created = 0',
  current_setting('t.org_a')), 1, 'running the check again creates nothing new');
select tests.expect_rows(format($q$select 1 from public.escalation_runs where organization_id = %L and source = 'manual'
  and error is null and finished_at is not null and started_by = %L$q$, current_setting('t.org_a'), current_setting('t.a_member')), 2,
  'both checks are in the run log');

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_rows(format('select 1 from public.escalations where issue_id = %L', current_setting('t.issue_esc')), 5,
  'a member sees the escalations');
select tests.expect_error(format($q$insert into public.escalations (organization_id, issue_id, condition, level, reason, spell)
  values (%L, %L, 'no_team', 1, 'fake', 9)$q$, current_setting('t.org_a'), current_setting('t.issue_esc')),
  'nobody can add escalations directly');
select tests.expect_error(format('update public.escalations set acknowledged_at = now() where issue_id = %L',
  current_setting('t.issue_esc')), 'nobody can edit escalations directly');
select tests.expect_error(format('delete from public.escalations where issue_id = %L', current_setting('t.issue_esc')),
  'nobody can delete escalations');
select tests.expect_error(format($q$insert into public.escalation_runs (organization_id, source) values (%L, 'manual')$q$,
  current_setting('t.org_a')), 'nobody can add to the run log directly');

select set_config('t.esc1', (select id::text from public.escalations where issue_id = current_setting('t.issue_esc')::uuid
  and condition = 'no_team'), true);
select set_config('t.esc2', (select id::text from public.escalations where issue_id = current_setting('t.issue_esc')::uuid
  and condition = 'no_update'), true);

select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_rows('select 1 from public.escalations', 0, 'owner B sees none of company A escalations');
select tests.expect_rows('select 1 from public.escalation_runs', 0, 'owner B sees none of company A checks');
select tests.expect_error(format('select public.acknowledge_escalation(%L)', current_setting('t.esc1')),
  'owner B cannot acknowledge a company A escalation');

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format('select public.acknowledge_escalation(%L, %L)', current_setting('t.esc1'), repeat('x', 501)),
  'an acknowledgement note is limited to 500 characters');
select tests.expect_rows(format($q$select 1 where public.acknowledge_escalation(%L, '  Calling them now  ') is not null$q$,
  current_setting('t.esc1')), 1, 'a member acknowledges an escalation');
select tests.expect_rows(format($q$select 1 from public.escalations where id = %L and acknowledged_by = %L
  and acknowledged_at is not null and acknowledge_note = 'Calling them now'$q$, current_setting('t.esc1'), current_setting('t.invitee')), 1,
  'it records who, when and the note');
select tests.expect_rows(format($q$select 1 from public.issue_activity where issue_id = %L and kind = 'escalation_acknowledged'
  and actor_id = %L and from_value = 'no_team'$q$, current_setting('t.issue_esc'), current_setting('t.invitee')), 1,
  'the acknowledgement is in the history');
select tests.expect_error(format('select public.acknowledge_escalation(%L)', current_setting('t.esc1')),
  'an escalation cannot be acknowledged twice');
select tests.expect_rows(format('select 1 where public.acknowledge_escalation(%L, null) is not null', current_setting('t.esc2')), 1,
  'the note is optional');

-- Resolved issues are not checked; reopening starts a new spell.
select tests.expect_affected(format($q$update public.issues set status = 'resolved' where id = %L$q$,
  current_setting('t.issue_esc')), 1, 'a member resolves the escalated issue');
select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_rows(format('select 1 from public.run_escalation_check(%L) where escalations_created = 0',
  current_setting('t.org_a')), 1, 'a resolved issue is not escalated');
select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_affected(format($q$update public.issues set status = 'open' where id = %L$q$,
  current_setting('t.issue_esc')), 1, 'a member reopens it');

-- A check that fails is logged with the reason and saves nothing.
select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_affected(format($q$update public.organizations set timezone = 'Not/AZone' where id = %L$q$,
  current_setting('t.org_a')), 1, 'owner A sets a time zone the database does not know');
select tests.expect_rows(format('select 1 from public.run_escalation_check(%L) where error is not null and escalations_created = 0',
  current_setting('t.org_a')), 1, 'a failed check reports its error');
select tests.expect_rows(format('select 1 from public.escalations where issue_id = %L and spell > 0', current_setting('t.issue_esc')), 0,
  'a failed check saves no escalations');
select tests.expect_affected(format($q$update public.organizations set timezone = 'UTC' where id = %L$q$,
  current_setting('t.org_a')), 1, 'owner A puts the time zone back');
select tests.expect_rows(format('select 1 from public.run_escalation_check(%L) where error is null and escalations_created > 0',
  current_setting('t.org_a')), 1, 'after a reopen the check escalates again');
select tests.expect_rows(format($q$select 1 from public.escalations where issue_id = %L and spell = 1
  and condition = 'first_response_breached'$q$, current_setting('t.issue_esc')), 1, 'the new escalation belongs to the new spell');

-- ---------------------------------------------------------------------------
-- Routing history and dismissed suggestions (Phase 4 stage 18)
-- ---------------------------------------------------------------------------

select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_affected(format(
  $q$insert into public.routing_rules (organization_id, name, conditions, team_id)
     select %L, 'Broken to billing', '[{"field":"keyword","value":"broken"}]', id
     from public.teams where organization_id = %L and name = 'A Billing'$q$,
  current_setting('t.org_a'), current_setting('t.org_a')), 1, 'owner A adds a routing rule for the routing history checks');
reset role;
select set_config('t.rule_r', (select id::text from public.routing_rules where name = 'Broken to billing'), true);
update public.issues set team_id = null, routing_dismissed_at = null where id = current_setting('t.issue_esc')::uuid;
set local role authenticated;

select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_error(format('select public.apply_routing_rule(%L, %L, null)', current_setting('t.issue_esc'), current_setting('t.rule_r')),
  'owner B cannot apply a rule to a company A issue');
select tests.expect_error(format('select public.dismiss_routing_suggestion(%L)', current_setting('t.issue_esc')),
  'owner B cannot dismiss a company A suggestion');

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format('select public.apply_routing_rule(%L, gen_random_uuid(), null)', current_setting('t.issue_esc')),
  'a rule from another company (or a deleted one) cannot be applied');
select tests.expect_rows(format('select 1 where public.apply_routing_rule(%L, %L, null)', current_setting('t.issue_esc'), current_setting('t.rule_r')), 1,
  'a member applies a rule to an issue with no team');
select tests.expect_rows(format($q$select 1 from public.issues i join public.teams t on t.id = i.team_id
  where i.id = %L and t.name = 'A Billing'$q$, current_setting('t.issue_esc')), 1, 'the issue gets the rule''s team');
select tests.expect_rows(format($q$select 1 from public.issue_activity where issue_id = %L and kind = 'routing_applied'
  and from_value = 'Broken to billing' and to_value = 'A Billing' and actor_id = %L$q$,
  current_setting('t.issue_esc'), current_setting('t.invitee')), 1, 'the history names the rule and the team');
select tests.expect_rows(format($q$select 1 from public.issue_activity where issue_id = %L and kind = 'team_changed'$q$,
  current_setting('t.issue_esc')), 0, 'a team set by a rule is not recorded twice');
select tests.expect_rows(format('select 1 where not public.apply_routing_rule(%L, %L, null)', current_setting('t.issue_esc'), current_setting('t.rule_r')), 1,
  'a rule never overwrites a team that was set in the meantime');

select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_affected(format('update public.issues set team_id = null where id = %L', current_setting('t.issue_esc')), 1,
  'owner A clears the team again');
select tests.expect_rows(format($q$select 1 from (select kind from public.issue_activity where issue_id = %L
  order by id desc limit 1) x where kind = 'team_changed'$q$, current_setting('t.issue_esc')), 1, 'a team changed by hand is still recorded');
select tests.expect_affected(format('update public.routing_rules set enabled = false where id = %L', current_setting('t.rule_r')), 1,
  'owner A switches the rule off');
select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format('select public.apply_routing_rule(%L, %L, null)', current_setting('t.issue_esc'), current_setting('t.rule_r')),
  'a switched-off rule cannot be applied');
select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_affected(format('update public.routing_rules set enabled = true where id = %L', current_setting('t.rule_r')), 1,
  'owner A switches the rule back on');

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format('update public.issues set routing_dismissed_at = now() where id = %L', current_setting('t.issue_esc')),
  'a member cannot set the dismissed time directly');
select tests.expect_rows(format('select 1 where public.dismiss_routing_suggestion(%L) is not null', current_setting('t.issue_esc')), 1,
  'a member dismisses the suggestion');
select tests.expect_rows(format($q$select 1 from public.issue_activity where issue_id = %L and kind = 'routing_dismissed'
  and actor_id = %L$q$, current_setting('t.issue_esc'), current_setting('t.invitee')), 1, 'dismissing is in the history');
select tests.expect_error(format('select public.dismiss_routing_suggestion(%L)', current_setting('t.issue_esc')),
  'a suggestion cannot be dismissed twice');
select tests.expect_affected(format('update public.issues set status = %L where id = %L', 'in_progress', current_setting('t.issue_esc')), 1,
  'a member changes the status');
select tests.expect_rows(format('select 1 from public.issues where id = %L and routing_dismissed_at is not null',
  current_setting('t.issue_esc')), 1, 'a status change keeps the suggestion dismissed');
select tests.expect_affected(format('update public.issues set category_id = %L where id = %L',
  current_setting('t.cat_a2'), current_setting('t.issue_esc')), 1, 'a member changes the category');
select tests.expect_rows(format('select 1 from public.issues where id = %L and routing_dismissed_at is null',
  current_setting('t.issue_esc')), 1, 'a category change brings the suggestion back');

-- ---------------------------------------------------------------------------
-- Scheduled escalation checks (Phase 4 stage 20)
-- ---------------------------------------------------------------------------

select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error('select private.run_scheduled_escalation_checks()',
  'a member cannot start the scheduled checks');
select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_error('select private.run_scheduled_escalation_checks()',
  'an owner cannot start the scheduled checks directly');
select tests.expect_error(format($q$insert into public.escalation_runs (organization_id, source) values (%L, 'scheduled')$q$,
  current_setting('t.org_a')), 'nobody can fake a scheduled check from the app');

reset role;
select tests.expect_rows($q$select 1 from cron.job where jobname = 'buddy-escalation-check'
  and schedule = '*/15 * * * *' and command = 'select private.run_scheduled_escalation_checks()' and active$q$, 1,
  'the scheduler runs the checks every 15 minutes');
update public.escalation_settings set first_response_enabled = false, resolution_enabled = false,
  urgent_no_team_enabled = false, no_team_enabled = false, no_update_enabled = false
  where organization_id = current_setting('t.org_b')::uuid;
select set_config('t.esc_before', (select count(*)::text from public.escalations
  where organization_id = current_setting('t.org_a')::uuid), true);
select tests.expect_rows('select 1 where private.run_scheduled_escalation_checks() >= 1', 1,
  'the scheduler checks the companies that have a condition on');
select tests.expect_rows(format($q$select 1 from public.escalation_runs where organization_id = %L and source = 'scheduled'
  and started_by is null and finished_at is not null and error is null$q$, current_setting('t.org_a')), 1,
  'a scheduled check is logged for company A, with no person as its starter');
select tests.expect_rows(format($q$select 1 from public.escalation_runs where organization_id = %L and source = 'scheduled'$q$,
  current_setting('t.org_b')), 0, 'a company with every condition off is not checked');
select tests.expect_rows(format('select 1 from public.escalations where organization_id = %L having count(*) = %s',
  current_setting('t.org_a'), current_setting('t.esc_before')), 1,
  'a scheduled check after Check now repeats no escalation');

set local role authenticated;
select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_rows(format($q$select 1 from public.escalation_runs where organization_id = %L and source = 'scheduled'$q$,
  current_setting('t.org_a')), 1, 'members of company A see the scheduled check');
select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_rows($q$select 1 from public.escalation_runs where source = 'scheduled'$q$, 0,
  'owner B cannot see company A''s scheduled checks');

-- ---------------------------------------------------------------------------
-- Imports: source fields, customer email, import log (Phase 5 stage 22)
-- ---------------------------------------------------------------------------

set local role authenticated;
select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_error(format($q$select public.start_import(%L, 'csv', 'x.csv')$q$, current_setting('t.org_a')),
  'a member cannot start an import');
select tests.act_as(current_setting('t.outsider')::uuid);
select tests.expect_error(format($q$select public.start_import(%L, 'csv', 'x.csv')$q$, current_setting('t.org_a')),
  'an outsider cannot start an import in company A');
select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_error(format($q$select public.start_import(%L, 'csv', 'x.csv')$q$, current_setting('t.org_a')),
  'owner B cannot start an import in company A');
select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_error(format($q$select public.start_import(%L, 'gmail', '')$q$, current_setting('t.org_a')),
  'Gmail imports cannot be started this way');
select set_config('t.run_a', public.start_import(current_setting('t.org_a')::uuid, 'csv', 'october.csv')::text, true);
select tests.expect_rows(format($q$select 1 from public.import_runs where id = %L and status = 'running'
  and started_by = %L and file_name = 'october.csv'$q$, current_setting('t.run_a'), current_setting('t.a_owner')), 1,
  'owner A starts an import');

select set_config('t.import_result', public.import_issues(current_setting('t.run_a')::uuid, $j$[
  {"row": 2, "customer_name": "Test Customer", "customer_email": "Test@Example.com", "channel": "email",
   "subject": "Late delivery", "message": "My parcel is late.", "received_at": "2026-10-01T09:00:00Z", "record_id": "T-1"},
  {"row": 3, "customer_name": "Test Customer", "channel": "email",
   "subject": "Late delivery", "message": "Same ID again.", "received_at": "2026-10-01T09:00:00Z", "record_id": "T-1"},
  {"row": 4, "customer_name": "Other Customer", "channel": "live_chat",
   "subject": "Refund", "message": "Where is my refund?", "received_at": "2026-10-02T10:00:00Z"},
  {"row": 5, "customer_name": "No Message", "channel": "email", "subject": "Empty", "message": "  ",
   "received_at": "2026-10-02T10:00:00Z"},
  {"row": 6, "customer_name": "Bad Channel", "channel": "fax", "subject": "Hi", "message": "Hello",
   "received_at": "2026-10-02T10:00:00Z"},
  {"row": 7, "customer_name": "Bad Date", "channel": "email", "subject": "Hi", "message": "Hello",
   "received_at": "next tuesday"},
  {"row": 8, "customer_name": "Future", "channel": "email", "subject": "Hi", "message": "Hello",
   "received_at": "2099-01-01T00:00:00Z"},
  {"row": 9, "customer_name": "Bad Email", "customer_email": "not-an-address", "channel": "email",
   "subject": "Hi", "message": "Hello", "received_at": "2026-10-02T10:00:00Z"}
]$j$::jsonb)::text, true);
select tests.expect_rows($q$select 1 from jsonb_array_elements(current_setting('t.import_result')::jsonb) x
  where x->>'outcome' = 'imported'$q$, 2, 'valid rows are imported');
select tests.expect_rows($q$select 1 from jsonb_array_elements(current_setting('t.import_result')::jsonb) x
  where x->>'outcome' = 'duplicate' and (x->>'row')::int = 3$q$, 1, 'a second row with the same ID is skipped as a duplicate');
select tests.expect_rows($q$select 1 from jsonb_array_elements(current_setting('t.import_result')::jsonb) x
  where x->>'outcome' = 'rejected'$q$, 5, 'empty message, unknown channel, bad date, future date and bad email are rejected');
select tests.expect_rows(format($q$select 1 from public.issues where import_run_id = %L and source = 'csv'
  and created_by = %L and analysis_source = 'manual' and status = 'new'$q$,
  current_setting('t.run_a'), current_setting('t.a_owner')), 2, 'imported issues are new, manual and owned by the importer');
select tests.expect_rows(format($q$select 1 from public.issues where import_run_id = %L and source_record_id = 'T-1'
  and customer_email = 'test@example.com' and received_at = '2026-10-01T09:00:00Z'$q$, current_setting('t.run_a')), 1,
  'the ID, the email (in lower case) and the received time are kept');
select tests.expect_rows(format($q$select 1 from public.issues where import_run_id = %L and source_record_id like 'fp:%%'$q$,
  current_setting('t.run_a')), 1, 'a row without an ID gets a fingerprint');
select tests.expect_rows(format($q$select 1 from public.issue_activity a join public.issues i on i.id = a.issue_id
  where i.import_run_id = %L and a.kind = 'created' and a.actor_id = %L$q$,
  current_setting('t.run_a'), current_setting('t.a_owner')), 2, 'each imported issue has a "created" history entry');
select tests.expect_rows(format($q$select 1 from public.import_runs where id = %L and rows_examined = 8 and imported = 2
  and skipped_duplicate = 1 and rejected = 5 and jsonb_array_length(problems) = 5
  and not problems::text ilike '%%hello%%'$q$, current_setting('t.run_a')), 1,
  'the import log counts every row and keeps reasons without the customer''s text');

select tests.expect_rows(format($q$select 1 from jsonb_array_elements(public.import_issues(%L, '[
  {"row": 2, "customer_name": "Other Customer", "channel": "live_chat", "subject": "Refund",
   "message": "Where is my refund?", "received_at": "2026-10-02T10:00:00Z"}]'::jsonb)) x where x->>'outcome' = 'duplicate'$q$,
  current_setting('t.run_a')), 1, 'the same row without an ID is a duplicate the second time');
select tests.expect_error(format($q$select public.import_issues(%L, (select jsonb_agg(jsonb_build_object('row', g))
  from generate_series(1, 501) g))$q$, current_setting('t.run_a')), 'more than 500 rows at once is refused');

select tests.act_as(current_setting('t.a_member')::uuid);
select tests.expect_error(format($q$select public.import_issues(%L, '[]'::jsonb)$q$, current_setting('t.run_a')),
  'an admin cannot add rows to an import someone else started');
select tests.expect_error(format($q$select public.finish_import(%L)$q$, gen_random_uuid()),
  'an unknown import cannot be finished');
select tests.act_as(current_setting('t.b_owner')::uuid);
select tests.expect_error(format($q$select public.import_issues(%L, '[]'::jsonb)$q$, current_setting('t.run_a')),
  'owner B cannot add rows to company A''s import');
select tests.expect_error(format($q$select public.finish_import(%L)$q$, current_setting('t.run_a')),
  'owner B cannot finish company A''s import');

select tests.act_as(current_setting('t.a_owner')::uuid);
select public.finish_import(current_setting('t.run_a')::uuid);
select tests.expect_rows(format($q$select 1 from public.import_runs where id = %L and status = 'finished'
  and finished_at is not null and error is null$q$, current_setting('t.run_a')), 1, 'owner A finishes the import');
select tests.expect_error(format($q$select public.import_issues(%L, '[]'::jsonb)$q$, current_setting('t.run_a')),
  'a finished import takes no more rows');
select tests.expect_error(format($q$select public.finish_import(%L)$q$, current_setting('t.run_a')),
  'an import cannot be finished twice');

-- Past conversations: resolved when they were received, never escalated as late.
select set_config('t.run_h', public.start_import(current_setting('t.org_a')::uuid, 'csv', 'history.csv')::text, true);
select tests.expect_rows(format($q$select 1 from jsonb_array_elements(public.import_issues(%L, '[
  {"row": 2, "customer_name": "Old Customer", "channel": "email", "subject": "Old question",
   "message": "From last year.", "received_at": "2025-06-01T08:00:00Z", "record_id": "H-1"}]'::jsonb, true)) x
  where x->>'outcome' = 'imported'$q$, current_setting('t.run_h')), 1, 'a history row is imported');
select tests.expect_rows(format($q$select 1 from public.issues where source_record_id = 'H-1' and organization_id = %L
  and status = 'resolved' and resolved_at = '2025-06-01T08:00:00Z'$q$, current_setting('t.org_a')), 1,
  'a history row is resolved at the time it was received, not today');
select public.finish_import(current_setting('t.run_h')::uuid, 'The browser stopped before sending every row.');
select tests.expect_rows(format($q$select 1 from public.import_runs where id = %L and status = 'failed' and imported = 1$q$,
  current_setting('t.run_h')), 1, 'an import that stopped early is logged as failed, with what it saved');

-- The same ID in another company is a different record.
select tests.act_as(current_setting('t.b_owner')::uuid);
select set_config('t.run_b', public.start_import(current_setting('t.org_b')::uuid, 'csv', 'b.csv')::text, true);
select tests.expect_rows(format($q$select 1 from jsonb_array_elements(public.import_issues(%L, '[
  {"row": 2, "customer_name": "B Customer", "channel": "email", "subject": "B issue",
   "message": "Company B message.", "received_at": "2026-10-01T09:00:00Z", "record_id": "T-1"}]'::jsonb)) x
  where x->>'outcome' = 'imported'$q$, current_setting('t.run_b')), 1,
  'company B can import a record with the same ID as company A');
select tests.expect_rows('select 1 from public.import_runs', 1, 'owner B sees only company B''s import');
select tests.expect_rows(format('select 1 from public.issues where import_run_id in (%L, %L)',
  current_setting('t.run_a'), current_setting('t.run_h')), 0, 'owner B sees none of company A''s imported issues');

-- Members see their company's imports but cannot write the log or the source fields.
select tests.act_as(current_setting('t.invitee')::uuid);
select tests.expect_rows(format('select 1 from public.import_runs where organization_id = %L', current_setting('t.org_a')), 2,
  'a member of company A sees its import history');
select tests.expect_error(format($q$insert into public.import_runs (organization_id, source) values (%L, 'csv')$q$,
  current_setting('t.org_a')), 'nobody can write the import log directly');
select tests.expect_error(format($q$update public.import_runs set imported = 999 where id = %L$q$, current_setting('t.run_a')),
  'nobody can change the import log');
select tests.expect_error(format($q$delete from public.import_runs where id = %L$q$, current_setting('t.run_a')),
  'nobody can delete from the import log');
select tests.expect_error(format($q$insert into public.issues (organization_id, customer_name, channel, subject, message,
  created_by, source, source_record_id) values (%L, 'Fake', 'email', 'Fake', 'Fake', %L, 'csv', 'T-9')$q$,
  current_setting('t.org_a'), current_setting('t.invitee')), 'a member cannot label a typed issue as imported');
select tests.expect_error(format($q$update public.issues set customer_email = 'x@example.com' where id = %L$q$,
  current_setting('t.issue_esc')), 'nobody can change a customer''s email address after the fact');
select tests.expect_affected(format($q$insert into public.issues (organization_id, customer_name, customer_email, channel,
  subject, message, created_by) values (%L, 'Typed Customer', 'typed@example.com', 'email', 'Typed', 'Typed by hand', %L)$q$,
  current_setting('t.org_a'), current_setting('t.invitee')), 1, 'a member can type an email address on a new issue');
select tests.expect_rows($q$select 1 from public.issues where customer_name = 'Typed Customer' and source = 'manual'
  and source_record_id is null$q$, 1, 'a typed issue is recorded as manual');
select tests.expect_error(format($q$insert into public.issues (organization_id, customer_name, customer_email, channel,
  subject, message, created_by) values (%L, 'Typed', 'Not An Email', 'email', 'Typed', 'Typed', %L)$q$,
  current_setting('t.org_a'), current_setting('t.invitee')), 'an invalid email address is refused');

reset role;
select tests.expect_error(format($q$insert into public.issues (organization_id, customer_name, channel, subject, message,
  source, source_record_id) values (%L, 'Copy', 'email', 'Copy', 'Copy', 'csv', 'T-1')$q$, current_setting('t.org_a')),
  'the database itself refuses a second issue for the same record');
set local role authenticated;

-- Deleting the issue keeps its analyses, so the monthly count cannot be reset.
select tests.act_as(current_setting('t.a_owner')::uuid);
select tests.expect_affected(format('delete from public.issues where id = %L', current_setting('t.issue_a')), 1,
  'owner A deletes the analysed issue');
select tests.expect_rows(format('select 1 from public.issue_analyses where organization_id = %L and issue_id is null',
  current_setting('t.org_a')), 2, 'its analyses still count towards the month');

reset role;
select current_setting('tests.passed') || ' security checks passed' as result;

rollback;
