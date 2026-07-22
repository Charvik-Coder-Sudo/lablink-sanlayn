import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  component: AuditPage,
});

function AuditPage() {
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_logs")
        .select("*, profile:profiles!audit_user_profile_fk(full_name,email)")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = (q.data ?? []).filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return r.action.toLowerCase().includes(s) ||
      (r.description ?? "").toLowerCase().includes(s) ||
      (r.profile?.full_name ?? "").toLowerCase().includes(s) ||
      (r.profile?.email ?? "").toLowerCase().includes(s);
  });

  return (
    <div className="space-y-5">
      <div><h1 className="text-xl sm:text-2xl font-semibold">Audit log</h1><p className="text-sm text-muted-foreground">System activity across the platform.</p></div>
      <Card><CardContent className="p-4"><Input placeholder="Search action, user, description…" value={search} onChange={(e) => setSearch(e.target.value)} /></CardContent></Card>
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">{rows.length} events</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Timestamp</th>
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-xs whitespace-nowrap">{format(new Date(r.created_at), "d MMM yyyy HH:mm:ss")}</td>
                  <td className="px-4 py-2">{r.profile?.full_name ?? "system"}</td>
                  <td className="px-4 py-2 capitalize">
                    {r.action.replaceAll("_"," ")}
                    <div className="sm:hidden text-xs text-muted-foreground normal-case">{r.description ?? ""}</div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell">{r.description ?? ""}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-muted-foreground">No audit events.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
