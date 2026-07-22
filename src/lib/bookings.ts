import { supabase } from "@/integrations/supabase/client";
import { validateBookingDateTimeRange } from "./booking-validation";

export interface BookingInput {
  equipment_id: string;
  booking_date: string; // yyyy-mm-dd (From Date)
  end_date: string;     // yyyy-mm-dd (To Date)
  start_time: string;   // HH:mm
  end_time: string;
  quantity: number;
  project_name: string;
  purpose: string;
}

export async function createBooking(input: BookingInput) {
  const rangeValidation = validateBookingDateTimeRange({
    fromDate: input.booking_date,
    toDate: input.end_date,
    startTime: input.start_time,
    endTime: input.end_time,
  });

  if (!rangeValidation.isValid) {
    throw new Error(input.end_date < input.booking_date ? "invalid_date_range" : "invalid_time_range");
  }
  if (!input.project_name.trim()) throw new Error("project_name_required");
  if (!input.purpose.trim()) throw new Error("purpose_required");

  const { data, error } = await supabase.rpc("create_booking", {
    _equipment_id: input.equipment_id,
    _booking_date: input.booking_date,
    _end_date: input.end_date,
    _start: input.start_time,
    _end: input.end_time,
    _quantity: input.quantity,
    _project_name: input.project_name,
    _purpose: input.purpose,
  });
  if (error) throw error;
  return data;
}

export interface AdminUpdateBookingInput {
  bookingId: string;
  quantity: number;
  booking_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  project_name: string;
  purpose: string;
  override?: boolean;
}

export async function adminUpdateBooking(input: AdminUpdateBookingInput) {
  const { data, error } = await supabase.rpc("admin_update_booking", {
    _booking_id: input.bookingId,
    _quantity: input.quantity,
    _booking_date: input.booking_date,
    _end_date: input.end_date,
    _start: input.start_time,
    _end: input.end_time,
    _project_name: input.project_name,
    _purpose: input.purpose,
    _override: input.override ?? false,
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
  // Overlap against [from, to]: a booking spanning booking_date..end_date is in range
  // whenever it ends on/after `from` and starts on/before `to` — checking booking_date
  // against both bounds (the old behaviour) missed multi-day bookings that started
  // earlier but were still active inside the window.
  if (from) q = q.gte("end_date", from);
  if (to) q = q.lte("booking_date", to);
  if (equipmentId) q = q.eq("equipment_id", equipmentId);
  q = q.range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function cancelBooking(id: string, reason?: string) {
  const { error } = await supabase.rpc("cancel_booking", { _booking_id: id, _reason: reason || null });
  if (error) throw error;
}

export async function markReturned(id: string, reason?: string) {
  const { error } = await supabase.rpc("return_booking", { _booking_id: id, _reason: reason || null });
  if (error) throw error;
}

export async function equipmentDaySchedule(equipmentId: string, date: string) {
  const { data, error } = await supabase
    .from("bookings")
    .select("id,booking_date,end_date,start_time,end_time,quantity,status,project_name,purpose,profile:profiles!bookings_user_profile_fk(full_name)")
    .eq("equipment_id", equipmentId)
    .lte("booking_date", date)
    .gte("end_date", date)
    .eq("status", "booked")
    .order("start_time");
  if (error) throw error;
  return data ?? [];
}
