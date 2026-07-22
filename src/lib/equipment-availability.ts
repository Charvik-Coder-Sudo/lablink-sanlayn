import { format, addDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export interface BookingSlot {
  id: string;
  equipment_id: string;
  user_id: string;
  booking_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  quantity: number;
  project_name: string;
  profile?: { full_name?: string | null; department?: string | null } | null;
}

/**
 * Availability is quantity-driven, not time-driven: "available" only when every unit is
 * free right now, "fully_booked" only when zero units are free right now. A booking that
 * starts later today never affects the CURRENT state — see `nextReservation` for that.
 */
export type AvailabilityState = "available" | "limited" | "fully_booked" | "unavailable";

export interface CurrentBooking {
  bookingId: string;
  userId: string;
  name: string;
  department: string | null;
  projectName: string;
  quantity: number;
  returnsAtLabel: string;
}

export interface EquipmentAvailability {
  state: AvailabilityState;
  totalQty: number;
  availableQty: number;
  currentBookings: CurrentBooking[];
  nextReservation?: { fromLabel: string; name: string };
  reasonLabel?: string;
}

function combineDateTime(dateStr: string, timeStr: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

function dayLabel(dateStr: string, now: Date): string {
  const today = format(now, "yyyy-MM-dd");
  const tomorrow = format(addDays(now, 1), "yyyy-MM-dd");
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  return format(combineDateTime(dateStr, "00:00"), "EEE, d MMM");
}

function formatSlotLabel(dateStr: string, timeStr: string, now: Date): string {
  return `${dayLabel(dateStr, now)} ${format(combineDateTime(dateStr, timeStr), "h:mm a")}`;
}

/** Fetches active ("booked") slots for the given equipment ids, covering today and tomorrow. */
export async function fetchEquipmentBookingSlots(
  equipmentIds: string[],
  opts?: { now?: Date },
): Promise<Record<string, BookingSlot[]>> {
  if (equipmentIds.length === 0) return {};
  const now = opts?.now ?? new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const tomorrowStr = format(addDays(now, 1), "yyyy-MM-dd");

  const { data, error } = await supabase
    .from("bookings")
    .select("id,equipment_id,user_id,booking_date,end_date,start_time,end_time,quantity,project_name,profile:profiles!bookings_user_profile_fk(full_name,department)")
    .in("equipment_id", equipmentIds)
    .eq("status", "booked")
    .lte("booking_date", tomorrowStr)
    .gte("end_date", todayStr)
    .order("booking_date", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw error;

  const map: Record<string, BookingSlot[]> = {};
  for (const row of (data ?? []) as BookingSlot[]) {
    (map[row.equipment_id] ??= []).push(row);
  }
  return map;
}

/**
 * Determines real-time, quantity-driven availability for one equipment item from its
 * nearby booking slots. State is purely a function of how many units are tied up by
 * bookings active RIGHT NOW — never by whether a future reservation exists.
 */
export function computeEquipmentAvailability(
  slots: BookingSlot[],
  totalQuantity: number,
  now: Date = new Date(),
): EquipmentAvailability {
  const current = slots.filter((b) => {
    const start = combineDateTime(b.booking_date, b.start_time);
    const end = combineDateTime(b.end_date, b.end_time);
    return start <= now && now < end;
  });
  const bookedQty = current.reduce((sum, b) => sum + b.quantity, 0);
  const availableQty = Math.max(0, totalQuantity - bookedQty);
  const state: AvailabilityState = bookedQty <= 0 ? "available" : availableQty <= 0 ? "fully_booked" : "limited";

  const currentBookings: CurrentBooking[] = [...current]
    .sort((a, b) => combineDateTime(a.end_date, a.end_time).getTime() - combineDateTime(b.end_date, b.end_time).getTime())
    .map((b) => ({
      bookingId: b.id,
      userId: b.user_id,
      name: b.profile?.full_name ?? "Unknown",
      department: b.profile?.department ?? null,
      projectName: b.project_name,
      quantity: b.quantity,
      returnsAtLabel: formatSlotLabel(b.end_date, b.end_time, now),
    }));

  const upcoming = slots
    .filter((b) => combineDateTime(b.booking_date, b.start_time) > now)
    .sort((a, b) => combineDateTime(a.booking_date, a.start_time).getTime() - combineDateTime(b.booking_date, b.start_time).getTime())[0];

  return {
    state,
    totalQty: totalQuantity,
    availableQty,
    currentBookings,
    nextReservation: upcoming
      ? { fromLabel: formatSlotLabel(upcoming.booking_date, upcoming.start_time, now), name: upcoming.profile?.full_name ?? "Unknown" }
      : undefined,
  };
}

/** Units not currently tied up by an in-progress booking, right now. Equal to computeEquipmentAvailability(...).availableQty. */
export function computeAvailableQuantity(
  slots: BookingSlot[],
  totalQuantity: number,
  now: Date = new Date(),
): number {
  const bookedNow = slots.reduce((sum, b) => {
    const start = combineDateTime(b.booking_date, b.start_time);
    const end = combineDateTime(b.end_date, b.end_time);
    return start <= now && now < end ? sum + b.quantity : sum;
  }, 0);
  return Math.max(0, totalQuantity - bookedNow);
}
