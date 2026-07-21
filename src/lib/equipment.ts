import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "./audit";
import { extractSupabaseError, type SupabaseErrorInfo } from "./supabase-errors";

export interface EquipmentInput {
  equipment_code: string;
  name: string;
  category: string;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  lab_location: string;
  total_quantity: number;
  remarks?: string | null;
  status?: "active" | "maintenance" | "retired";
  calibration_date?: string | null;
  calibration_due_date?: string | null;
}

export async function listEquipment(opts: {
  search?: string; category?: string; status?: string; limit?: number; offset?: number;
} = {}) {
  const { search = "", category, status, limit = 25, offset = 0 } = opts;
  let q = supabase.from("equipment").select("*", { count: "exact" }).order("name");
  if (search) q = q.or(`name.ilike.%${search}%,equipment_code.ilike.%${search}%,manufacturer.ilike.%${search}%,model.ilike.%${search}%`);
  if (category) q = q.eq("category", category);
  if (status) q = q.eq("status", status as never);
  q = q.range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getEquipment(id: string) {
  const { data, error } = await supabase.from("equipment").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createEquipment(input: EquipmentInput) {
  const { data, error } = await supabase.from("equipment").insert(input as never).select().single();
  if (error) throw error;
  await logAudit("equipment_added", `Added ${data.name}`, { equipment_id: data.id });
  return data;
}

export async function updateEquipment(id: string, input: Partial<EquipmentInput>) {
  const { data, error } = await supabase.from("equipment").update(input as never).eq("id", id).select().single();
  if (error) throw error;
  await logAudit("equipment_updated", `Updated ${data.name}`, { equipment_id: id });
  return data;
}

export async function deleteEquipment(id: string) {
  const { data: eq } = await supabase.from("equipment").select("name").eq("id", id).single();
  const { error } = await supabase.from("equipment").delete().eq("id", id);
  if (error) throw error;
  await logAudit("equipment_deleted", `Deleted ${eq?.name ?? id}`, { equipment_id: id });
}

export async function fetchExistingEquipmentKeys(): Promise<{ codes: Set<string>; serials: Set<string> }> {
  const { data, error } = await supabase.from("equipment").select("equipment_code,serial_number");
  if (error) throw error;
  const codes = new Set<string>();
  const serials = new Set<string>();
  for (const row of data ?? []) {
    if (row.equipment_code) codes.add(row.equipment_code.trim().toLowerCase());
    if (row.serial_number) serials.add(row.serial_number.trim().toLowerCase());
  }
  return { codes, serials };
}

export interface EquipmentImportRow {
  rowNumber: number;
  equipment_code: string;
  name: string;
  category: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string;
  lab_location: string;
  total_quantity: number;
  remarks: string | null;
  calibration_date: string | null;
  calibration_due_date: string | null;
}

export interface EquipmentImportResult extends Partial<SupabaseErrorInfo> {
  row: number;
  description: string;
  status: "imported" | "skipped" | "failed";
  reason?: string;
  duplicate?: boolean;
}

export async function bulkImportEquipment(
  rows: EquipmentImportRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<EquipmentImportResult[]> {
  const { codes: existingCodes, serials: existingSerials } = await fetchExistingEquipmentKeys();
  const seenCodes = new Set<string>();
  const seenSerials = new Set<string>();
  const results: EquipmentImportResult[] = [];

  for (const row of rows) {
    const codeKey = row.equipment_code.trim().toLowerCase();
    const serialKey = row.serial_number.trim().toLowerCase();
    const dupReasons: string[] = [];
    if (existingCodes.has(codeKey) || seenCodes.has(codeKey)) dupReasons.push("Asset ID already exists");
    if (existingSerials.has(serialKey) || seenSerials.has(serialKey)) dupReasons.push("Device Serial Number already exists");

    if (dupReasons.length > 0) {
      results.push({ row: row.rowNumber, description: row.name, status: "skipped", duplicate: true, reason: dupReasons.join("; ") });
      onProgress?.(results.length, rows.length);
      continue;
    }
    seenCodes.add(codeKey);
    seenSerials.add(serialKey);

    const { rowNumber, ...payload } = row;
    console.log(`[equipment import] row ${rowNumber} payload:`, payload);
    try {
      const { error } = await supabase.from("equipment").insert({ ...payload, status: "active" } as never);
      if (error) {
        const info = extractSupabaseError(error);
        console.error(`[equipment import] row ${rowNumber} insert error:`, info, error);
        results.push({ row: rowNumber, description: row.name, status: "failed", ...info });
      } else {
        results.push({ row: rowNumber, description: row.name, status: "imported" });
      }
    } catch (err) {
      const info = extractSupabaseError(err);
      console.error(`[equipment import] row ${rowNumber} threw:`, info, err);
      results.push({ row: rowNumber, description: row.name, status: "failed", ...info });
    }
    onProgress?.(results.length, rows.length);
  }

  await logAudit("equipment_imported", `Imported ${results.filter((r) => r.status === "imported").length} equipment items`, { total: results.length });
  return results;
}
