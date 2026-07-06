
ALTER FUNCTION public.equipment_available_qty(uuid, date, time, time) SECURITY INVOKER;
ALTER FUNCTION public.create_booking(uuid, date, time, time, integer, text) SECURITY INVOKER;
