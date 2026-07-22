-- FEATURE 2: remove Expected Return Date and Remarks from the booking domain entirely.
-- FEATURE 3: make equipment Asset ID (equipment_code) optional.
--
-- The `remarks`/`expected_return_date` columns on bookings/accessory_bookings carry no
-- data (verified empty before this migration) and are being removed from the whole stack.
-- The create_* and admin_update_* RPCs reference those columns, so they are dropped and
-- recreated with the two parameters removed, preserving the SECURITY DEFINER + row-lock
-- design from 20260723120000/20260723130000. NOTE: equipment.remarks (equipment metadata)
-- is a DIFFERENT column and is intentionally left untouched — only the booking fields go.

-- Drop the RPCs first (their bodies reference the columns being dropped).
DROP FUNCTION IF EXISTS public.create_booking(uuid, date, date, time, time, integer, text, text, text, date);
DROP FUNCTION IF EXISTS public.create_accessory_booking(uuid, date, date, time, time, integer, text, text, text, date);
DROP FUNCTION IF EXISTS public.admin_update_booking(uuid, integer, date, date, time, time, text, text, text, date, boolean);
DROP FUNCTION IF EXISTS public.admin_update_accessory_booking(uuid, integer, date, date, time, time, text, text, text, date, boolean);

-- Remove the booking fields.
ALTER TABLE public.bookings DROP COLUMN IF EXISTS remarks, DROP COLUMN IF EXISTS expected_return_date;
ALTER TABLE public.accessory_bookings DROP COLUMN IF EXISTS remarks, DROP COLUMN IF EXISTS expected_return_date;

-- FEATURE 3: Asset ID becomes optional. UNIQUE is kept (Postgres allows multiple NULLs),
-- so items without an Asset ID no longer collide with each other or block import.
ALTER TABLE public.equipment ALTER COLUMN equipment_code DROP NOT NULL;

-- === create_booking (DEFINER, no remarks/expected_return_date) =================
CREATE FUNCTION public.create_booking(
  _equipment_id uuid,
  _booking_date date,
  _end_date date,
  _start time,
  _end time,
  _quantity integer,
  _project_name text,
  _purpose text
) RETURNS public.bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  IF btrim(coalesce(_project_name, '')) = '' THEN RAISE EXCEPTION 'project_name_required'; END IF;
  IF btrim(coalesce(_purpose, '')) = '' THEN RAISE EXCEPTION 'purpose_required'; END IF;

  SELECT total_quantity, status INTO v_total, v_status
  FROM public.equipment WHERE id = _equipment_id FOR UPDATE;
  IF v_total IS NULL THEN RAISE EXCEPTION 'equipment_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'equipment_unavailable'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE equipment_id = _equipment_id AND user_id = v_uid AND status = 'booked'
      AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
      AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start)
  ) THEN RAISE EXCEPTION 'duplicate_booking'; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO v_used FROM public.bookings
  WHERE equipment_id = _equipment_id AND status = 'booked'
    AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
    AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start);
  IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;

  INSERT INTO public.bookings(
    equipment_id, user_id, booking_date, end_date, start_time, end_time, quantity, project_name, purpose, created_by
  )
  VALUES (
    _equipment_id, v_uid, _booking_date, _end_date, _start, _end, _quantity, btrim(_project_name), btrim(_purpose), v_uid
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'booking_created','Booking created', jsonb_build_object('booking_id',v_row.id,'equipment_id',_equipment_id));

  RETURN v_row;
END $$;

-- === create_accessory_booking (DEFINER, no remarks/expected_return_date) =======
CREATE FUNCTION public.create_accessory_booking(
  _accessory_id uuid,
  _booking_date date,
  _end_date date,
  _start time,
  _end time,
  _quantity integer,
  _project_name text,
  _purpose text
) RETURNS public.accessory_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total integer;
  v_used integer;
  v_status public.equipment_status;
  v_row public.accessory_bookings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _end_date < _booking_date THEN RAISE EXCEPTION 'invalid_date_range'; END IF;
  IF (_end_date::timestamp + _end) <= (_booking_date::timestamp + _start) THEN RAISE EXCEPTION 'invalid_time_range'; END IF;
  IF _start < '08:00' OR _end > '20:00' THEN RAISE EXCEPTION 'outside_lab_hours'; END IF;
  IF _quantity <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  IF (_booking_date + _start) < now() THEN RAISE EXCEPTION 'cannot_book_in_past'; END IF;
  IF btrim(coalesce(_project_name, '')) = '' THEN RAISE EXCEPTION 'project_name_required'; END IF;
  IF btrim(coalesce(_purpose, '')) = '' THEN RAISE EXCEPTION 'purpose_required'; END IF;

  SELECT quantity, status INTO v_total, v_status
  FROM public.accessories WHERE id = _accessory_id FOR UPDATE;
  IF v_total IS NULL THEN RAISE EXCEPTION 'accessory_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'accessory_unavailable'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.accessory_bookings
    WHERE accessory_id = _accessory_id AND user_id = v_uid AND status = 'booked'
      AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
      AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start)
  ) THEN RAISE EXCEPTION 'duplicate_booking'; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO v_used FROM public.accessory_bookings
  WHERE accessory_id = _accessory_id AND status = 'booked'
    AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
    AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start);
  IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;

  INSERT INTO public.accessory_bookings(
    accessory_id, user_id, booking_date, end_date, start_time, end_time, quantity, project_name, purpose, created_by
  )
  VALUES (
    _accessory_id, v_uid, _booking_date, _end_date, _start, _end, _quantity, btrim(_project_name), btrim(_purpose), v_uid
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'accessory_booking_created','Accessory booking created', jsonb_build_object('booking_id',v_row.id,'accessory_id',_accessory_id));

  RETURN v_row;
END $$;

-- === admin_update_booking (DEFINER, no remarks/expected_return_date) ===========
CREATE FUNCTION public.admin_update_booking(
  _booking_id uuid,
  _quantity integer,
  _booking_date date,
  _end_date date,
  _start time,
  _end time,
  _project_name text,
  _purpose text,
  _override boolean DEFAULT false
) RETURNS public.bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking public.bookings;
  v_total integer;
  v_status public.equipment_status;
  v_used integer;
  v_row public.bookings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (has_role(v_uid,'admin') OR has_role(v_uid,'manager')) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status <> 'booked' THEN RAISE EXCEPTION 'invalid_status_transition'; END IF;

  IF _end_date < _booking_date THEN RAISE EXCEPTION 'invalid_date_range'; END IF;
  IF (_end_date::timestamp + _end) <= (_booking_date::timestamp + _start) THEN RAISE EXCEPTION 'invalid_time_range'; END IF;
  IF _start < '08:00' OR _end > '20:00' THEN RAISE EXCEPTION 'outside_lab_hours'; END IF;
  IF _quantity <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  IF btrim(coalesce(_project_name, '')) = '' THEN RAISE EXCEPTION 'project_name_required'; END IF;
  IF btrim(coalesce(_purpose, '')) = '' THEN RAISE EXCEPTION 'purpose_required'; END IF;

  SELECT total_quantity, status INTO v_total, v_status
  FROM public.equipment WHERE id = v_booking.equipment_id FOR UPDATE;
  IF v_status <> 'active' AND NOT _override THEN RAISE EXCEPTION 'equipment_unavailable'; END IF;

  IF NOT _override THEN
    SELECT COALESCE(SUM(quantity),0) INTO v_used FROM public.bookings
    WHERE equipment_id = v_booking.equipment_id AND status = 'booked' AND id <> _booking_id
      AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
      AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start);
    IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;
  END IF;

  UPDATE public.bookings SET
    quantity = _quantity, booking_date = _booking_date, end_date = _end_date,
    start_time = _start, end_time = _end, project_name = btrim(_project_name), purpose = btrim(_purpose)
  WHERE id = _booking_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'booking_admin_updated','Booking edited by admin/manager', jsonb_build_object('booking_id',_booking_id,'override',_override));

  RETURN v_row;
END $$;

-- === admin_update_accessory_booking (DEFINER, no remarks/expected_return_date) =
CREATE FUNCTION public.admin_update_accessory_booking(
  _booking_id uuid,
  _quantity integer,
  _booking_date date,
  _end_date date,
  _start time,
  _end time,
  _project_name text,
  _purpose text,
  _override boolean DEFAULT false
) RETURNS public.accessory_bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking public.accessory_bookings;
  v_total integer;
  v_status public.equipment_status;
  v_used integer;
  v_row public.accessory_bookings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (has_role(v_uid,'admin') OR has_role(v_uid,'manager')) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT * INTO v_booking FROM public.accessory_bookings WHERE id = _booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status <> 'booked' THEN RAISE EXCEPTION 'invalid_status_transition'; END IF;

  IF _end_date < _booking_date THEN RAISE EXCEPTION 'invalid_date_range'; END IF;
  IF (_end_date::timestamp + _end) <= (_booking_date::timestamp + _start) THEN RAISE EXCEPTION 'invalid_time_range'; END IF;
  IF _start < '08:00' OR _end > '20:00' THEN RAISE EXCEPTION 'outside_lab_hours'; END IF;
  IF _quantity <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  IF btrim(coalesce(_project_name, '')) = '' THEN RAISE EXCEPTION 'project_name_required'; END IF;
  IF btrim(coalesce(_purpose, '')) = '' THEN RAISE EXCEPTION 'purpose_required'; END IF;

  SELECT quantity, status INTO v_total, v_status
  FROM public.accessories WHERE id = v_booking.accessory_id FOR UPDATE;
  IF v_status <> 'active' AND NOT _override THEN RAISE EXCEPTION 'accessory_unavailable'; END IF;

  IF NOT _override THEN
    SELECT COALESCE(SUM(quantity),0) INTO v_used FROM public.accessory_bookings
    WHERE accessory_id = v_booking.accessory_id AND status = 'booked' AND id <> _booking_id
      AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
      AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start);
    IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;
  END IF;

  UPDATE public.accessory_bookings SET
    quantity = _quantity, booking_date = _booking_date, end_date = _end_date,
    start_time = _start, end_time = _end, project_name = btrim(_project_name), purpose = btrim(_purpose)
  WHERE id = _booking_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'accessory_booking_admin_updated','Accessory booking edited by admin/manager', jsonb_build_object('booking_id',_booking_id,'override',_override));

  RETURN v_row;
END $$;

-- Re-apply grants (authenticated only), matching the prior migrations' pattern.
REVOKE ALL ON FUNCTION public.create_booking(uuid,date,date,time,time,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,date,date,time,time,integer,text,text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_accessory_booking(uuid,date,date,time,time,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_accessory_booking(uuid,date,date,time,time,integer,text,text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_update_booking(uuid,integer,date,date,time,time,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_booking(uuid,integer,date,date,time,time,text,text,boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_update_accessory_booking(uuid,integer,date,date,time,time,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_accessory_booking(uuid,integer,date,date,time,time,text,text,boolean) TO authenticated;
