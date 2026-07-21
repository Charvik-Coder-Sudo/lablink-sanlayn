import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const emailSchema = z.string().email().refine((e) => e.toLowerCase().endsWith("@sanlayan.com"), {
  message: "Only @sanlayan.com emails allowed",
});

const createUserSchema = z.object({
  email: emailSchema,
  password: z.string().min(8),
  full_name: z.string().min(1).max(100),
  employee_id: z.string().min(1).max(50),
  department: z.string().max(100).optional().nullable(),
  designation: z.string().max(100).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  dob: z.string().optional().nullable(),
  role: z.enum(["admin", "manager", "employee"]).default("employee"),
});

async function assertAdmin(context: { supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> }; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (error) throw new Error("Failed to verify role");
  if (!data) throw new Error("Forbidden: admin role required");
}

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createUserSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        employee_id: data.employee_id,
        department: data.department ?? null,
        designation: data.designation ?? null,
        phone: data.phone ?? null,
        dob: data.dob ?? null,
        role: data.role,
      },
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId, action: "user_created",
      description: `Created ${data.email} (${data.role})`,
      metadata: { new_user_id: created.user?.id, role: data.role } as never,
    });

    return { id: created.user?.id, email: created.user?.email };
  });

// Excel coerces numeric-looking cells (phone numbers) to JS numbers, stripping any leading
// zero in the process. Coerce back to a trimmed string before validating so a numeric cell
// doesn't fail with a raw "expected string, received number" type error, then require a plain
// 10-digit mobile number (blank stays optional).
const phoneSchema = z.preprocess(
  (value) => (value === null || value === undefined ? "" : String(value).trim()),
  z.string(),
).refine((v) => v === "" || /^\d{10}$/.test(v), {
  message: "Invalid phone number. Expected a 10-digit mobile number.",
}).transform((v) => (v === "" ? null : v));

const importRowSchema = z.object({
  email: emailSchema,
  password: z.string().min(8),
  full_name: z.string().min(1),
  employee_id: z.string().min(1),
  department: z.string().optional().nullable(),
  designation: z.string().optional().nullable(),
  phone: phoneSchema.optional(),
  dob: z.string().optional().nullable(),
});

export const adminBulkImportUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ rows: z.array(z.record(z.string(), z.unknown())).max(2000) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const results: Array<{ row: number; email: string; status: "created" | "skipped" | "error"; message?: string }> = [];

    for (let i = 0; i < data.rows.length; i++) {
      const raw = data.rows[i];
      try {
        const parsed = importRowSchema.parse(raw);
        // Skip duplicates by email
        const { data: existing } = await supabaseAdmin
          .from("profiles").select("id").eq("email", parsed.email).maybeSingle();
        if (existing) {
          results.push({ row: i + 2, email: parsed.email, status: "skipped", message: "Duplicate email" });
          continue;
        }
        const { error } = await supabaseAdmin.auth.admin.createUser({
          email: parsed.email,
          password: parsed.password,
          email_confirm: true,
          user_metadata: {
            full_name: parsed.full_name,
            employee_id: parsed.employee_id,
            department: parsed.department ?? null,
            designation: parsed.designation ?? null,
            phone: parsed.phone ?? null,
            dob: parsed.dob ?? null,
            role: "employee",
          },
        });
        if (error) throw error;
        results.push({ row: i + 2, email: parsed.email, status: "created" });
      } catch (err) {
        const message = err instanceof z.ZodError
          ? err.issues.map((issue) => issue.message).join("; ")
          : err instanceof Error ? err.message : "Invalid row";
        const email = typeof raw.email === "string" ? raw.email : "";
        results.push({ row: i + 2, email, status: "error", message });
      }
    }

    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId, action: "user_imported",
      description: `Imported ${results.filter(r=>r.status==="created").length} users`,
      metadata: { total: results.length } as never,
    });

    return { results };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    if (data.user_id === context.userId) throw new Error("Cannot delete your own account");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId, action: "user_deleted",
      description: `Deleted user ${data.user_id}`,
    });
    return { ok: true };
  });

export const adminSetRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    user_id: z.string().uuid(),
    role: z.enum(["admin", "manager", "employee"]),
    enable: z.boolean(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.enable) {
      await supabaseAdmin.from("user_roles").upsert({ user_id: data.user_id, role: data.role } as never, { onConflict: "user_id,role" });
    } else {
      if (data.role === "employee") throw new Error("Cannot remove base employee role");
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id).eq("role", data.role);
    }
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId, action: "role_updated",
      description: `${data.enable ? "Granted" : "Revoked"} ${data.role} for ${data.user_id}`,
    });
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    user_id: z.string().uuid(),
    new_password: z.string().min(8),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.new_password });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId, action: "password_reset",
      description: `Reset password for ${data.user_id}`,
    });
    return { ok: true };
  });
