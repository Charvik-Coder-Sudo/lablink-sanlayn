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
  fromLabel: string;
  returnsAtLabel: string;
}

/** Minimal slot shape shared by equipment and accessory bookings, for slot-availability math. */
export interface SlotForAvailability {
  id: string;
  user_id: string;
  booking_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  quantity: number;
  project_name: string;
  profile?: { full_name?: string | null; department?: string | null } | null;
}

export interface EquipmentAvailability {
  state: AvailabilityState;
  totalQty: number;
  availableQty: number;
  bookedQty: number;
  currentBookings: CurrentBooking[];
  nextReservation?: { fromLabel: string; name: string };
  nextAvailableLabel?: string;
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

interface RawSlotRow {
  id: string;
  equipment_id: string;
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
 * Fetches active ("booked") slots for the given equipment ids, overlapping [from, to]
 * (default: today..tomorrow). Uses the SECURITY DEFINER `equipment_booking_slots` RPC so
 * EVERY authenticated user sees the true booking state — a normal user's direct table read
 * is restricted by RLS to their own rows, which would make availability under-count and
 * hide the current borrower. The RPC returns only non-sensitive fields.
 */
export async function fetchEquipmentBookingSlots(
  equipmentIds: string[],
  opts?: { now?: Date; from?: string; to?: string },
): Promise<Record<string, BookingSlot[]>> {
  if (equipmentIds.length === 0) return {};
  const now = opts?.now ?? new Date();
  const from = opts?.from ?? format(now, "yyyy-MM-dd");
  const to = opts?.to ?? format(addDays(now, 1), "yyyy-MM-dd");

  const { data, error } = await supabase.rpc("equipment_booking_slots", {
    _equipment_ids: equipmentIds,
    _from: from,
    _to: to,
  });
  if (error) throw error;

  const map: Record<string, BookingSlot[]> = {};
  for (const row of (data ?? []) as RawSlotRow[]) {
    (map[row.equipment_id] ??= []).push({
      id: row.id,
      equipment_id: row.equipment_id,
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

/**
 * Quantity-driven availability for a SPECIFIC requested slot (the booking form's selected
 * from/to/start/end), computed from the bookings overlapping that slot. Mirrors the exact
 * overlap rule the create_booking RPC enforces, so the UI never disagrees with the backend.
 * Returns an EquipmentAvailability so it can drive the shared availability badge.
 */
export function computeSlotAvailability(
  slots: SlotForAvailability[],
  totalQuantity: number,
  from: string,
  to: string,
  start: string,
  end: string,
  now: Date = new Date(),
): EquipmentAvailability {
  const reqStart = combineDateTime(from, start);
  const reqEnd = combineDateTime(to, end);
  const overlapping = slots.filter((b) => {
    const bStart = combineDateTime(b.booking_date, b.start_time);
    const bEnd = combineDateTime(b.end_date, b.end_time);
    return bStart < reqEnd && bEnd > reqStart;
  });
  const bookedQty = overlapping.reduce((sum, b) => sum + b.quantity, 0);
  const availableQty = Math.max(0, totalQuantity - bookedQty);
  const state: AvailabilityState = bookedQty <= 0 ? "available" : availableQty <= 0 ? "fully_booked" : "limited";

  const sorted = [...overlapping].sort(
    (a, b) => combineDateTime(a.end_date, a.end_time).getTime() - combineDateTime(b.end_date, b.end_time).getTime(),
  );
  const currentBookings: CurrentBooking[] = sorted.map((b) => ({
    bookingId: b.id,
    userId: b.user_id,
    name: b.profile?.full_name ?? "Unknown",
    department: b.profile?.department ?? null,
    projectName: b.project_name,
    quantity: b.quantity,
    fromLabel: formatSlotLabel(b.booking_date, b.start_time, now),
    returnsAtLabel: formatSlotLabel(b.end_date, b.end_time, now),
  }));

  // When fully booked, the next opening is when the earliest-ending overlapping booking frees up.
  const nextAvailableLabel = state === "fully_booked" && sorted.length > 0
    ? formatSlotLabel(sorted[0].end_date, sorted[0].end_time, now)
    : undefined;

  return { state, totalQty: totalQuantity, availableQty, bookedQty, currentBookings, nextAvailableLabel };
}

// ============================================================================
// Calendar helpers (shared by equipment + accessory detail calendars)
// ============================================================================

function minutesOf(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

export type DayState = "available" | "partial" | "booked" | "maintenance";

/**
 * Per-DAY availability colour for the calendar grid, from the peak concurrent booked
 * quantity anywhere in that day: none booked → available (green); peak consumes every unit
 * at some point → booked (red); otherwise some-but-not-all → partial (yellow).
 */
export function computeDayState(slots: SlotForAvailability[], totalQuantity: number, dateStr: string): DayState {
  const dayBookings = slots.filter((s) => s.booking_date <= dateStr && s.end_date >= dateStr);
  if (dayBookings.length === 0) return "available";

  const dayStart = new Date(`${dateStr}T00:00:00`).getTime();
  const dayEnd = new Date(`${dateStr}T23:59:59`).getTime();
  const events: Array<[number, number]> = [];
  for (const b of dayBookings) {
    const s = Math.max(combineDateTime(b.booking_date, b.start_time).getTime(), dayStart);
    const e = Math.min(combineDateTime(b.end_date, b.end_time).getTime(), dayEnd);
    if (e <= s) continue;
    events.push([s, b.quantity]);
    events.push([e, -b.quantity]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ends (−) before starts (+) at a tie
  let cur = 0, peak = 0;
  for (const [, delta] of events) { cur += delta; if (cur > peak) peak = cur; }

  if (peak >= totalQuantity) return "booked";
  if (peak > 0) return "partial";
  return "available";
}

export interface DaySegment {
  fromLabel: string; // HH:MM
  toLabel: string;
  kind: "available" | "booked";
  name?: string;
  project?: string;
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Time-ordered daily schedule for one date within lab hours: each booking as a "booked"
 * segment (with borrower + project) and the free windows between them as "available"
 * segments — the Google-Calendar-style day view.
 */
export function buildDaySchedule(
  slots: SlotForAvailability[],
  dateStr: string,
  labStart: string,
  labEnd: string,
): DaySegment[] {
  const ls = minutesOf(labStart), le = minutesOf(labEnd);
  const day = slots.filter((s) => s.booking_date <= dateStr && s.end_date >= dateStr);

  const blocks = day
    .map((b) => {
      const from = b.booking_date < dateStr ? ls : Math.max(ls, minutesOf(b.start_time));
      const to = b.end_date > dateStr ? le : Math.min(le, minutesOf(b.end_time));
      return { from, to, name: b.profile?.full_name ?? "Booked", project: b.project_name };
    })
    .filter((b) => b.to > b.from)
    .sort((a, b) => a.from - b.from);

  // Merge busy intervals to find the free gaps (where NO booking is active).
  const merged: Array<[number, number]> = [];
  for (const b of blocks) {
    const last = merged[merged.length - 1];
    if (last && b.from <= last[1]) last[1] = Math.max(last[1], b.to);
    else merged.push([b.from, b.to]);
  }
  const gaps: DaySegment[] = [];
  let cursor = ls;
  for (const [f, t] of merged) {
    if (f > cursor) gaps.push({ fromLabel: fmtMin(cursor), toLabel: fmtMin(f), kind: "available" });
    cursor = Math.max(cursor, t);
  }
  if (cursor < le) gaps.push({ fromLabel: fmtMin(cursor), toLabel: fmtMin(le), kind: "available" });

  const booked: DaySegment[] = blocks.map((b) => ({
    fromLabel: fmtMin(b.from), toLabel: fmtMin(b.to), kind: "booked", name: b.name, project: b.project,
  }));

  return [...gaps, ...booked].sort(
    (a, b) => minutesOf(a.fromLabel) - minutesOf(b.fromLabel) || (a.kind === "available" ? -1 : 1),
  );
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
