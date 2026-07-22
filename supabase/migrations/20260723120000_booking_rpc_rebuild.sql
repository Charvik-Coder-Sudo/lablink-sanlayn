-- Booking system rebuild — RPCs.
--
-- create_booking / create_accessory_booking: same atomic, row-locked design as before
-- (SELECT ... FOR UPDATE on the equipment/accessory row prevents two concurrent requests
-- from both reading a stale "quantity available" and overbooking), extended to accept
-- project_name (required), remarks (optional) and expected_return_date (optional).
--
-- cancel_booking / return_booking (+ accessory equivalents): previously these were plain
-- client-side `UPDATE bookings SET status=...` calls that relied only on RLS USING and had
-- no server-side state-machine check (e.g. nothing stopped "returning" an already-cancelled
-- booking) and logged to audit_logs as a separate, non-atomic client call. They are now
-- RPCs: single atomic transaction, explicit status-transition guard, explicit permission
-- check (owner-before-start / owner-return-anytime / admin / same-department manager),
-- and an in-transaction audit_logs insert.
--
-- admin_update_booking (+ accessory equivalent): lets admin/manager edit an existing
-- booking's core fields, re-validating overlap + quantity exactly like create_booking
-- unless `_override` is true (admin/manager only), which lets them force through a
-- resolved conflict deliberately.

-- Drop the old 7-arg signatures before recreating with the new parameter list — Postgres
-- treats a different parameter list as a distinct overload, not a replacement.
DROP FUNCTION IF EXISTS public.create_booking(uuid, date, date, time, time, integer, text);
DROP FUNCTION IF EXISTS public.create_accessory_booking(uuid, date, date, time, time, integer, text);

CREATE OR REPLACE FUNCTION public.create_booking(
  _equipment_id uuid,
  _booking_date date,
  _end_date date,
  _start time,
  _end time,
  _quantity integer,
  _project_name text,
  _purpose text,
  _remarks text DEFAULT NULL,
  _expected_return_date date DEFAULT NULL
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
  IF btrim(coalesce(_project_name, '')) = '' THEN RAISE EXCEPTION 'project_name_required'; END IF;
  IF btrim(coalesce(_purpose, '')) = '' THEN RAISE EXCEPTION 'purpose_required'; END IF;
  IF _expected_return_date IS NOT NULL AND _expected_return_date < _booking_date THEN RAISE EXCEPTION 'invalid_expected_return_date'; END IF;

  SELECT total_quantity, status INTO v_total, v_status
  FROM public.equipment WHERE id = _equipment_id FOR UPDATE;
  IF v_total IS NULL THEN RAISE EXCEPTION 'equipment_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'equipment_unavailable'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE equipment_id = _equipment_id
      AND user_id = v_uid
      AND status = 'booked'
      AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
      AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start)
  ) THEN RAISE EXCEPTION 'duplicate_booking'; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO v_used FROM public.bookings
  WHERE equipment_id = _equipment_id
    AND status = 'booked'
    AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
    AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start);

  IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;

  INSERT INTO public.bookings(
    equipment_id, user_id, booking_date, end_date, start_time, end_time, quantity,
    project_name, purpose, remarks, expected_return_date, created_by
  )
  VALUES (
    _equipment_id, v_uid, _booking_date, _end_date, _start, _end, _quantity,
    btrim(_project_name), btrim(_purpose), NULLIF(btrim(coalesce(_remarks,'')), ''), _expected_return_date, v_uid
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'booking_created','Booking created', jsonb_build_object('booking_id',v_row.id,'equipment_id',_equipment_id));

  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.create_accessory_booking(
  _accessory_id uuid,
  _booking_date date,
  _end_date date,
  _start time,
  _end time,
  _quantity integer,
  _project_name text,
  _purpose text,
  _remarks text DEFAULT NULL,
  _expected_return_date date DEFAULT NULL
) RETURNS public.accessory_bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
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
  IF _expected_return_date IS NOT NULL AND _expected_return_date < _booking_date THEN RAISE EXCEPTION 'invalid_expected_return_date'; END IF;

  SELECT quantity, status INTO v_total, v_status
  FROM public.accessories WHERE id = _accessory_id FOR UPDATE;
  IF v_total IS NULL THEN RAISE EXCEPTION 'accessory_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'accessory_unavailable'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.accessory_bookings
    WHERE accessory_id = _accessory_id
      AND user_id = v_uid
      AND status = 'booked'
      AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
      AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start)
  ) THEN RAISE EXCEPTION 'duplicate_booking'; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO v_used FROM public.accessory_bookings
  WHERE accessory_id = _accessory_id
    AND status = 'booked'
    AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
    AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start);

  IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;

  INSERT INTO public.accessory_bookings(
    accessory_id, user_id, booking_date, end_date, start_time, end_time, quantity,
    project_name, purpose, remarks, expected_return_date, created_by
  )
  VALUES (
    _accessory_id, v_uid, _booking_date, _end_date, _start, _end, _quantity,
    btrim(_project_name), btrim(_purpose), NULLIF(btrim(coalesce(_remarks,'')), ''), _expected_return_date, v_uid
  )
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'accessory_booking_created','Accessory booking created', jsonb_build_object('booking_id',v_row.id,'accessory_id',_accessory_id));

  RETURN v_row;
END $$;

-- === cancel_booking =========================================================
CREATE OR REPLACE FUNCTION public.cancel_booking(_booking_id uuid, _reason text DEFAULT NULL)
RETURNS public.bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking public.bookings;
  v_actor_dept text;
  v_owner_dept text;
  v_allowed boolean := false;
  v_row public.bookings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status <> 'booked' THEN RAISE EXCEPTION 'invalid_status_transition'; END IF;

  IF has_role(v_uid, 'admin') THEN
    v_allowed := true;
  ELSIF has_role(v_uid, 'manager') THEN
    SELECT department INTO v_actor_dept FROM public.profiles WHERE id = v_uid;
    SELECT department INTO v_owner_dept FROM public.profiles WHERE id = v_booking.user_id;
    IF v_actor_dept IS NOT DISTINCT FROM v_owner_dept THEN v_allowed := true; END IF;
  END IF;
  IF NOT v_allowed AND v_booking.user_id = v_uid
     AND (v_booking.booking_date::timestamp + v_booking.start_time) > now() THEN
    v_allowed := true;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE public.bookings SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = v_uid,
    cancel_reason = NULLIF(btrim(coalesce(_reason,'')), '')
  WHERE id = _booking_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'booking_cancelled','Booking cancelled', jsonb_build_object('booking_id',_booking_id,'reason',_reason));

  RETURN v_row;
END $$;

-- === return_booking (self-service early/on-time return AND admin force-return) ==
CREATE OR REPLACE FUNCTION public.return_booking(_booking_id uuid, _reason text DEFAULT NULL)
RETURNS public.bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking public.bookings;
  v_actor_dept text;
  v_owner_dept text;
  v_allowed boolean := false;
  v_row public.bookings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status <> 'booked' THEN RAISE EXCEPTION 'invalid_status_transition'; END IF;

  IF v_booking.user_id = v_uid THEN
    v_allowed := true;
  ELSIF has_role(v_uid, 'admin') THEN
    v_allowed := true;
  ELSIF has_role(v_uid, 'manager') THEN
    SELECT department INTO v_actor_dept FROM public.profiles WHERE id = v_uid;
    SELECT department INTO v_owner_dept FROM public.profiles WHERE id = v_booking.user_id;
    IF v_actor_dept IS NOT DISTINCT FROM v_owner_dept THEN v_allowed := true; END IF;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE public.bookings SET
    status = 'returned',
    returned_at = now(),
    returned_by = v_uid,
    return_reason = NULLIF(btrim(coalesce(_reason,'')), '')
  WHERE id = _booking_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'booking_returned','Booking returned', jsonb_build_object('booking_id',_booking_id,'reason',_reason));

  RETURN v_row;
END $$;

-- === admin_update_booking (edit + override conflicts) ======================
CREATE OR REPLACE FUNCTION public.admin_update_booking(
  _booking_id uuid,
  _quantity integer,
  _booking_date date,
  _end_date date,
  _start time,
  _end time,
  _project_name text,
  _purpose text,
  _remarks text DEFAULT NULL,
  _expected_return_date date DEFAULT NULL,
  _override boolean DEFAULT false
) RETURNS public.bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
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
    WHERE equipment_id = v_booking.equipment_id
      AND status = 'booked'
      AND id <> _booking_id
      AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
      AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start);

    IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;
  END IF;

  UPDATE public.bookings SET
    quantity = _quantity,
    booking_date = _booking_date,
    end_date = _end_date,
    start_time = _start,
    end_time = _end,
    project_name = btrim(_project_name),
    purpose = btrim(_purpose),
    remarks = NULLIF(btrim(coalesce(_remarks,'')), ''),
    expected_return_date = _expected_return_date
  WHERE id = _booking_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'booking_admin_updated','Booking edited by admin/manager', jsonb_build_object('booking_id',_booking_id,'override',_override));

  RETURN v_row;
END $$;

-- === accessory equivalents ==================================================
CREATE OR REPLACE FUNCTION public.cancel_accessory_booking(_booking_id uuid, _reason text DEFAULT NULL)
RETURNS public.accessory_bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking public.accessory_bookings;
  v_actor_dept text;
  v_owner_dept text;
  v_allowed boolean := false;
  v_row public.accessory_bookings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_booking FROM public.accessory_bookings WHERE id = _booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status <> 'booked' THEN RAISE EXCEPTION 'invalid_status_transition'; END IF;

  IF has_role(v_uid, 'admin') THEN
    v_allowed := true;
  ELSIF has_role(v_uid, 'manager') THEN
    SELECT department INTO v_actor_dept FROM public.profiles WHERE id = v_uid;
    SELECT department INTO v_owner_dept FROM public.profiles WHERE id = v_booking.user_id;
    IF v_actor_dept IS NOT DISTINCT FROM v_owner_dept THEN v_allowed := true; END IF;
  END IF;
  IF NOT v_allowed AND v_booking.user_id = v_uid
     AND (v_booking.booking_date::timestamp + v_booking.start_time) > now() THEN
    v_allowed := true;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE public.accessory_bookings SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = v_uid,
    cancel_reason = NULLIF(btrim(coalesce(_reason,'')), '')
  WHERE id = _booking_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'accessory_booking_cancelled','Accessory booking cancelled', jsonb_build_object('booking_id',_booking_id,'reason',_reason));

  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.return_accessory_booking(_booking_id uuid, _reason text DEFAULT NULL)
RETURNS public.accessory_bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_booking public.accessory_bookings;
  v_actor_dept text;
  v_owner_dept text;
  v_allowed boolean := false;
  v_row public.accessory_bookings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_booking FROM public.accessory_bookings WHERE id = _booking_id FOR UPDATE;
  IF v_booking.id IS NULL THEN RAISE EXCEPTION 'booking_not_found'; END IF;
  IF v_booking.status <> 'booked' THEN RAISE EXCEPTION 'invalid_status_transition'; END IF;

  IF v_booking.user_id = v_uid THEN
    v_allowed := true;
  ELSIF has_role(v_uid, 'admin') THEN
    v_allowed := true;
  ELSIF has_role(v_uid, 'manager') THEN
    SELECT department INTO v_actor_dept FROM public.profiles WHERE id = v_uid;
    SELECT department INTO v_owner_dept FROM public.profiles WHERE id = v_booking.user_id;
    IF v_actor_dept IS NOT DISTINCT FROM v_owner_dept THEN v_allowed := true; END IF;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION 'not_authorized'; END IF;

  UPDATE public.accessory_bookings SET
    status = 'returned',
    returned_at = now(),
    returned_by = v_uid,
    return_reason = NULLIF(btrim(coalesce(_reason,'')), '')
  WHERE id = _booking_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'accessory_booking_returned','Accessory booking returned', jsonb_build_object('booking_id',_booking_id,'reason',_reason));

  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_accessory_booking(
  _booking_id uuid,
  _quantity integer,
  _booking_date date,
  _end_date date,
  _start time,
  _end time,
  _project_name text,
  _purpose text,
  _remarks text DEFAULT NULL,
  _expected_return_date date DEFAULT NULL,
  _override boolean DEFAULT false
) RETURNS public.accessory_bookings
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
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
    WHERE accessory_id = v_booking.accessory_id
      AND status = 'booked'
      AND id <> _booking_id
      AND (booking_date::timestamp + start_time) < (_end_date::timestamp + _end)
      AND (end_date::timestamp + end_time) > (_booking_date::timestamp + _start);

    IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;
  END IF;

  UPDATE public.accessory_bookings SET
    quantity = _quantity,
    booking_date = _booking_date,
    end_date = _end_date,
    start_time = _start,
    end_time = _end,
    project_name = btrim(_project_name),
    purpose = btrim(_purpose),
    remarks = NULLIF(btrim(coalesce(_remarks,'')), ''),
    expected_return_date = _expected_return_date
  WHERE id = _booking_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'accessory_booking_admin_updated','Accessory booking edited by admin/manager', jsonb_build_object('booking_id',_booking_id,'override',_override));

  RETURN v_row;
END $$;

-- Lock down execution to authenticated users only (matches the existing create_booking grant pattern).
REVOKE ALL ON FUNCTION public.create_booking(uuid,date,date,time,time,integer,text,text,text,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid,date,date,time,time,integer,text,text,text,date) TO authenticated;

REVOKE ALL ON FUNCTION public.create_accessory_booking(uuid,date,date,time,time,integer,text,text,text,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_accessory_booking(uuid,date,date,time,time,integer,text,text,text,date) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_booking(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.return_booking(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_booking(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_update_booking(uuid,integer,date,date,time,time,text,text,text,date,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_booking(uuid,integer,date,date,time,time,text,text,text,date,boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_accessory_booking(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_accessory_booking(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.return_accessory_booking(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_accessory_booking(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_update_accessory_booking(uuid,integer,date,date,time,time,text,text,text,date,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_accessory_booking(uuid,integer,date,date,time,time,text,text,text,date,boolean) TO authenticated;
