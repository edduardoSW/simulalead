-- Run after `supabase db reset`: psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/database_tests.sql
begin;

do $$ begin
  assert (select count(*)=5 from public.lead_profiles where organization_id='10000000-0000-0000-0000-000000000001'), 'expected five lead profiles';
  assert (select count(*)=5 from public.training_scenarios where organization_id='10000000-0000-0000-0000-000000000001'), 'expected five scenarios';
  assert (select sum(weight)=100 from public.rubric_criteria where rubric_id='40000000-0000-0000-0000-000000000001'), 'rubric weights must total 100';
end $$;

-- Constraint: duplicate sequence in one session is covered by UNIQUE(session_id, sequence_number).
do $$ begin
  assert exists (
    select 1 from pg_constraint where conrelid='public.training_messages'::regclass and contype='u'
  ), 'training_messages unique constraint missing';
  assert not exists (
    select 1 from pg_tables where schemaname='public' and rowsecurity=false
  ), 'all public tables must have RLS enabled';
  assert to_regclass('public.simulated_accounts') is not null, 'simulated accounts table missing';
  assert to_regclass('public.simulated_contacts') is not null, 'simulated contacts table missing';
  assert to_regclass('public.conversation_participants') is not null, 'conversation participants table missing';
  assert to_regclass('public.contact_handoffs') is not null, 'contact handoffs table missing';
  assert to_regclass('public.organization_invitations') is not null, 'organization invitations table missing';
end $$;

rollback;
