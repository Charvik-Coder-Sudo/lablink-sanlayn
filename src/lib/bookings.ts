import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "./audit";
import { validateBookingTimeRange } from "./booking-validation";

export interface BookingInput {
  equipment_id: string;
  booking_date: string; // yyyy-mm-dd
  start_time: string;   // HH:mm
  end_time: string;
  quantity: number;
  purpose: string;
}

export async function createBooking(input: BookingInput) {
  const timeValidation = validateBookingTimeRange({
    startTime: input.start_time,
    endTime: input.end_time,
  });

  if (!timeValidation.isValid || !timeValidation.startMinutes || !timeValidation.endMinutes) {
    throw new Error("invalid_time_range");
  }

  const { data, error } = await supabase.rpc("create_booking", {
    _equipment_id: input.equipment_id,
    _booking_date: input.booking_date,
    _start: input.start_time,
    _end: input.end_time,
    _quantity: input.quantity,
    _purpose: input.purpose,
  });
  if (error) throw error;
  return data;
}

export async function listBookings(opts: {
  scope?: "mine" | "all";
  status?: string;
  from?: string; to?: string;
  equipmentId?: string;
  limit?: number; offset?: number;
  managerDepartment?: string | null;
} = {}) {
  const { scope = "all", status, from, to, equipmentId, limit = 50, offset = 0, managerDepartment } = opts;
  let q = supabase.from("bookings").select(
    "*, equipment:equipment_id(name,equipment_code,category), profile:profiles!bookings_user_profile_fk(full_name,employee_id,department)",
    { count: "exact" },
  ).order("booking_date", { ascending: false }).order("start_time", { ascending: false });

  if (scope === "mine") {
    const { data } = await supabase.auth.getUser();
    if (data.user) q = q.eq("user_id", data.user.id);
  } else if (managerDepartment) {
    const { data: departmentProfiles, error: profileError } = await supabase.from("profiles").select("id").eq("department", managerDepartment);
    if (profileError) throw profileError;
    const userIds = (departmentProfiles ?? []).map((p) => p.id);
    if (userIds.length === 0) return { rows: [], total: 0 };
    q = q.in("user_id", userIds);
  }
  if (status) q = q.eq("status", status as never);
  if (from) q = q.gte("booking_date", from);
  if (to) q = q.lte("booking_date", to);
  if (equipmentId) q = q.eq("equipment_id", equipmentId);
  q = q.range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function cancelBooking(id: string) {
  const { error } = await supabase.from("bookings").update({
    status: "cancelled", cancelled_at: new Date().toISOString(),
  } as never).eq("id", id);
  if (error) throw error;
  await logAudit("booking_cancelled", `Cancelled booking ${id}`, { booking_id: id });
}

export async function markReturned(id: string) {
  const { data: userRes } = await supabase.auth.getUser();
  const { error } = await supabase.from("bookings").update({
    status: "returned", returned_at: new Date().toISOString(), returned_by: userRes.user?.id ?? null,
  } as never).eq("id", id);
  if (error) throw error;
  await logAudit("booking_returned", `Returned booking ${id}`, { booking_id: id });
}

export async function equipmentDaySchedule(equipmentId: string, date: string) {
  const { data, error } = await supabase
    .from("bookings")
    .select("id,start_time,end_time,quantity,status,purpose,profile:profiles!bookings_user_profile_fk(full_name)")
    .eq("equipment_id", equipmentId)
    .eq("booking_date", date)
    .eq("status", "booked")
    .order("start_time");
  if (error) throw error;
  return data ?? [];
}
