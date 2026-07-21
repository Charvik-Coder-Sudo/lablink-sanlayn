
-- Accessories inventory: a separate table from `equipment` (dedicated data model, per user
-- decision) with its own booking table, RPCs, and RLS. None of the existing equipment/bookings
-- schema, RPCs, or policies are modified.

-- ============ ACCESSORIES ============
CREATE TABLE public.accessories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  description text NOT NULL,
  make text,
  model text,
  serial_number text,
  quantity integer NOT NULL CHECK (quantity >= 0),
  remarks text,
  photo_url text,
  status public.equipment_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_accessories_status ON public.accessories(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accessories TO authenticated;
GRANT ALL ON public.accessories TO service_role;
ALTER TABLE public.accessories ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_accessories_uat BEFORE UPDATE ON public.accessories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "accessories_read_all" ON public.accessories FOR SELECT TO authenticated USING (true);
CREATE POLICY "accessories_write_privileged" ON public.accessories FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

-- ============ ACCESSORY BOOKINGS ============
CREATE TABLE public.accessory_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accessory_id uuid NOT NULL REFERENCES public.accessories(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_date date NOT NULL,
  end_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  purpose text NOT NULL,
  status public.booking_status NOT NULL DEFAULT 'booked',
  cancelled_at timestamptz,
  returned_at timestamptz,
  returned_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= booking_date),
  CHECK ((end_date::timestamp + end_time) > (booking_date::timestamp + start_time)),
  CHECK (start_time >= '08:00' AND end_time <= '20:00')
);
CREATE INDEX idx_accessory_bookings_accessory_date ON public.accessory_bookings(accessory_id, booking_date);
CREATE INDEX idx_accessory_bookings_end_date ON public.accessory_bookings(accessory_id, end_date);
CREATE INDEX idx_accessory_bookings_user ON public.accessory_bookings(user_id);
CREATE INDEX idx_accessory_bookings_status ON public.accessory_bookings(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accessory_bookings TO authenticated;
GRANT ALL ON public.accessory_bookings TO service_role;
ALTER TABLE public.accessory_bookings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.accessory_bookings
  ADD CONSTRAINT accessory_bookings_user_profile_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD CONSTRAINT accessory_bookings_returned_by_profile_fk FOREIGN KEY (returned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE TRIGGER trg_accessory_bookings_uat BEFORE UPDATE ON public.accessory_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "accessory_bookings_select_own_or_privileged" ON public.accessory_bookings FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "accessory_bookings_insert_self" ON public.accessory_bookings FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "accessory_bookings_update_own_or_privileged" ON public.accessory_bookings FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "accessory_bookings_delete_admin" ON public.accessory_bookings FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ============ AVAILABILITY HELPER ============
CREATE FUNCTION public.accessory_available_qty(
  _accessory_id uuid, _from_date date, _to_date date, _start time, _end time
) RETURNS integer
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT GREATEST(
    (SELECT quantity FROM public.accessories WHERE id = _accessory_id)
    - COALESCE((
      SELECT SUM(quantity)::int FROM public.accessory_bookings
      WHERE accessory_id = _accessory_id
        AND status = 'booked'
        AND (booking_date::timestamp + start_time) < (_to_date::timestamp + _end)
        AND (end_date::timestamp + end_time) > (_from_date::timestamp + _start)
    ),0), 0);
$$;
REVOKE ALL ON FUNCTION public.accessory_available_qty(uuid, date, date, time, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accessory_available_qty(uuid, date, date, time, time) TO authenticated;

-- ============ TRANSACTIONAL BOOKING CREATE ============
CREATE FUNCTION public.create_accessory_booking(
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
REVOKE ALL ON FUNCTION public.create_accessory_booking(uuid, date, date, time, time, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_accessory_booking(uuid, date, date, time, time, integer, text) TO authenticated;

-- ============ PHOTO STORAGE ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('accessory-photos', 'accessory-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "accessory_photos_read_all" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'accessory-photos');
CREATE POLICY "accessory_photos_write_privileged" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'accessory-photos' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')));
CREATE POLICY "accessory_photos_update_privileged" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'accessory-photos' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')));
CREATE POLICY "accessory_photos_delete_privileged" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'accessory-photos' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')));
