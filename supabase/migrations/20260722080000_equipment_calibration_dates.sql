
-- Adds calibration tracking to equipment. Additive and nullable only — no defaults required,
-- existing rows are unaffected, no RLS/policy changes, no impact on bookings or auth.
-- Backfills nothing; the Excel importer and the Add/Edit equipment form populate these going
-- forward instead of folding calibration dates into the free-text remarks field.

ALTER TABLE public.equipment
  ADD COLUMN calibration_date date,
  ADD COLUMN calibration_due_date date;
