import { format, addDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchEquipmentBookingSlots, computeEquipmentAvailability } from "./equipment-availability";

export interface DashboardKpis {
  totalEquipment: number;
  availableEquipment: number;
  bookedEquipment: number;
  overdueEquipment: number;
  totalAccessories: number;
  activeUsers: number;
  todaysBookings: number;
  upcomingBookings: number;
  pendingReturns: number;
  underCalibration: number;
  dueForCalibration: number;
}

function isPastEnd(b: { end_date: string; end_time: string; status: string }, now: Date): boolean {
  return b.status === "booked" && new Date(`${b.end_date}T${b.end_time}`).getTime() < now.getTime();
}
function isActiveToday(b: { booking_date: string; end_date: string; status: string }, todayStr: string): boolean {
  return b.status === "booked" && b.booking_date <= todayStr && b.end_date >= todayStr;
}

export async function fetchDashboardKpis(now: Date = new Date()): Promise<DashboardKpis> {
  const todayStr = format(now, "yyyy-MM-dd");
  const in30Str = format(addDays(now, 30), "yyyy-MM-dd");

  const [equipmentRes, accessoriesCountRes, usersCountRes, eqBookingsRes, accBookingsRes] = await Promise.all([
    supabase.from("equipment").select("id,status,total_quantity,calibration_due_date"),
    supabase.from("accessories").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("bookings").select("id,equipment_id,booking_date,end_date,start_time,end_time,status"),
    supabase.from("accessory_bookings").select("id,booking_date,end_date,start_time,end_time,status"),
  ]);

  const equipment = equipmentRes.data ?? [];
  const eqBookings = eqBookingsRes.data ?? [];
  const accBookings = accBookingsRes.data ?? [];

  const slots = await fetchEquipmentBookingSlots(equipment.map((e) => e.id), { now });
  let available = 0, booked = 0;
  for (const e of equipment) {
    if (e.status !== "active") continue;
    const availability = computeEquipmentAvailability(slots[e.id] ?? [], e.total_quantity, now);
    if (availability.state === "fully_booked") booked += 1; else available += 1;
  }

  const overdueEquipmentIds = new Set(eqBookings.filter((b) => isPastEnd(b, now)).map((b) => b.equipment_id));
  const pendingReturns = eqBookings.filter((b) => isPastEnd(b, now)).length + accBookings.filter((b) => isPastEnd(b, now)).length;
  const todaysBookings = eqBookings.filter((b) => isActiveToday(b, todayStr)).length + accBookings.filter((b) => isActiveToday(b, todayStr)).length;
  const upcomingBookings = eqBookings.filter((b) => b.status === "booked" && b.booking_date > todayStr).length
    + accBookings.filter((b) => b.status === "booked" && b.booking_date > todayStr).length;

  const underCalibration = equipment.filter((e) => e.status === "maintenance").length;
  const dueForCalibration = equipment.filter((e) => e.calibration_due_date && e.calibration_due_date >= todayStr && e.calibration_due_date <= in30Str).length;

  return {
    totalEquipment: equipment.length,
    availableEquipment: available,
    bookedEquipment: booked,
    overdueEquipment: overdueEquipmentIds.size,
    totalAccessories: accessoriesCountRes.count ?? 0,
    activeUsers: usersCountRes.count ?? 0,
    todaysBookings,
    upcomingBookings,
    pendingReturns,
    underCalibration,
    dueForCalibration,
  };
}

export interface UtilizationBreakdown {
  total: number;
  bookedCount: number;
  idleCount: number;
  maintenanceCount: number;
  bookedPct: number;
  idlePct: number;
  maintenancePct: number;
}

export async function fetchEquipmentUtilization(now: Date = new Date()): Promise<UtilizationBreakdown> {
  const { data } = await supabase.from("equipment").select("id,status,total_quantity");
  const equipment = data ?? [];
  const slots = await fetchEquipmentBookingSlots(equipment.map((e) => e.id), { now });

  let bookedCount = 0, idleCount = 0, maintenanceCount = 0;
  for (const e of equipment) {
    if (e.status !== "active") { maintenanceCount += 1; continue; }
    const availability = computeEquipmentAvailability(slots[e.id] ?? [], e.total_quantity, now);
    if (availability.state === "fully_booked") bookedCount += 1; else idleCount += 1;
  }

  const total = equipment.length;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  return { total, bookedCount, idleCount, maintenanceCount, bookedPct: pct(bookedCount), idlePct: pct(idleCount), maintenancePct: pct(maintenanceCount) };
}

export interface BookingAnalyticsRow {
  source: "equipment" | "accessory";
  booking_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  status: string;
  quantity: number;
  itemName: string;
  category: string;
  department: string;
  userId: string;
}

export interface BookingAnalyticsFilters {
  from: string;
  to: string;
  department?: string;
  category?: string;
  itemName?: string;
  status?: string;
  userId?: string;
}

export async function fetchBookingAnalyticsRows(filters: BookingAnalyticsFilters): Promise<BookingAnalyticsRow[]> {
  const { from, to } = filters;
  const [eq, acc] = await Promise.all([
    supabase.from("bookings")
      .select("booking_date,end_date,start_time,end_time,status,quantity,user_id,equipment:equipment_id(name,category),profile:profiles!bookings_user_profile_fk(department)")
      .gte("booking_date", from).lte("booking_date", to),
    supabase.from("accessory_bookings")
      .select("booking_date,end_date,start_time,end_time,status,quantity,user_id,accessory:accessory_id(description),profile:profiles!accessory_bookings_user_profile_fk(department)")
      .gte("booking_date", from).lte("booking_date", to),
  ]);

  const rows: BookingAnalyticsRow[] = [];
  for (const b of eq.data ?? []) {
    rows.push({
      source: "equipment", booking_date: b.booking_date, end_date: b.end_date, start_time: b.start_time, end_time: b.end_time,
      status: b.status, quantity: b.quantity, userId: b.user_id,
      itemName: b.equipment?.name ?? "—", category: b.equipment?.category ?? "Uncategorized",
      department: b.profile?.department ?? "Unassigned",
    });
  }
  for (const b of acc.data ?? []) {
    rows.push({
      source: "accessory", booking_date: b.booking_date, end_date: b.end_date, start_time: b.start_time, end_time: b.end_time,
      status: b.status, quantity: b.quantity, userId: b.user_id,
      itemName: b.accessory?.description ?? "—", category: "Accessories",
      department: b.profile?.department ?? "Unassigned",
    });
  }

  return rows.filter((r) => {
    if (filters.department && filters.department !== "all" && r.department !== filters.department) return false;
    if (filters.category && filters.category !== "all" && r.category !== filters.category) return false;
    if (filters.itemName && filters.itemName !== "all" && r.itemName !== filters.itemName) return false;
    if (filters.status && filters.status !== "all" && r.status !== filters.status) return false;
    if (filters.userId && filters.userId !== "all" && r.userId !== filters.userId) return false;
    return true;
  });
}

export function computeDepartmentUsage(rows: BookingAnalyticsRow[]): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.department] = (counts[r.department] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export function computeCategoryUsage(rows: BookingAnalyticsRow[]): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + r.quantity;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

export function computeTopEquipment(rows: BookingAnalyticsRow[], limit = 10): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.itemName] = (counts[r.itemName] ?? 0) + r.quantity;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function computeMonthlyTrend(rows: BookingAnalyticsRow[]): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const month = r.booking_date.slice(0, 7); // yyyy-MM
    counts[month] = (counts[month] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeBookingHeatmap(rows: BookingAnalyticsRow[]): { matrix: number[][]; dayLabels: string[]; maxValue: number } {
  const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxValue = 0;
  for (const r of rows) {
    const day = new Date(`${r.booking_date}T00:00:00`).getDay();
    const hour = Number(r.start_time.slice(0, 2));
    if (Number.isNaN(hour) || hour < 0 || hour > 23) continue;
    matrix[day][hour] += 1;
    if (matrix[day][hour] > maxValue) maxValue = matrix[day][hour];
  }
  return { matrix, dayLabels: DAY_LABELS, maxValue };
}
