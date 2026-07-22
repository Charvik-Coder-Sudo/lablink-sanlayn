
-- Adds a same-user overlap guard to the existing create_booking / create_accessory_booking
-- RPCs: a user cannot hold two overlapping 'booked' bookings for the same equipment/accessory,
-- independent of remaining quantity (previously only the aggregate quantity check applied, so a
-- user could double-book themselves whenever spare capacity existed). Function bodies only —
-- signatures, tables, RLS, and auth are all unchanged. CREATE OR REPLACE, so this is additive
-- and backward compatible with every existing caller.

CREATE OR REPLACE FUNCTION public.create_booking(
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

  INSERT INTO public.bookings(equipment_id,user_id,booking_date,end_date,start_time,end_time,quantity,purpose)
  VALUES (_equipment_id, v_uid, _booking_date, _end_date, _start, _end, _quantity, _purpose)
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
  _purpose text
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

  INSERT INTO public.accessory_bookings(accessory_id,user_id,booking_date,end_date,start_time,end_time,quantity,purpose)
  VALUES (_accessory_id, v_uid, _booking_date, _end_date, _start, _end, _quantity, _purpose)
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'accessory_booking_created','Accessory booking created', jsonb_build_object('booking_id',v_row.id,'accessory_id',_accessory_id));

  RETURN v_row;
END $$;
