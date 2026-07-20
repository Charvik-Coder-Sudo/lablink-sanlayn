import { format, addDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export interface BookingSlot {
  equipment_id: string;
  booking_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  quantity: number;
  profile?: { full_name?: string | null; department?: string | null } | null;
}

export type AvailabilityState = "available" | "booked" | "reserved" | "unavailable";

export interface EquipmentAvailability {
  state: AvailabilityState;
  bookedBy?: { name: string; department: string | null };
  availableAtLabel?: string;
  reservedFromLabel?: string;
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
    .select("equipment_id,booking_date,end_date,start_time,end_time,quantity,profile:profiles!bookings_user_profile_fk(full_name,department)")
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
 * Determines real-time availability for one equipment item from its nearby booking slots.
 * "booked" only when currently-active bookings consume the full quantity; otherwise the
 * nearest upcoming slot (already limited to today/tomorrow by the fetch) marks it "reserved".
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

  if (current.length > 0 && bookedQty >= totalQuantity) {
    const soonest = [...current].sort(
      (a, b) => combineDateTime(a.end_date, a.end_time).getTime() - combineDateTime(b.end_date, b.end_time).getTime(),
    )[0];
    return {
      state: "booked",
      bookedBy: { name: soonest.profile?.full_name ?? "Unknown", department: soonest.profile?.department ?? null },
      availableAtLabel: formatSlotLabel(soonest.end_date, soonest.end_time, now),
    };
  }

  const upcoming = slots
    .filter((b) => combineDateTime(b.booking_date, b.start_time) > now)
    .sort((a, b) => combineDateTime(a.booking_date, a.start_time).getTime() - combineDateTime(b.booking_date, b.start_time).getTime())[0];

  if (upcoming) {
    return { state: "reserved", reservedFromLabel: formatSlotLabel(upcoming.booking_date, upcoming.start_time, now) };
  }

  return { state: "available" };
}
