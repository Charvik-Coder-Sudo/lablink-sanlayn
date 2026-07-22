-- Extend booking_status with the full lifecycle vocabulary the booking UI now displays.
-- Pending/Approved/Rejected are reserved for a future approval-workflow — the current
-- flow auto-confirms bookings as 'booked' and never writes these three. In Use/Overdue
-- are DISPLAY-ONLY states derived at read time from booked + now() vs start/end (see
-- src/lib/booking-status.ts) and are also never written by the app today; they're added
-- to the enum so a future scheduled job could persist them without another type change.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as a statement that
-- references the new value, so this migration only adds values — nothing here (or in
-- this file) reads them. Subsequent migrations that use these values run as separate
-- transactions.
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'in_use';
ALTER TYPE public.booking_status ADD VALUE IF NOT EXISTS 'overdue';
