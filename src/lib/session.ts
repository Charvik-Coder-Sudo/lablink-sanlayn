import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "manager" | "employee";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  employeeId: string;
  department: string | null;
  designation: string | null;
  phone: string | null;
  dob: string | null;
  avatarUrl: string | null;
  roles: AppRole[];
}

export function isPrivileged(roles: AppRole[]) {
  return roles.includes("admin") || roles.includes("manager");
}

export function isAdmin(roles: AppRole[]) {
  return roles.includes("admin");
}

export function highestRole(roles: AppRole[]): AppRole {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("manager")) return "manager";
  return "employee";
}

export async function loadSessionUser(): Promise<SessionUser | null> {
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return null;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);

  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? user.email ?? "",
    employeeId: profile?.employee_id ?? "",
    department: profile?.department ?? null,
    designation: profile?.designation ?? null,
    phone: profile?.phone ?? null,
    dob: profile?.dob ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    roles: (roles?.map((r) => r.role as AppRole) ?? ["employee"]) as AppRole[],
  };
}

export const SANLAYAN_DOMAIN = "sanlayan.com";
export function isCompanyEmail(email: string) {
  return email.trim().toLowerCase().endsWith("@" + SANLAYAN_DOMAIN);
}
