-- Normal users must be able to SEE real equipment/accessory availability and who currently
-- holds a booking — but the bookings/accessory_bookings SELECT policy is own-or-privileged,
-- so a normal user's direct table query returns ONLY their own rows. That makes the
-- client-computed availability under-count (shows "Available" when another user has it) and
-- hides the current borrower. Proven: as an employee, a direct select on a booked item
-- returns 0 rows while the DEFINER equipment_available_qty returns 0 available.
--
-- Fix: SECURITY DEFINER read RPCs that return booked slots overlapping a date window,
-- exposing ONLY non-sensitive fields (booker full name, department, project, period,
-- quantity, and user_id for the client's own "is this mine?" check). No email, phone,
-- profile ids beyond the booker uuid, remarks, or audit data are exposed. This lets the UI
-- reflect the true database state for every authenticated user without weakening the
-- row-level policies that protect the underlying tables.

CREATE OR REPLACE FUNCTION public.equipment_booking_slots(_equipment_ids uuid[], _from date, _to date)
RETURNS TABLE(
  id uuid, equipment_id uuid, user_id uuid, booking_date date, end_date date,
  start_time time, end_time time, quantity integer, project_name text,
  full_name text, department text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT b.id, b.equipment_id, b.user_id, b.booking_date, b.end_date,
         b.start_time, b.end_time, b.quantity, b.project_name,
         p.full_name, p.department
  FROM public.bookings b
  LEFT JOIN public.profiles p ON p.id = b.user_id
  WHERE b.equipment_id = ANY(_equipment_ids)
    AND b.status = 'booked'
    AND b.booking_date <= _to
    AND b.end_date >= _from
  ORDER BY b.booking_date, b.start_time;
$$;

CREATE OR REPLACE FUNCTION public.accessory_booking_slots(_accessory_ids uuid[], _from date, _to date)
RETURNS TABLE(
  id uuid, accessory_id uuid, user_id uuid, booking_date date, end_date date,
  start_time time, end_time time, quantity integer, project_name text,
  full_name text, department text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT b.id, b.accessory_id, b.user_id, b.booking_date, b.end_date,
         b.start_time, b.end_time, b.quantity, b.project_name,
         p.full_name, p.department
  FROM public.accessory_bookings b
  LEFT JOIN public.profiles p ON p.id = b.user_id
  WHERE b.accessory_id = ANY(_accessory_ids)
    AND b.status = 'booked'
    AND b.booking_date <= _to
    AND b.end_date >= _from
  ORDER BY b.booking_date, b.start_time;
$$;

REVOKE ALL ON FUNCTION public.equipment_booking_slots(uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.equipment_booking_slots(uuid[], date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.accessory_booking_slots(uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accessory_booking_slots(uuid[], date, date) TO authenticated;
