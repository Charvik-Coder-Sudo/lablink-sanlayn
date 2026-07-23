/**
 * Display-only status for a single booking ROW (distinct from equipment-level
 * availability). Never stored — always derived from the DB status + now() vs the
 * booking's start/end, matching the "never hardcode availability" rule applied
 * everywhere else in this module.
 */
export type BookingDisplayStatus = "booked" | "in_use" | "overdue" | "returned" | "cancelled";

export interface BookingLifecycleRow {
  status: string;
  booking_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
}

function combineDateTime(dateStr: string, timeStr: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

export function computeBookingDisplayStatus(b: BookingLifecycleRow, now: Date = new Date()): BookingDisplayStatus {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "returned" || b.status === "completed") return "returned";
  if (b.status !== "booked") return "booked";

  const start = combineDateTime(b.booking_date, b.start_time);
  const end = combineDateTime(b.end_date, b.end_time);
  if (now < start) return "booked";
  if (now >= end) return "overdue";
  return "in_use";
}

export const BOOKING_DISPLAY_STATUS_CONFIG: Record<BookingDisplayStatus, { label: string; className: string }> = {
  booked: { label: "Booked", className: "text-blue-700 dark:text-blue-400 bg-blue-500/10" },
  in_use: { label: "In Use", className: "text-amber-700 dark:text-amber-400 bg-amber-500/10" },
  overdue: { label: "Overdue", className: "text-red-700 dark:text-red-400 bg-red-500/10" },
  returned: { label: "Returned", className: "text-slate-600 dark:text-slate-300 bg-slate-500/10" },
  cancelled: { label: "Cancelled", className: "text-rose-800 dark:text-rose-300 bg-rose-500/12" },
};
