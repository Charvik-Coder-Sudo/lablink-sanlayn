-- Ensure authenticated users can execute the booking RPCs used by the app.
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, date, time, time, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_available_qty(uuid, date, time, time) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
