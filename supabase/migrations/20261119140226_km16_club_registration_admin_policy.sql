create function public.km16_club_registration_is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.km16_ops_is_admin() $$;
revoke all on function public.km16_club_registration_is_admin() from public, anon;
grant execute on function public.km16_club_registration_is_admin() to authenticated;
alter policy club_registration_read on public.km16_club_registrations using ((select public.km16_club_registration_is_admin()));
alter policy club_registration_write on public.km16_club_registrations with check ((select public.km16_club_registration_is_admin()) and recorded_by=(select auth.uid()));
