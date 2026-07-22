import { supabase } from "@/integrations/supabase/client";
import { validateBookingDateTimeRange } from "./booking-validation";

export interface AccessoryBookingInput {
  accessory_id: string;
  booking_date: string; // yyyy-mm-dd (From Date)
  end_date: string;     // yyyy-mm-dd (To Date)
  start_time: string;
  end_time: string;
  quantity: number;
  project_name: string;
  purpose: string;
}

export async function createAccessoryBooking(input: AccessoryBookingInput) {
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

  const { data, error } = await supabase.rpc("create_accessory_booking", {
    _accessory_id: input.accessory_id,
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

export interface AdminUpdateAccessoryBookingInput {
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

export async function adminUpdateAccessoryBooking(input: AdminUpdateAccessoryBookingInput) {
  const { data, error } = await supabase.rpc("admin_update_accessory_booking", {
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

export async function listAccessoryBookings(opts: {
  scope?: "mine" | "all";
  status?: string;
  from?: string; to?: string;
  accessoryId?: string;
  limit?: number; offset?: number;
  managerDepartment?: string | null;
} = {}) {
  const { scope = "all", status, from, to, accessoryId, limit = 50, offset = 0, managerDepartment } = opts;
  let q = supabase.from("accessory_bookings").select(
    "*, accessory:accessory_id(description,make,model), profile:profiles!accessory_bookings_user_profile_fk(full_name,employee_id,department)",
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
  if (from) q = q.gte("end_date", from);
  if (to) q = q.lte("booking_date", to);
  if (accessoryId) q = q.eq("accessory_id", accessoryId);
  q = q.range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function cancelAccessoryBooking(id: string, reason?: string) {
  const { error } = await supabase.rpc("cancel_accessory_booking", { _booking_id: id, _reason: reason || null });
  if (error) throw error;
}

export async function markAccessoryBookingReturned(id: string, reason?: string) {
  const { error } = await supabase.rpc("return_accessory_booking", { _booking_id: id, _reason: reason || null });
  if (error) throw error;
}

