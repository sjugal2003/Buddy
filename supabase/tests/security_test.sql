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

select tests.expect_rows('select 1 from public.profiles', 6, 'a profile is created for every sign-up');

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

reset role;
select current_setting('tests.passed') || ' security checks passed' as result;

rollback;
