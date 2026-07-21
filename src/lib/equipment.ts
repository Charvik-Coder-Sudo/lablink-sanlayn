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
