import { supabase } from "@/integrations/supabase/client";
import { validateBookingDateTimeRange } from "./booking-validation";

export interface AccessoryBookingInput {
  accessory_id: string;
  booking_date: string; // yyyy-mm-dd (From Date)
  end_date: string;     // yyyy-mm-dd (To Date)
  start_time: string;   // HH:mm
  end_time: string;
  quantity: number;
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

  const { data, error } = await supabase.rpc("create_accessory_booking", {
    _accessory_id: input.accessory_id,
    _booking_date: input.booking_date,
    _end_date: input.end_date,
    _start: input.start_time,
    _end: input.end_time,
    _quantity: input.quantity,
    _purpose: input.purpose,
  });
  if (error) throw error;
  return data;
}

export async function accessoryDaySchedule(accessoryId: string, date: string) {
  const { data, error } = await supabase
    .from("accessory_bookings")
    .select("id,booking_date,end_date,start_time,end_time,quantity,status,purpose,profile:profiles!accessory_bookings_user_profile_fk(full_name)")
    .eq("accessory_id", accessoryId)
    .lte("booking_date", date)
    .gte("end_date", date)
    .eq("status", "booked")
    .order("start_time");
  if (error) throw error;
  return data ?? [];
}
