import type { QueryClient } from "@tanstack/react-query";

/**
 * A booking being created, returned, or cancelled must free/consume equipment immediately
 * everywhere its availability or stats are shown — not just on the page the action was taken
 * from. These caches would otherwise sit stale until their own refetch interval (up to 60s)
 * or a manual navigation.
 */
export function invalidateBookingRelatedQueries(qc: QueryClient) {
  const keys = [
    "bookings", "my-active-bookings",
    "equipment-booking-slots", "schedule", "avail",
    "accessory-booking-slots", "accessory-schedule", "accessory-avail",
    "dashboard-kpis", "dashboard-utilization", "dashboard-analytics-rows",
    "dashboard-stats", "department-stats", "weekly-usage",
    "reports-rows", "reports-utilization",
  ];
  keys.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
}
