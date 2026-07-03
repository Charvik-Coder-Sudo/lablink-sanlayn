
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_user_profile_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_returned_by_profile_fk FOREIGN KEY (returned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_user_profile_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
