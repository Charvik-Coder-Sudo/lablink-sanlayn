import { format, addDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { AvailabilityState, EquipmentAvailability } from "./equipment-availability";

export interface AccessoryBookingSlot {
  id: string;
  accessory_id: string;
  user_id: string;
  booking_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  quantity: number;
  project_name: string;
  profile?: { full_name?: string | null; department?: string | null } | null;
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

interface RawAccessorySlotRow {
  id: string;
  accessory_id: string;
  user_id: string;
  booking_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  quantity: number;
  project_name: string;
  full_name: string | null;
  department: string | null;
}

/**
 * Fetches active ("booked") accessory slots overlapping [from, to] (default today..tomorrow)
 * via the SECURITY DEFINER `accessory_booking_slots` RPC, so every authenticated user sees
 * the true booking state (a normal user's direct read is RLS-limited to their own rows).
 * Mirrors fetchEquipmentBookingSlots exactly to keep the modules behaviorally identical.
 */
export async function fetchAccessoryBookingSlots(
  accessoryIds: string[],
  opts?: { now?: Date; from?: string; to?: string },
): Promise<Record<string, AccessoryBookingSlot[]>> {
  if (accessoryIds.length === 0) return {};
  const now = opts?.now ?? new Date();
  const from = opts?.from ?? format(now, "yyyy-MM-dd");
  const to = opts?.to ?? format(addDays(now, 1), "yyyy-MM-dd");

  const { data, error } = await supabase.rpc("accessory_booking_slots", {
    _accessory_ids: accessoryIds,
    _from: from,
    _to: to,
  });
  if (error) throw error;

  const map: Record<string, AccessoryBookingSlot[]> = {};
  for (const row of (data ?? []) as RawAccessorySlotRow[]) {
    (map[row.accessory_id] ??= []).push({
      id: row.id,
      accessory_id: row.accessory_id,
      user_id: row.user_id,
      booking_date: row.booking_date,
      end_date: row.end_date,
      start_time: row.start_time,
      end_time: row.end_time,
      quantity: row.quantity,
      project_name: row.project_name,
      profile: { full_name: row.full_name, department: row.department },
    });
  }
  return map;
}

export function computeAccessoryAvailability(
  slots: AccessoryBookingSlot[],
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

  const currentBookings = [...current]
    .sort((a, b) => combineDateTime(a.end_date, a.end_time).getTime() - combineDateTime(b.end_date, b.end_time).getTime())
    .map((b) => ({
      bookingId: b.id,
      userId: b.user_id,
      name: b.profile?.full_name ?? "Unknown",
      department: b.profile?.department ?? null,
      projectName: b.project_name,
      quantity: b.quantity,
      fromLabel: formatSlotLabel(b.booking_date, b.start_time, now),
      returnsAtLabel: formatSlotLabel(b.end_date, b.end_time, now),
    }));

  const upcoming = slots
    .filter((b) => combineDateTime(b.booking_date, b.start_time) > now)
    .sort((a, b) => combineDateTime(a.booking_date, a.start_time).getTime() - combineDateTime(b.booking_date, b.start_time).getTime())[0];

  return {
    state,
    totalQty: totalQuantity,
    availableQty,
    bookedQty,
    currentBookings,
    nextReservation: upcoming
      ? { fromLabel: formatSlotLabel(upcoming.booking_date, upcoming.start_time, now), name: upcoming.profile?.full_name ?? "Unknown" }
      : undefined,
  };
}

/** Units not currently tied up by an in-progress booking, right now. */
export function computeAvailableAccessoryQuantity(
  slots: AccessoryBookingSlot[],
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

export type { AvailabilityState };
