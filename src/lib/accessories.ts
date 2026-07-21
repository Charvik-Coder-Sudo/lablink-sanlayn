import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "./audit";

export interface SupabaseErrorInfo {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
}

/**
 * PostgrestError/StorageError from supabase-js are plain objects, not Error instances,
 * so `instanceof Error` silently fails and discards code/details/hint. Read the fields
 * directly instead.
 */
export function extractSupabaseError(err: unknown): SupabaseErrorInfo {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    return {
      code: typeof e.code === "string" ? e.code : null,
      message: typeof e.message === "string" ? e.message : JSON.stringify(err),
      details: typeof e.details === "string" ? e.details : null,
      hint: typeof e.hint === "string" ? e.hint : null,
    };
  }
  return { code: null, message: String(err), details: null, hint: null };
}

export interface AccessoryInput {
  description: string;
  make?: string | null;
  model?: string | null;
  serial_number?: string | null;
  quantity: number;
  remarks?: string | null;
  photo_url?: string | null;
  status?: "active" | "maintenance" | "retired";
}

export async function listAccessories(opts: {
  search?: string; status?: string; limit?: number; offset?: number;
} = {}) {
  const { search = "", status, limit = 25, offset = 0 } = opts;
  let q = supabase.from("accessories").select("*", { count: "exact" }).order("description");
  if (search) q = q.or(`description.ilike.%${search}%,make.ilike.%${search}%,model.ilike.%${search}%,serial_number.ilike.%${search}%`);
  if (status) q = q.eq("status", status as never);
  q = q.range(offset, offset + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getAccessory(id: string) {
  const { data, error } = await supabase.from("accessories").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createAccessory(input: AccessoryInput) {
  const { data, error } = await supabase.from("accessories").insert(input as never).select().single();
  if (error) throw error;
  await logAudit("accessory_added", `Added ${data.description}`, { accessory_id: data.id });
  return data;
}

export async function updateAccessory(id: string, input: Partial<AccessoryInput>) {
  const { data, error } = await supabase.from("accessories").update(input as never).eq("id", id).select().single();
  if (error) throw error;
  await logAudit("accessory_updated", `Updated ${data.description}`, { accessory_id: id });
  return data;
}

export async function deleteAccessory(id: string) {
  const { data: acc } = await supabase.from("accessories").select("description").eq("id", id).single();
  const { error } = await supabase.from("accessories").delete().eq("id", id);
  if (error) throw error;
  await logAudit("accessory_deleted", `Deleted ${acc?.description ?? id}`, { accessory_id: id });
}

export interface BulkImportResult extends Partial<SupabaseErrorInfo> {
  row: number;
  description: string;
  status: "created" | "error";
  photoWarning?: string | null;
}

export async function bulkCreateAccessories(
  rows: Array<AccessoryInput & { rowNumber: number; photoWarning?: string | null }>,
): Promise<BulkImportResult[]> {
  const results: BulkImportResult[] = [];
  for (const row of rows) {
    const { rowNumber, photoWarning, ...input } = row;
    console.log(`[accessories import] row ${rowNumber} payload:`, input);
    try {
      const { error } = await supabase.from("accessories").insert(input as never);
      if (error) {
        const info = extractSupabaseError(error);
        console.error(`[accessories import] row ${rowNumber} insert error:`, info, error);
        results.push({ row: rowNumber, description: input.description, status: "error", ...info });
        continue;
      }
      results.push({ row: rowNumber, description: input.description, status: "created", photoWarning });
    } catch (err) {
      const info = extractSupabaseError(err);
      console.error(`[accessories import] row ${rowNumber} threw:`, info, err);
      results.push({ row: rowNumber, description: input.description, status: "error", ...info });
    }
  }
  await logAudit("accessory_imported", `Imported ${results.filter((r) => r.status === "created").length} accessories`, { total: results.length });
  return results;
}

export async function uploadAccessoryPhoto(file: Blob, extensionHint = "png"): Promise<string> {
  const ext = file instanceof File && file.name.includes(".") ? file.name.split(".").pop() : extensionHint;
  const path = `accessories/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("accessory-photos").upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from("accessory-photos").getPublicUrl(path);
  return data.publicUrl;
}
