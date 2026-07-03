import { supabase } from "@/integrations/supabase/client";

export async function logAudit(action: string, description?: string, metadata?: Record<string, unknown>) {
  try {
    const { data } = await supabase.auth.getUser();
    await supabase.from("audit_logs").insert({
      user_id: data.user?.id ?? null,
      action,
      description: description ?? null,
      metadata: (metadata ?? {}) as never,
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}
