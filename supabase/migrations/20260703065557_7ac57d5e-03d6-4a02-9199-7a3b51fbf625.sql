
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin','manager','employee');
CREATE TYPE public.equipment_status AS ENUM ('active','maintenance','retired');
CREATE TYPE public.booking_status AS ENUM ('booked','cancelled','returned','completed');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id text UNIQUE NOT NULL,
  full_name text NOT NULL,
  email text UNIQUE NOT NULL,
  department text,
  designation text,
  phone text,
  dob date,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============ has_role() ============
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_user_roles()
RETURNS SETOF public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid();
$$;

-- ============ EQUIPMENT ============
CREATE TABLE public.equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_code text UNIQUE NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  manufacturer text,
  model text,
  serial_number text,
  lab_location text NOT NULL,
  total_quantity integer NOT NULL CHECK (total_quantity >= 0),
  remarks text,
  status public.equipment_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipment_category ON public.equipment(category);
CREATE INDEX idx_equipment_status ON public.equipment(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment TO authenticated;
GRANT ALL ON public.equipment TO service_role;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

-- ============ BOOKINGS ============
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  booking_date date NOT NULL,
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
  CHECK (end_time > start_time),
  CHECK (start_time >= '08:00' AND end_time <= '20:00')
);
CREATE INDEX idx_bookings_equipment_date ON public.bookings(equipment_id, booking_date);
CREATE INDEX idx_bookings_user ON public.bookings(user_id);
CREATE INDEX idx_bookings_date ON public.bookings(booking_date);
CREATE INDEX idx_bookings_status ON public.bookings(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- ============ AUDIT LOGS ============
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_user ON public.audit_logs(user_id);
CREATE INDEX idx_audit_action ON public.audit_logs(action);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ============ updated_at trigger ============
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_profiles_uat BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_equipment_uat BEFORE UPDATE ON public.equipment FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bookings_uat BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ RLS POLICIES ============
-- Profiles: user can see own, admins/managers see all; user can update own, admin update any
CREATE POLICY "profiles_select_self_or_privileged" ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- user_roles: users see their own; admins see all
CREATE POLICY "roles_select_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Equipment: all authenticated read; admins/managers write
CREATE POLICY "equipment_read_all" ON public.equipment FOR SELECT TO authenticated USING (true);
CREATE POLICY "equipment_write_privileged" ON public.equipment FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

-- Bookings: employee see own; managers/admins see all
CREATE POLICY "bookings_select_own_or_privileged" ON public.bookings FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "bookings_insert_self" ON public.bookings FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY "bookings_update_own_or_privileged" ON public.bookings FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "bookings_delete_admin" ON public.bookings FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin'));

-- Audit logs: admins read all; everyone can insert (for logging via server-side)
CREATE POLICY "audit_read_admin" ON public.audit_logs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "audit_insert_any" ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (true);

-- ============ AVAILABILITY HELPER ============
CREATE OR REPLACE FUNCTION public.equipment_available_qty(
  _equipment_id uuid, _date date, _start time, _end time
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT GREATEST(
    (SELECT total_quantity FROM public.equipment WHERE id = _equipment_id)
    - COALESCE((
      SELECT SUM(quantity)::int FROM public.bookings
      WHERE equipment_id = _equipment_id
        AND booking_date = _date
        AND status = 'booked'
        AND start_time < _end AND end_time > _start
    ),0), 0);
$$;

-- ============ TRANSACTIONAL BOOKING CREATE ============
CREATE OR REPLACE FUNCTION public.create_booking(
  _equipment_id uuid,
  _booking_date date,
  _start time,
  _end time,
  _quantity integer,
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
  IF _end <= _start THEN RAISE EXCEPTION 'invalid_time_range'; END IF;
  IF _start < '08:00' OR _end > '20:00' THEN RAISE EXCEPTION 'outside_lab_hours'; END IF;
  IF _quantity <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  IF (_booking_date + _start) < now() THEN RAISE EXCEPTION 'cannot_book_in_past'; END IF;

  SELECT total_quantity, status INTO v_total, v_status
  FROM public.equipment WHERE id = _equipment_id FOR UPDATE;
  IF v_total IS NULL THEN RAISE EXCEPTION 'equipment_not_found'; END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'equipment_unavailable'; END IF;

  SELECT COALESCE(SUM(quantity),0) INTO v_used FROM public.bookings
  WHERE equipment_id = _equipment_id
    AND booking_date = _booking_date
    AND status = 'booked'
    AND start_time < _end AND end_time > _start;

  IF v_used + _quantity > v_total THEN RAISE EXCEPTION 'insufficient_quantity'; END IF;

  INSERT INTO public.bookings(equipment_id,user_id,booking_date,start_time,end_time,quantity,purpose)
  VALUES (_equipment_id, v_uid, _booking_date, _start, _end, _quantity, _purpose)
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs(user_id,action,description,metadata)
  VALUES (v_uid,'booking_created','Booking created', jsonb_build_object('booking_id',v_row.id,'equipment_id',_equipment_id));

  RETURN v_row;
END $$;

-- ============ NEW USER PROFILE TRIGGER ============
-- Auto-create profile row and default employee role when a new auth user is inserted.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles(id, employee_id, full_name, email, department, designation, phone, dob)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'employee_id', 'EMP-' || substr(NEW.id::text,1,8)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    NEW.email,
    NEW.raw_user_meta_data->>'department',
    NEW.raw_user_meta_data->>'designation',
    NEW.raw_user_meta_data->>'phone',
    NULLIF(NEW.raw_user_meta_data->>'dob','')::date
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'employee') ON CONFLICT DO NOTHING;

  IF NEW.raw_user_meta_data->>'role' IN ('admin','manager') THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, (NEW.raw_user_meta_data->>'role')::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
