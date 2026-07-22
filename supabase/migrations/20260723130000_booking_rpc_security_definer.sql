-- ROOT-CAUSE FIX: normal users could not book equipment/accessories.
--
-- Symptoms: POST /rpc/create_booking and /rpc/create_accessory_booking returned
-- 400 Bad Request, and the UI showed "Equipment not found", but ONLY for
-- non-admin/non-manager users. Booking worked when tested as an admin.
--
-- Cause: these RPCs were SECURITY INVOKER (set by 20260706051517, intended as
-- hardening). Two RLS interactions break them for a normal user:
--
--   1. `SELECT ... FROM equipment WHERE id = _equipment_id FOR UPDATE` — Postgres
--      applies BOTH the SELECT policy AND the UPDATE policy to a locking SELECT.
--      The equipment/accessories UPDATE policy (equipment_write_privileged) only
--      allows admin/manager, so the row is filtered out for employees → v_total is
--      NULL → RAISE 'equipment_not_found' → PostgREST maps SQLSTATE P0001 to
--      HTTP 400. (Proven: as an employee, a plain SELECT on an equipment row
--      returns 1 row, but SELECT ... FOR UPDATE returns 0 rows.)
--
--   2. The capacity check `SELECT SUM(quantity) FROM bookings WHERE equipment_id=...`
--      runs under the caller's RLS. bookings_select_own_or_privileged means an
--      employee only sees THEIR OWN bookings, so the sum omits everyone else's —
--      reporting too much availability and permitting overbooking. (Proven: for a
--      1-unit item fully booked by an admin, equipment_available_qty returns 0 for
--      the admin/owner but 1 for a different employee.)
--
-- Fix: these functions enforce a GLOBAL inventory invariant (total capacity across
-- ALL users) and must lock the inventory row — both require transcending the
-- caller's row visibility. That is exactly what SECURITY DEFINER is for. They keep
-- their pinned `search_path = public`, all validate `auth.uid()`, and only ever
-- insert rows with `user_id = auth.uid()`, so the definer privilege cannot be used
-- to act as another user. Owner is `postgres` and no table uses FORCE ROW LEVEL
-- SECURITY, so the definer correctly bypasses RLS for the capacity check.
--
-- cancel_booking / return_booking (and accessory equivalents) are intentionally
-- left SECURITY INVOKER: they only touch the bookings tables, where the row owner
-- and privileged roles already satisfy the bookings UPDATE policy, so RLS does not
-- block them.

ALTER FUNCTION public.create_booking(uuid, date, date, time, time, integer, text, text, text, date)
  SECURITY DEFINER;
ALTER FUNCTION public.create_accessory_booking(uuid, date, date, time, time, integer, text, text, text, date)
  SECURITY DEFINER;
ALTER FUNCTION public.equipment_available_qty(uuid, date, date, time, time)
  SECURITY DEFINER;
ALTER FUNCTION public.accessory_available_qty(uuid, date, date, time, time)
  SECURITY DEFINER;
ALTER FUNCTION public.admin_update_booking(uuid, integer, date, date, time, time, text, text, text, date, boolean)
  SECURITY DEFINER;
ALTER FUNCTION public.admin_update_accessory_booking(uuid, integer, date, date, time, time, text, text, text, date, boolean)
  SECURITY DEFINER;
