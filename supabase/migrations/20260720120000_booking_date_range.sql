
-- Support multi-day bookings as a single continuous reservation.
-- Adds bookings.end_date (defaults existing rows to their current booking_date, i.e. same-day),
-- replaces the same-day-only CHECK constraints with range-aware ones, and rewrites the
-- create_booking / equipment_available_qty RPCs to compare full (date + time) moments instead
-- of a single date. RLS policies are untouched.

ALTER TABLE public.bookings ADD COLUMN end_date date;
UPDATE public.bookings SET end_date = booking_date WHERE end_date IS NULL;
ALTER TABLE public.bookings ALTER COLUMN end_date SET NOT NULL;

CREATE INDEX idx_bookings_end_date ON public.bookings(equipment_id, end_date);

-- Drop the original same-day-only CHECK constraints (unnamed at creation time, so look them
-- up by definition rather than guessing the auto-generated name).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.bookings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%start_time%'
  LOOP
    EXECUTE format('ALTER TABLE public.bookings DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_date_range_valid CHECK (end_date >= booking_date),
  ADD CONSTRAINT bookings_time_range_valid CHECK ((end_date::timestamp + end_time) > (booking_date::timestamp + start_time)),
  ADD CONSTRAINT bookings_lab_hours CHECK (start_time >= '08:00' AND end_time <= '20:00');

-- ============ AVAILABILITY HELPER (date-range aware) ============
DROP FUNCTION IF EXISTS public.equipment_available_qty(uuid, date, time, time);

CREATE FUNCTION public.equipment_available_qty(
  _equipment_id uuid, _from_date date, _to_date date, _start time, _end time
) RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT GREATEST(
    (SELECT total_quantity FROM public.equipment WHERE id = _equipment_id)
    - COALESCE((
      SELECT SUM(quantity)::int FROM public.bookings
      WHERE equipment_id = _equipment_id
        AND status = 'booked'
        AND (booking_date::timestamp + start_time) < (_to_date::timestamp + _end)
        AND (end_date::timestamp + end_time) > (_from_date::timestamp + _start)
    ),0), 0);
$$;

REVOKE ALL ON FUNCTION public.equipment_available_qty(uuid, date, date, time, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_available_qty(uuid, date, date, time, time) TO authenticated;

-- ============ TRANSACTIONAL BOOKING CREATE (date-range aware) ============
DROP FUNCTION IF EXISTS public.create_booking(uuid, date, time, time, integer, text);

CREATE FUNCTION public.create_booking(
  _equipment_id uuid,
  _booking_date date,
  _end_date date,
  _start time,
  _end time,
  _quantity integer,
  _purpose text
) RETURNS public.bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total integer;
  v_used integer;
  v_status public.equipment_status;
  v_row public.bookings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _end_date < _booking_date THEN RAISE EXCEPTION 'invalid_date_range'; END IF;
  IF (_end_date::timestamp + _end) <= (_booking_date::timestamp + _start) THEN RAISE EXCEPTION 'invalid_time_range'; END IF;
  IF _start < '08:00' OR _end > '20:00' THEN RAISE EXCEPTION 'outside_lab_hours'; END IF;
  IF _quantity <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  IF (_booking_date + _start) < now() THEN RAISE EXCEPTION 'cannot_book_in_past'; END IF;

  SELECT total_quantity, status INTO v_total, v_status
  FROM public.equipment WHERE id = _equipment_id FOR UPDATE;
  IF v_total IS NULL THEN RAISE EXCEPTION 'equipment_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'equipment_unavailable'; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO v_used FROM public.bookings
  WHERE equipment_id = _equipment_id
    AND status = 'booked'
    AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
    AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start);

  IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;

  INSERT INTO public.bookings(equipment_id,user_id,booking_date,end_date,start_time,end_time,quantity,purpose)
  VALUES (_equipment_id, v_uid, _booking_date, _end_date, _start, _end, _quantity, _purpose)
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'booking_created','Booking created', jsonb_build_object('booking_id',v_row.id,'equipment_id',_equipment_id));

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, date, date, time, time, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, date, date, time, time, integer, text) TO authenticated;
