-- Booking system rebuild — schema additions for bookings + accessory_bookings.
-- Adds the fields the new booking form/audit trail need (project name, remarks,
-- expected return date, who-did-what-and-why) without touching the existing
-- date/time/quantity/status columns or any RLS policy shape.

-- === bookings ===============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS project_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS expected_return_date date,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS return_reason text;

-- Backfill created_by for existing rows, then stop defaulting project_name to ''
-- for NEW rows going forward — the RPC now requires a non-empty value explicitly.
UPDATE public.bookings SET created_by = user_id WHERE created_by IS NULL;
ALTER TABLE public.bookings ALTER COLUMN project_name DROP DEFAULT;

-- Speeds up the "current + upcoming bookings for this equipment" overlap query
-- (used by create_booking, cancel_booking, return_booking, availability RPCs,
-- and the list/detail pages) so it never needs to scan the whole table.
CREATE INDEX IF NOT EXISTS idx_bookings_equipment_status_range
  ON public.bookings(equipment_id, status, booking_date, end_date);

CREATE OR REPLACE FUNCTION public.set_updated_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_updated_by ON public.bookings;
CREATE TRIGGER trg_bookings_updated_by
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_by();

-- === accessory_bookings =====================================================
ALTER TABLE public.accessory_bookings
  ADD COLUMN IF NOT EXISTS project_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS expected_return_date date,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS return_reason text;

UPDATE public.accessory_bookings SET created_by = user_id WHERE created_by IS NULL;
ALTER TABLE public.accessory_bookings ALTER COLUMN project_name DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_accessory_bookings_accessory_status_range
  ON public.accessory_bookings(accessory_id, status, booking_date, end_date);

DROP TRIGGER IF EXISTS trg_accessory_bookings_updated_by ON public.accessory_bookings;
CREATE TRIGGER trg_accessory_bookings_updated_by
  BEFORE UPDATE ON public.accessory_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_by();

GRANT EXECUTE ON FUNCTION public.set_updated_by() TO authenticated;
