import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export type AvailabilityStatus = "available" | "booked" | "reserved";

export interface EquipmentAvailability {
  status: AvailabilityStatus;
  label: string;
  detail?: string;
  bookedBy?: string;
  department?: string | null;
  availableAt?: string;      // human friendly
  reservedFrom?: string;     // human friendly
  activeQty: number;
  totalQty: number;
  canBook: boolean;
}

interface BookingRow {
  equipment_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  quantity: number;
  profile: { full_name: string | null; department: string | null } | null;
}

function hm(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

function formatWhen(dateStr: string, timeStr: string, todayStr: string, tomorrowStr: string) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (dateStr === todayStr) return `Today ${time}`;
  if (dateStr === tomorrowStr) return `Tomorrow ${time}`;
  const [y, mo, day] = dateStr.split("-").map(Number);
  return `${new Date(y, mo - 1, day).toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export async function fetchAvailabilityMap(
  equipment: { id: string; total_quantity: number }[],
): Promise<Map<string, EquipmentAvailability>> {
  const map = new Map<string, EquipmentAvailability>();
  if (equipment.length === 0) return map;

  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  const tomorrow = format(new Date(now.getTime() + 86400000), "yyyy-MM-dd");
  const horizon = format(new Date(now.getTime() + 14 * 86400000), "yyyy-MM-dd");
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const ids = equipment.map((e) => e.id);
  const { data, error } = await supabase
    .from("bookings")
    .select("equipment_id,booking_date,start_time,end_time,quantity,profile:profiles!bookings_user_profile_fk(full_name,department)")
    .in("equipment_id", ids)
    .eq("status", "booked")
    .gte("booking_date", today)
    .lte("booking_date", horizon)
    .order("booking_date")
    .order("start_time");

  if (error) throw error;

  const grouped = new Map<string, BookingRow[]>();
  (data ?? []).forEach((r) => {
    const row = r as unknown as BookingRow;
    // Skip past bookings today
    if (row.booking_date === today && hm(row.end_time) <= nowMin) return;
    const arr = grouped.get(row.equipment_id) ?? [];
    arr.push(row);
    grouped.set(row.equipment_id, arr);
  });

  for (const eq of equipment) {
    const rows = grouped.get(eq.id) ?? [];
    const active = rows.filter(
      (r) => r.booking_date === today && hm(r.start_time) <= nowMin && hm(r.end_time) > nowMin,
    );
    const activeQty = active.reduce((s, r) => s + r.quantity, 0);
    const totalQty = eq.total_quantity ?? 0;

    if (activeQty >= totalQty && totalQty > 0) {
      // Currently booked — find earliest end among active
      const soonest = [...active].sort((a, b) => hm(a.end_time) - hm(b.end_time))[0];
      map.set(eq.id, {
        status: "booked",
        label: "Currently Booked",
        bookedBy: soonest?.profile?.full_name ?? "Unknown",
        department: soonest?.profile?.department ?? null,
        availableAt: soonest ? formatWhen(today, soonest.end_time, today, tomorrow) : undefined,
        activeQty,
        totalQty,
        canBook: false,
      });
      continue;
    }

    // Not fully booked now — look for an upcoming reservation
    const upcoming = rows.find((r) => !(r.booking_date === today && hm(r.start_time) <= nowMin));
    if (upcoming) {
      const soonMs = 24 * 60; // within 24h -> reserved soon
      const dayDiff = upcoming.booking_date === today ? 0 : upcoming.booking_date === tomorrow ? 1 : 2;
      const minutesUntil = dayDiff * 24 * 60 + hm(upcoming.start_time) - nowMin;
      if (minutesUntil <= soonMs) {
        map.set(eq.id, {
          status: "reserved",
          label: "Reserved Soon",
          bookedBy: upcoming.profile?.full_name ?? undefined,
          department: upcoming.profile?.department ?? null,
          reservedFrom: formatWhen(upcoming.booking_date, upcoming.start_time, today, tomorrow),
          activeQty,
          totalQty,
          canBook: true,
        });
        continue;
      }
    }

    map.set(eq.id, {
      status: "available",
      label: "Available Now",
      activeQty,
      totalQty,
      canBook: totalQty > 0,
    });
  }

  return map;
}
