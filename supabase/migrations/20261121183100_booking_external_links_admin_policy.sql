-- Reuse the server-side administrator check. The authenticated role has
-- no direct SELECT privilege on auth.users.
ALTER POLICY km16_external_links_admin ON public.km16_booking_external_links
  TO authenticated
  USING ((SELECT public.km16_club_registration_is_admin()))
  WITH CHECK ((SELECT public.km16_club_registration_is_admin()));
