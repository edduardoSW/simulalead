begin;

grant select, insert, update on public.user_simulations to authenticated;
grant select on public.simulation_generations to authenticated;

-- Make the newly exposed relations available to PostgREST immediately.
notify pgrst, 'reload schema';

commit;
