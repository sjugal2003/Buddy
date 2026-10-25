-- Local database only: `npx supabase db reset` and `npx supabase start` run
-- this file; `npx supabase db push` never sends it to the hosted project.
--
-- Browser tests add many fake AI analyses, so the limit for the whole app
-- (300 a month on the hosted project) is raised here so repeated local test
-- runs don't use it up. supabase/tests/security_test.sql checks the limit
-- itself with its own value.
update private.platform_settings set ai_monthly_cap = 100000;
