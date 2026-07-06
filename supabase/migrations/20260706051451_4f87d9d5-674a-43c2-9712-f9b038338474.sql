
-- 1) Fix mutable search_path on set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- 2) Revoke default PUBLIC/anon/authenticated EXECUTE on all SECURITY DEFINER and trigger functions,
--    then grant back only where the app requires it.

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_roles() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.equipment_available_qty(uuid, date, time, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_booking(uuid, date, time, time, integer, text) FROM PUBLIC, anon, authenticated;

-- has_role is invoked inline by RLS policies as the querying role.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- App calls these RPCs as an authenticated user.
GRANT EXECUTE ON FUNCTION public.equipment_available_qty(uuid, date, time, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, date, time, time, integer, text) TO authenticated;

-- 3) Replace always-true audit_logs INSERT policy with an owner-scoped rule.
DROP POLICY IF EXISTS audit_insert_any ON public.audit_logs;
CREATE POLICY audit_insert_self ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
