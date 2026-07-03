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
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const days = parseInt(range, 10);
  const from = format(subDays(new Date(), days - 1), "yyyy-MM-dd");
  const to = format(new Date(), "yyyy-MM-dd");

  const data = useQuery({
    queryKey: ["reports", from, to],
    queryFn: async () => {
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id,booking_date,status,quantity,equipment:equipment_id(name,category),profile:profiles!bookings_user_profile_fk(department)")
        .gte("booking_date", from).lte("booking_date", to);
      return bookings ?? [];
    },
  });

  const equipmentUsage: Record<string, number> = {};
  const departmentUsage: Record<string, number> = {};
  const dailyBookings: Record<string, number> = {};
  let cancellations = 0, returned = 0;

  for (let i = 0; i < days; i++) dailyBookings[format(subDays(new Date(), days - 1 - i), "yyyy-MM-dd")] = 0;

  (data.data ?? []).forEach((b) => {
    const eq = b.equipment?.name ?? "—";
    const dept = b.profile?.department ?? "Unassigned";
    equipmentUsage[eq] = (equipmentUsage[eq] ?? 0) + b.quantity;
    departmentUsage[dept] = (departmentUsage[dept] ?? 0) + 1;
    if (dailyBookings[b.booking_date] !== undefined) dailyBookings[b.booking_date] += 1;
    if (b.status === "cancelled") cancellations += 1;
    if (b.status === "returned") returned += 1;
  });

  const topEquipment = Object.entries(equipmentUsage).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const leastUsed = Object.entries(equipmentUsage).sort((a, b) => a[1] - b[1]).slice(0, 10);

  function exportCsv() {
    const rows = [["Booking date","Status","Equipment","Category","Department","Quantity"]];
    (data.data ?? []).forEach((b) => rows.push([
      b.booking_date, b.status, b.equipment?.name ?? "", b.equipment?.category ?? "",
      b.profile?.department ?? "", String(b.quantity),
    ]));
    const csv = rows.map((r) => r.map((v) => `"${(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bookings_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">{from} → {to} · {data.data?.length ?? 0} bookings</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={range} onValueChange={(v) => setRange(v as "7" | "30" | "90")}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-2" /> Export CSV</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Total bookings" value={data.data?.length ?? 0} />
        <MetricCard label="Cancellations" value={cancellations} />
        <MetricCard label="Returns" value={returned} />
        <MetricCard label="Utilization rate" value={`${data.data?.length ? Math.round((returned / data.data.length) * 100) : 0}%`} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Daily bookings</CardTitle></CardHeader>
        <CardContent className="h-72">
          <Line
            data={{
              labels: Object.keys(dailyBookings).map((d) => format(new Date(d), "d MMM")),
              datasets: [{ label: "Bookings", data: Object.values(dailyBookings), borderColor: "#6A1B9A", backgroundColor: "rgba(106,27,154,0.15)", fill: true, tension: 0.3 }],
            }}
            options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Most used equipment</CardTitle></CardHeader>
          <CardContent className="h-72">
            {topEquipment.length > 0 && <Bar
              data={{ labels: topEquipment.map(([k]) => k), datasets: [{ label: "Units booked", data: topEquipment.map(([,v]) => v), backgroundColor: "#6A1B9A", borderRadius: 4 }] }}
              options={{ indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
            />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Department usage</CardTitle></CardHeader>
          <CardContent className="h-72">
            {Object.keys(departmentUsage).length > 0 && <Doughnut
              data={{ labels: Object.keys(departmentUsage), datasets: [{ data: Object.values(departmentUsage), backgroundColor: ["#6A1B9A","#9C27B0","#BA68C8","#4A148C","#7B1FA2","#AB47BC","#CE93D8"] }] }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }}
            />}
          </CardContent>
        </Card>
      </div>

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
