import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale,
  PointElement, LineElement, Tooltip, Legend,
} from "chart.js";
import { format, subDays } from "date-fns";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Download, Loader2, SlidersHorizontal, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  fetchBookingAnalyticsRows, fetchEquipmentUtilization,
  computeDepartmentUsage, computeCategoryUsage, computeTopEquipment, computeMonthlyTrend,
} from "@/lib/analytics";
import { exportReportsExcel, exportReportCsv, type ReportType, type ExportFilters } from "@/lib/reports-export";
import { cn } from "@/lib/utils";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);
// Dark command-center chart defaults: muted tick/legend text, faint gridlines, Inter.
ChartJS.defaults.color = "#64748b";
ChartJS.defaults.borderColor = "rgba(15,23,42,0.06)";
ChartJS.defaults.font.family = "Inter, system-ui, sans-serif";

const CHART_COLORS = ["#6D28D9", "#7C3AED", "#8B5CF6", "#5B21B6", "#A78BFA", "#9F67F0", "#C4B5FD", "#4C1D95"];

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const [from, setFrom] = useState(format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [department, setDepartment] = useState("all");
  const [category, setCategory] = useState("all");
  const [equipment, setEquipment] = useState("all");
  const [userId, setUserId] = useState("all");
  const [status, setStatus] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filters: ExportFilters = { from, to, department, category, equipment, userId, status };
  const activeFilterCount = [department, category, equipment, userId, status].filter((v) => v !== "all").length;

  const filterOptions = useQuery({
    queryKey: ["report-filter-options"],
    queryFn: async () => {
      const [profiles, categories, equipmentNames] = await Promise.all([
        supabase.from("profiles").select("id,full_name,department"),
        supabase.from("equipment").select("category"),
        supabase.from("equipment").select("name"),
      ]);
      const departments = Array.from(new Set((profiles.data ?? []).map((p) => p.department).filter((d): d is string => !!d))).sort();
      const categoryList = Array.from(new Set((categories.data ?? []).map((c) => c.category))).sort();
      const equipmentList = Array.from(new Set((equipmentNames.data ?? []).map((e) => e.name))).sort();
      const users = (profiles.data ?? []).map((p) => ({ id: p.id, name: p.full_name })).sort((a, b) => a.name.localeCompare(b.name));
      return { departments, categoryList, equipmentList, users };
    },
  });

  const rows = useQuery({
    queryKey: ["reports-rows", from, to, department, category, equipment, userId, status],
    queryFn: () => fetchBookingAnalyticsRows(filters),
  });

  const utilization = useQuery({
    queryKey: ["reports-utilization"],
    queryFn: () => fetchEquipmentUtilization(),
  });

  const departmentUsage = useMemo(() => computeDepartmentUsage(rows.data ?? []), [rows.data]);
  const categoryUsage = useMemo(() => computeCategoryUsage(rows.data ?? []), [rows.data]);
  const topEquipment = useMemo(() => computeTopEquipment(rows.data ?? [], 10), [rows.data]);
  const leastUsed = useMemo(() => [...computeTopEquipment(rows.data ?? [], 1000)].reverse().slice(0, 10), [rows.data]);
  const monthlyTrend = useMemo(() => computeMonthlyTrend(rows.data ?? []), [rows.data]);

  const returned = (rows.data ?? []).filter((r) => r.status === "returned").length;
  const cancelled = (rows.data ?? []).filter((r) => r.status === "cancelled").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">{from} → {to} · {rows.data?.length ?? 0} bookings</p>
        </div>
        <div className="w-full sm:w-auto"><ExportDialog filters={filters} /></div>
      </div>

      <Card>
        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CardContent className="p-4 space-y-3">
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="sm:hidden w-full justify-between">
                <span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> More filters {activeFilterCount > 0 && `(${activeFilterCount})`}</span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", filtersOpen && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="sm:contents">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mt-3 sm:mt-0">
                <div className="space-y-1">
                  <Label className="text-xs">Department</Label>
                  <Select value={department} onValueChange={setDepartment}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All departments</SelectItem>
                      {filterOptions.data?.departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {filterOptions.data?.categoryList.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Equipment</Label>
                  <Select value={equipment} onValueChange={setEquipment}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All equipment</SelectItem>
                      {filterOptions.data?.equipmentList.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">User</Label>
                  <Select value={userId} onValueChange={setUserId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All users</SelectItem>
                      {filterOptions.data?.users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="booked">Booked</SelectItem>
                      <SelectItem value="returned">Returned</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CollapsibleContent>
          </CardContent>
        </Collapsible>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Total bookings" value={rows.data?.length ?? 0} />
        <MetricCard label="Cancellations" value={cancelled} />
        <MetricCard label="Returns" value={returned} />
        <MetricCard label="Return rate" value={`${rows.data?.length ? Math.round((returned / rows.data.length) * 100) : 0}%`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Monthly booking trend</CardTitle></CardHeader>
          <CardContent className="h-72">
            {monthlyTrend.length > 0 ? (
              <Line
                data={{
                  labels: monthlyTrend.map(([m]) => format(new Date(`${m}-01`), "MMM yyyy")),
                  datasets: [{ label: "Bookings", data: monthlyTrend.map(([, v]) => v), borderColor: "#6D28D9", backgroundColor: "rgba(109,40,217,0.18)", fill: true, tension: 0.3 }],
                }}
                options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
              />
            ) : <div className="text-sm text-muted-foreground">No data in range.</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Equipment utilization (current)</CardTitle></CardHeader>
          <CardContent className="h-72">
            {utilization.data && utilization.data.total > 0 ? (
              <Doughnut
                data={{
                  labels: [`Booked (${utilization.data.bookedPct}%)`, `Idle (${utilization.data.idlePct}%)`, `Maintenance (${utilization.data.maintenancePct}%)`],
                  datasets: [{ data: [utilization.data.bookedCount, utilization.data.idleCount, utilization.data.maintenanceCount], backgroundColor: ["#EF4444", "#10B981", "#3B82F6"] }],
                }}
                options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }}
              />
            ) : <div className="text-sm text-muted-foreground">No equipment yet.</div>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Most used equipment</CardTitle></CardHeader>
          <CardContent className="h-72">
            {topEquipment.length > 0 && <Bar
              data={{ labels: topEquipment.map(([k]) => k), datasets: [{ label: "Units booked", data: topEquipment.map(([, v]) => v), backgroundColor: "#6D28D9", borderRadius: 4 }] }}
              options={{ indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
            />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Category-wise usage</CardTitle></CardHeader>
          <CardContent className="h-72">
            {categoryUsage.length > 0 && <Doughnut
              data={{ labels: categoryUsage.map(([k]) => k), datasets: [{ data: categoryUsage.map(([, v]) => v), backgroundColor: CHART_COLORS }] }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }}
            />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Department usage</CardTitle></CardHeader>
        <CardContent className="h-72">
          {departmentUsage.length > 0 && <Bar
            data={{ labels: departmentUsage.map(([k]) => k), datasets: [{ label: "Bookings", data: departmentUsage.map(([, v]) => v), backgroundColor: "#6D28D9", borderRadius: 4 }] }}
            options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
          />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Least used equipment</CardTitle></CardHeader>
        <CardContent>
          {leastUsed.length === 0 ? <div className="text-sm text-muted-foreground">No data.</div> : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b"><tr><th className="text-left py-2">Equipment</th><th className="text-right py-2">Units booked</th></tr></thead>
              <tbody className="divide-y">
                {leastUsed.map(([name, count]) => (
                  <tr key={name}><td className="py-2">{name}</td><td className="py-2 text-right">{count}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card><CardContent className="p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </CardContent></Card>
  );
}

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  equipment: "Equipment Report",
  booking: "Booking Report",
  user: "User Report",
  utilization: "Utilization Report",
};

function ExportDialog({ filters }: { filters: ExportFilters }) {
  const [open, setOpen] = useState(false);
  const [format_, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [selectedTypes, setSelectedTypes] = useState<ReportType[]>(["equipment", "booking", "user", "utilization"]);
  const [csvType, setCsvType] = useState<ReportType>("booking");
  const [busy, setBusy] = useState(false);

  function toggleType(type: ReportType) {
    setSelectedTypes((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  }

  async function runExport() {
    setBusy(true);
    try {
      if (format_ === "xlsx") {
        if (selectedTypes.length === 0) { toast.error("Select at least one report to include."); return; }
        await exportReportsExcel(selectedTypes, filters);
      } else {
        await exportReportCsv(csvType, filters);
      }
      toast.success("Report exported");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button className="w-full sm:w-auto"><Download className="h-4 w-4 mr-2" /> Export Report</Button></DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Export report</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">Uses the filters currently set on this page (date range, department, category, equipment, user, status).</div>
          <div className="space-y-1.5">
            <Label>Format</Label>
            <Select value={format_} onValueChange={(v) => setFormat(v as "xlsx" | "csv")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {format_ === "xlsx" ? (
            <div className="space-y-1.5">
              <Label>Sheets to include</Label>
              {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm py-1">
                  <Checkbox checked={selectedTypes.includes(type)} onCheckedChange={() => toggleType(type)} />
                  {REPORT_TYPE_LABELS[type]}
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Report</Label>
              <Select value={csvType} onValueChange={(v) => setCsvType(v as ReportType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((type) => (
                    <SelectItem key={type} value={type}>{REPORT_TYPE_LABELS[type]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">CSV exports a single report at a time.</div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={runExport} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Export</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
