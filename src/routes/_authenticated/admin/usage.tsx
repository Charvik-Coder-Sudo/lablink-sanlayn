import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchEmployeeUsageHistory } from "@/lib/analytics";
import { useSessionUser } from "@/lib/use-session";
import { isPrivileged } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download } from "lucide-react";
import { format } from "date-fns";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_authenticated/admin/usage")({
  component: UsagePage,
});

function UsagePage() {
  const { data: user } = useSessionUser();
  const canView = user ? isPrivileged(user.roles) : false;
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");

  const q = useQuery({
    queryKey: ["employee-usage-history"],
    queryFn: () => fetchEmployeeUsageHistory(),
    enabled: canView,
  });

  const departments = useMemo(() => {
    const set = new Set<string>();
    (q.data ?? []).forEach((r) => set.add(r.department));
    return Array.from(set).sort();
  }, [q.data]);

  const rows = (q.data ?? []).filter((r) => {
    if (department !== "all" && r.department !== department) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return r.name.toLowerCase().includes(s) || r.employeeId.toLowerCase().includes(s) || r.department.toLowerCase().includes(s);
  });

  function exportUsage() {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
      Employee: r.name,
      "Employee ID": r.employeeId,
      Department: r.department,
      "Total Bookings": r.totalBookings,
      "Current Bookings": r.currentBookings,
      Completed: r.completedBookings,
      Cancelled: r.cancelledBookings,
      "Distinct Items": r.equipmentUsedCount,
      "Avg Duration (h)": r.avgDurationHours,
      "Most Used": r.mostUsedEquipment,
      "Last Booking": r.lastBookingDate ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Employee Usage");
    XLSX.writeFile(wb, `employee_usage_${Date.now()}.xlsx`);
  }

  if (!canView) {
    return <div className="text-sm text-muted-foreground">This page is available to administrators and managers only.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Employee Usage History</h1>
          <p className="text-sm text-muted-foreground">Laboratory usage per employee, across equipment and accessories.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportUsage} disabled={rows.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Export
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3">
          <Input placeholder="Search employee, ID, department…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-72" />
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {q.isLoading ? (
        <Card><div className="text-center text-sm text-muted-foreground py-10">Loading usage history…</div></Card>
      ) : rows.length === 0 ? (
        <Card><div className="text-center text-sm text-muted-foreground py-10">No employees match your filters.</div></Card>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-3">
            {rows.map((r) => (
              <Card key={r.userId}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.employeeId} · {r.department}</div>
                    </div>
                    {r.currentBookings > 0 && <Badge>{r.currentBookings} active</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <div><span className="text-foreground font-medium">Total:</span> {r.totalBookings}</div>
                    <div><span className="text-foreground font-medium">Completed:</span> {r.completedBookings}</div>
                    <div><span className="text-foreground font-medium">Cancelled:</span> {r.cancelledBookings}</div>
                    <div><span className="text-foreground font-medium">Distinct items:</span> {r.equipmentUsedCount}</div>
                    <div><span className="text-foreground font-medium">Avg duration:</span> {r.avgDurationHours}h</div>
                    <div><span className="text-foreground font-medium">Last:</span> {r.lastBookingDate ? format(new Date(r.lastBookingDate), "d MMM yyyy") : "—"}</div>
                    <div className="col-span-2 truncate"><span className="text-foreground font-medium">Most used:</span> {r.mostUsedEquipment}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tablet/desktop: table */}
          <Card className="hidden md:block">
            <CardHeader><CardTitle className="text-sm font-semibold">{rows.length} employees</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3">Employee</th>
                    <th className="text-left px-4 py-3">Department</th>
                    <th className="text-right px-4 py-3">Total</th>
                    <th className="text-right px-4 py-3">Current</th>
                    <th className="text-right px-4 py-3">Completed</th>
                    <th className="text-right px-4 py-3">Cancelled</th>
                    <th className="text-right px-4 py-3">Items</th>
                    <th className="text-right px-4 py-3">Avg (h)</th>
                    <th className="text-left px-4 py-3">Most Used</th>
                    <th className="text-left px-4 py-3">Last Booking</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.userId} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">{r.employeeId}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{r.department}</td>
                      <td className="px-4 py-3 text-right font-medium">{r.totalBookings}</td>
                      <td className="px-4 py-3 text-right">{r.currentBookings > 0 ? <Badge>{r.currentBookings}</Badge> : "—"}</td>
                      <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">{r.completedBookings}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{r.cancelledBookings}</td>
                      <td className="px-4 py-3 text-right">{r.equipmentUsedCount}</td>
                      <td className="px-4 py-3 text-right">{r.avgDurationHours}</td>
                      <td className="px-4 py-3 max-w-[200px] truncate" title={r.mostUsedEquipment}>{r.mostUsedEquipment}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.lastBookingDate ? format(new Date(r.lastBookingDate), "d MMM yyyy") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
