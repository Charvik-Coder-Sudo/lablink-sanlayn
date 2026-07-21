import * as XLSXStyle from "xlsx-js-style";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { fetchEquipmentBookingSlots, computeEquipmentAvailability } from "./equipment-availability";

export interface ExportFilters {
  from: string; // yyyy-mm-dd
  to: string;
  department?: string; // "all" or a specific department
  category?: string;   // "all" or a specific equipment category
  equipment?: string;  // "all" or a specific equipment/accessory name
  userId?: string;     // "all" or a specific user id
  status?: string;     // "all" or a specific booking status
}

export type ReportType = "equipment" | "booking" | "user" | "utilization";

const REPORT_LABELS: Record<ReportType, string> = {
  equipment: "Equipment Report",
  booking: "Booking Report",
  user: "User Report",
  utilization: "Utilization Report",
};

// ============ Data fetchers ============

export async function fetchEquipmentReportRows(filters: Pick<ExportFilters, "category" | "equipment">, now: Date = new Date()) {
  let q = supabase.from("equipment").select("*").order("name");
  if (filters.category && filters.category !== "all") q = q.eq("category", filters.category);
  const { data, error } = await q;
  if (error) throw error;
  let equipment = data ?? [];
  if (filters.equipment && filters.equipment !== "all") equipment = equipment.filter((e) => e.name === filters.equipment);

  const slots = await fetchEquipmentBookingSlots(equipment.map((e) => e.id), { now });
  return equipment.map((e) => {
    const availability = e.status !== "active"
      ? (e.status === "maintenance" ? "Under maintenance" : "Retired")
      : computeEquipmentAvailability(slots[e.id] ?? [], e.total_quantity, now).state;
    return {
      "Asset ID": e.equipment_code,
      "Category": e.category,
      "Description": e.name,
      "Make": e.manufacturer ?? "",
      "Model": e.model ?? "",
      "Device Serial No": e.serial_number ?? "",
      "Quantity": e.total_quantity,
      "Status": e.status,
      "Availability": availability,
      "Calibration Date": e.calibration_date ?? "",
      "Calibration Due Date": e.calibration_due_date ?? "",
      "Lab Location": e.lab_location,
      "Remarks": e.remarks ?? "",
    };
  });
}

export async function fetchBookingReportRows(filters: ExportFilters) {
  let eqQuery = supabase.from("bookings")
    .select("id,booking_date,end_date,start_time,end_time,quantity,status,purpose,created_at,user_id,equipment:equipment_id(name,category),profile:profiles!bookings_user_profile_fk(full_name,department)")
    .gte("booking_date", filters.from).lte("booking_date", filters.to);
  let accQuery = supabase.from("accessory_bookings")
    .select("id,booking_date,end_date,start_time,end_time,quantity,status,purpose,created_at,user_id,accessory:accessory_id(description),profile:profiles!accessory_bookings_user_profile_fk(full_name,department)")
    .gte("booking_date", filters.from).lte("booking_date", filters.to);
  if (filters.status && filters.status !== "all") {
    eqQuery = eqQuery.eq("status", filters.status as never);
    accQuery = accQuery.eq("status", filters.status as never);
  }
  const [eq, acc] = await Promise.all([eqQuery, accQuery]);

  type Row = {
    "Booking ID": string; "Type": string; "Item": string; "Category": string; "User": string; "Department": string;
    "From Date": string; "To Date": string; "Start Time": string; "End Time": string; "Quantity": number;
    "Status": string; "Purpose": string; "Created At": string; __department: string; __userId: string; __category: string; __item: string;
  };
  const rows: Row[] = [];
  for (const b of eq.data ?? []) {
    rows.push({
      "Booking ID": b.id, "Type": "Equipment", "Item": b.equipment?.name ?? "—", "Category": b.equipment?.category ?? "—",
      "User": b.profile?.full_name ?? "—", "Department": b.profile?.department ?? "Unassigned",
      "From Date": b.booking_date, "To Date": b.end_date, "Start Time": b.start_time.slice(0, 5), "End Time": b.end_time.slice(0, 5),
      "Quantity": b.quantity, "Status": b.status, "Purpose": b.purpose, "Created At": b.created_at,
      __department: b.profile?.department ?? "Unassigned", __userId: b.user_id, __category: b.equipment?.category ?? "—", __item: b.equipment?.name ?? "—",
    });
  }
  for (const b of acc.data ?? []) {
    rows.push({
      "Booking ID": b.id, "Type": "Accessory", "Item": b.accessory?.description ?? "—", "Category": "Accessories",
      "User": b.profile?.full_name ?? "—", "Department": b.profile?.department ?? "Unassigned",
      "From Date": b.booking_date, "To Date": b.end_date, "Start Time": b.start_time.slice(0, 5), "End Time": b.end_time.slice(0, 5),
      "Quantity": b.quantity, "Status": b.status, "Purpose": b.purpose, "Created At": b.created_at,
      __department: b.profile?.department ?? "Unassigned", __userId: b.user_id, __category: "Accessories", __item: b.accessory?.description ?? "—",
    });
  }

  return rows.filter((r) =>
    (!filters.department || filters.department === "all" || r.__department === filters.department) &&
    (!filters.category || filters.category === "all" || r.__category === filters.category) &&
    (!filters.equipment || filters.equipment === "all" || r.__item === filters.equipment) &&
    (!filters.userId || filters.userId === "all" || r.__userId === filters.userId),
  ).map(({ __department, __userId, __category, __item, ...rest }) => rest);
}

export async function fetchUserReportRows(filters: Pick<ExportFilters, "from" | "to" | "department">) {
  const [profilesRes, rolesRes, eqBookings, accBookings] = await Promise.all([
    supabase.from("profiles").select("id,full_name,employee_id,email,department,designation,is_active"),
    supabase.from("user_roles").select("user_id,role"),
    supabase.from("bookings").select("user_id").gte("booking_date", filters.from).lte("booking_date", filters.to),
    supabase.from("accessory_bookings").select("user_id").gte("booking_date", filters.from).lte("booking_date", filters.to),
  ]);

  const roleMap: Record<string, string[]> = {};
  (rolesRes.data ?? []).forEach((r) => { (roleMap[r.user_id] ??= []).push(r.role); });
  const bookingCounts: Record<string, number> = {};
  [...(eqBookings.data ?? []), ...(accBookings.data ?? [])].forEach((b) => { bookingCounts[b.user_id] = (bookingCounts[b.user_id] ?? 0) + 1; });

  let profiles = profilesRes.data ?? [];
  if (filters.department && filters.department !== "all") profiles = profiles.filter((p) => (p.department ?? "Unassigned") === filters.department);

  return profiles.map((p) => ({
    "Full Name": p.full_name,
    "Employee ID": p.employee_id,
    "Email": p.email,
    "Department": p.department ?? "Unassigned",
    "Designation": p.designation ?? "",
    "Roles": (roleMap[p.id] ?? ["employee"]).join(", "),
    "Active": p.is_active ? "Yes" : "No",
    "Booking Count": bookingCounts[p.id] ?? 0,
  }));
}

const LAB_HOURS_PER_DAY = 12; // matches the app-wide 08:00–20:00 lab-hours window

export async function fetchUtilizationReportRows(filters: ExportFilters) {
  let eqQuery = supabase.from("equipment").select("id,name,category,total_quantity");
  if (filters.category && filters.category !== "all") eqQuery = eqQuery.eq("category", filters.category);
  const { data: equipmentData } = await eqQuery;
  let equipment = equipmentData ?? [];
  if (filters.equipment && filters.equipment !== "all") equipment = equipment.filter((e) => e.name === filters.equipment);
  const ids = equipment.map((e) => e.id);

  const { data: bookingsData } = await supabase.from("bookings")
    .select("equipment_id,booking_date,end_date,start_time,end_time,status,profile:profiles!bookings_user_profile_fk(department)")
    .in("equipment_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .gte("booking_date", filters.from).lte("booking_date", filters.to);

  let bookings = bookingsData ?? [];
  if (filters.department && filters.department !== "all") bookings = bookings.filter((b) => (b.profile?.department ?? "Unassigned") === filters.department);
  if (filters.status && filters.status !== "all") bookings = bookings.filter((b) => b.status === filters.status);

  const daysInRange = Math.max(1, Math.round((new Date(filters.to).getTime() - new Date(filters.from).getTime()) / 86400000) + 1);

  const rows = equipment.map((e) => {
    const itemBookings = bookings.filter((b) => b.equipment_id === e.id);
    const totalMinutes = itemBookings.reduce((sum, b) => {
      const start = new Date(`${b.booking_date}T${b.start_time}`).getTime();
      const end = new Date(`${b.end_date}T${b.end_time}`).getTime();
      return sum + Math.max(0, (end - start) / 60000);
    }, 0);
    const avgDurationHours = itemBookings.length > 0 ? totalMinutes / 60 / itemBookings.length : 0;
    const capacityMinutes = daysInRange * LAB_HOURS_PER_DAY * 60 * Math.max(1, e.total_quantity);
    const utilizationPct = capacityMinutes > 0 ? Math.min(100, Math.round((totalMinutes / capacityMinutes) * 100)) : 0;
    return {
      "Equipment": e.name, "Category": e.category, "Total Bookings": itemBookings.length,
      "Avg. Booking Duration (hrs)": Math.round(avgDurationHours * 10) / 10, "Utilization %": utilizationPct,
    };
  }).sort((a, b) => b["Total Bookings"] - a["Total Bookings"]);

  const mostBooked = rows[0];
  const leastBooked = rows.length > 0 ? rows[rows.length - 1] : undefined;
  return { rows, mostBooked, leastBooked };
}

// ============ Workbook / CSV building ============

function autoWidth(headers: string[], rows: Array<Record<string, unknown>>) {
  return headers.map((h) => {
    let max = h.length;
    for (const row of rows) {
      const v = row[h];
      if (v !== undefined && v !== null) max = Math.max(max, String(v).length);
    }
    return { wch: Math.min(Math.max(max + 2, 10), 60) };
  });
}

function buildStyledSheet(title: string, generatedAt: string, extraLines: string[], rows: Array<Record<string, unknown>>) {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const aoa: unknown[][] = [
    [title],
    [`Generated: ${generatedAt}`],
    ...extraLines.map((l) => [l]),
    [],
    headers,
    ...rows.map((r) => headers.map((h) => r[h] ?? "")),
  ];
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);

  const titleRef = XLSXStyle.utils.encode_cell({ r: 0, c: 0 });
  if (ws[titleRef]) ws[titleRef].s = { font: { bold: true, sz: 14 } };
  const genRef = XLSXStyle.utils.encode_cell({ r: 1, c: 0 });
  if (ws[genRef]) ws[genRef].s = { font: { italic: true, sz: 9, color: { rgb: "666666" } } };

  const headerRowIdx = 2 + extraLines.length + 1;
  headers.forEach((_, c) => {
    const ref = XLSXStyle.utils.encode_cell({ r: headerRowIdx, c });
    if (ws[ref]) ws[ref].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "6A1B9A" } }, alignment: { vertical: "center" } };
  });

  ws["!cols"] = autoWidth(headers, rows);
  return ws;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers, ...rows.map((r) => headers.map((h) => String(r[h] ?? "")))];
  return lines.map((line) => line.map((v) => `"${v.replaceAll('"', '""')}"`).join(",")).join("\n");
}

async function fetchReportRows(type: ReportType, filters: ExportFilters): Promise<Array<Record<string, unknown>>> {
  if (type === "equipment") return fetchEquipmentReportRows(filters);
  if (type === "booking") return fetchBookingReportRows(filters);
  if (type === "user") return fetchUserReportRows(filters);
  const { rows, mostBooked, leastBooked } = await fetchUtilizationReportRows(filters);
  void mostBooked; void leastBooked;
  return rows;
}

export async function exportReportsExcel(types: ReportType[], filters: ExportFilters) {
  const wb = XLSXStyle.utils.book_new();
  const generatedAt = format(new Date(), "d MMM yyyy, h:mm a");

  for (const type of types) {
    if (type === "utilization") {
      const { rows, mostBooked, leastBooked } = await fetchUtilizationReportRows(filters);
      const extra = [
        mostBooked ? `Most booked: ${mostBooked["Equipment"]} (${mostBooked["Total Bookings"]} bookings)` : "Most booked: —",
        leastBooked ? `Least booked: ${leastBooked["Equipment"]} (${leastBooked["Total Bookings"]} bookings)` : "Least booked: —",
      ];
      const ws = buildStyledSheet(REPORT_LABELS[type], generatedAt, extra, rows);
      XLSXStyle.utils.book_append_sheet(wb, ws, REPORT_LABELS[type].slice(0, 31));
      continue;
    }
    const rows = await fetchReportRows(type, filters);
    const ws = buildStyledSheet(REPORT_LABELS[type], generatedAt, [`Range: ${filters.from} to ${filters.to}`], rows);
    XLSXStyle.utils.book_append_sheet(wb, ws, REPORT_LABELS[type].slice(0, 31));
  }

  XLSXStyle.writeFile(wb, `sanlayan_report_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`);
}

export async function exportReportCsv(type: ReportType, filters: ExportFilters) {
  const rows = await fetchReportRows(type, filters);
  const csv = rowsToCsv(rows);
  triggerDownload(new Blob([csv], { type: "text/csv" }), `${type}_report_${format(new Date(), "yyyyMMdd_HHmm")}.csv`);
}
