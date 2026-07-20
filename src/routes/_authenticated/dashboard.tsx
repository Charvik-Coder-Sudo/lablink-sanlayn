import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSessionUser } from "@/lib/use-session";
import { highestRole } from "@/lib/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Boxes, CalendarCheck2, PackageCheck, Users, Activity, Clock } from "lucide-react";
import { format } from "date-fns";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from "chart.js";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function StatCard({ title, value, icon: Icon, hint }: { title: string; value: string | number; icon: React.ComponentType<{ className?: string }>; hint?: string }) {
  return (
    <Card className="border-border">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
          <div className="h-9 w-9 rounded-md bg-accent text-accent-foreground grid place-items-center">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3 text-2xl font-semibold">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function DashboardPage() {
  const { data: user } = useSessionUser();
  const role = user ? highestRole(user.roles) : "employee";
  const today = format(new Date(), "yyyy-MM-dd");

  const stats = useQuery({
    queryKey: ["dashboard-stats", role, today, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [eqTotal, eqActive, todayBookings, todayReturns, users, myUpcoming, categoryStats] = await Promise.all([
        supabase.from("equipment").select("total_quantity", { count: "exact", head: false }),
        supabase.from("equipment").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("bookings").select("id", { count: "exact", head: true }).lte("booking_date", today).gte("end_date", today).eq("status", "booked"),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "returned").gte("returned_at", `${today}T00:00:00`),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("bookings").select("*, equipment:equipment_id(name)")
          .eq("user_id", user!.id).eq("status", "booked").gte("booking_date", today).order("booking_date").limit(5),
        supabase.from("equipment").select("category"),
      ]);
      const totalQty = (eqTotal.data ?? []).reduce((s, r) => s + (r.total_quantity ?? 0), 0);
      const categoryCounts: Record<string, number> = {};
      (categoryStats.data ?? []).forEach((r) => { categoryCounts[r.category] = (categoryCounts[r.category] ?? 0) + 1; });
      return {
        totalEquipmentUnits: totalQty,
        activeEquipmentCount: eqActive.count ?? 0,
        todayBookings: todayBookings.count ?? 0,
        todayReturns: todayReturns.count ?? 0,
        users: users.count ?? 0,
        myUpcoming: myUpcoming.data ?? [],
        categoryCounts,
      };
    },
  });

  const departmentStats = useQuery({
    queryKey: ["department-stats", role, user?.department, today],
    enabled: !!user && (role === "manager" || role === "admin"),
    queryFn: async () => {
      let relevantUserIds: string[] | null = null;
      if (role === "manager" && user?.department) {
        const { data: departmentProfiles } = await supabase.from("profiles").select("id").eq("department", user.department);
        relevantUserIds = (departmentProfiles ?? []).map((p) => p.id);
        if (!relevantUserIds.length) {
          return {
            totalBookings: 0,
            activeBookings: 0,
            upcomingBookings: 0,
            completedBookings: 0,
            cancelledBookings: 0,
            utilizationPercent: 0,
            currentlyInUse: 0,
            available: 0,
            upcoming: [] as Array<{ id: string; equipment_name: string; booking_date: string; start_time: string; end_time: string; purpose: string }>,
          };
        }
      }

      let q = supabase.from("bookings").select("id,status,booking_date,end_date,start_time,end_time,quantity,purpose,equipment:equipment_id(name)", { count: "exact" });
      if (relevantUserIds) q = q.in("user_id", relevantUserIds);
      const { data, error } = await q.order("booking_date", { ascending: true }).order("start_time", { ascending: true });
      if (error) throw error;

      const rows = data ?? [];
      const now = new Date();
      const activeRows = rows.filter((row) => row.status === "booked" && row.booking_date <= today && row.end_date >= today);
      const currentInUse = activeRows.filter((row) => {
        const start = new Date(`${row.booking_date}T${row.start_time}`);
        const end = new Date(`${row.end_date}T${row.end_time}`);
        return start <= now && now < end;
      }).length;
      const upcomingRows = rows.filter((row) => row.status === "booked" && row.booking_date >= today).slice(0, 5);
      const totalEquipmentUnits = (await supabase.from("equipment").select("total_quantity", { count: "exact" })).data?.reduce((sum, row) => sum + (row.total_quantity ?? 0), 0) ?? 0;

      return {
        totalBookings: rows.length,
        activeBookings: activeRows.length,
        upcomingBookings: upcomingRows.length,
        completedBookings: rows.filter((row) => row.status === "returned").length,
        cancelledBookings: rows.filter((row) => row.status === "cancelled").length,
        utilizationPercent: totalEquipmentUnits > 0 ? Math.round((activeRows.length / totalEquipmentUnits) * 100) : 0,
        currentlyInUse: currentInUse,
        available: Math.max(0, totalEquipmentUnits - currentInUse),
        upcoming: upcomingRows.map((row) => ({
          id: row.id,
          equipment_name: row.equipment?.name ?? "Equipment",
          booking_date: row.booking_date,
          start_time: row.start_time,
          end_time: row.end_time,
          purpose: row.purpose ?? "",
        })),
      };
    },
  });

  const recentActivity = useQuery({
    queryKey: ["recent-activity"],
    enabled: role === "admin" || role === "manager",
    queryFn: async () => {
      const { data } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(10);
      return data ?? [];
    },
  });

  const weeklyUsage = useQuery({
    queryKey: ["weekly-usage"],
    enabled: role !== "employee",
    queryFn: async () => {
      const start = format(new Date(Date.now() - 6 * 86400000), "yyyy-MM-dd");
      const { data } = await supabase.from("bookings").select("booking_date").gte("booking_date", start).lte("booking_date", today);
      const counts: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = format(new Date(Date.now() - i * 86400000), "yyyy-MM-dd");
        counts[d] = 0;
      }
      (data ?? []).forEach((r) => { counts[r.booking_date] = (counts[r.booking_date] ?? 0) + 1; });
      return counts;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {user?.fullName.split(" ")[0]}</h1>
          <p className="text-sm text-muted-foreground">Here's what's happening in the lab today.</p>
        </div>
        <div className="text-xs text-muted-foreground">{format(new Date(), "EEEE, d MMMM yyyy")}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Equipment Units" value={stats.data?.totalEquipmentUnits ?? "—"} icon={Boxes} />
        <StatCard title="Active Equipment" value={stats.data?.activeEquipmentCount ?? "—"} icon={PackageCheck} />
        <StatCard title="Today's Bookings" value={stats.data?.todayBookings ?? "—"} icon={CalendarCheck2} />
        {role === "employee"
          ? <StatCard title="My Upcoming" value={stats.data?.myUpcoming.length ?? 0} icon={Clock} />
          : <StatCard title="Total Users" value={stats.data?.users ?? "—"} icon={Users} />}
      </div>

      {(role === "manager" || role === "admin") && departmentStats.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Department booking overview</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wider text-muted-foreground">Total bookings</div><div className="mt-2 text-xl font-semibold">{departmentStats.data.totalBookings}</div></div>
              <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wider text-muted-foreground">Active</div><div className="mt-2 text-xl font-semibold">{departmentStats.data.activeBookings}</div></div>
              <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wider text-muted-foreground">Upcoming</div><div className="mt-2 text-xl font-semibold">{departmentStats.data.upcomingBookings}</div></div>
              <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wider text-muted-foreground">Completed</div><div className="mt-2 text-xl font-semibold">{departmentStats.data.completedBookings}</div></div>
              <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wider text-muted-foreground">Cancelled</div><div className="mt-2 text-xl font-semibold">{departmentStats.data.cancelledBookings}</div></div>
              <div className="rounded-md border p-3"><div className="text-xs uppercase tracking-wider text-muted-foreground">Utilization</div><div className="mt-2 text-xl font-semibold">{departmentStats.data.utilizationPercent}%</div></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Equipment status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Currently in use</div>
                  <div className="text-xs text-muted-foreground">Active reservations right now</div>
                </div>
                <div className="text-xl font-semibold">{departmentStats.data.currentlyInUse}</div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Currently available</div>
                  <div className="text-xs text-muted-foreground">Units ready for booking</div>
                </div>
                <div className="text-xl font-semibold">{departmentStats.data.available}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Upcoming department bookings</div>
                <ul className="mt-2 space-y-2 text-sm">
                  {(departmentStats.data.upcoming ?? []).length === 0
                    ? <li className="text-muted-foreground">No upcoming bookings.</li>
                    : departmentStats.data.upcoming.map((booking) => (
                      <li key={booking.id} className="flex items-center justify-between gap-2">
                        <span>{booking.equipment_name}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(booking.booking_date), "d MMM")} · {booking.start_time.slice(0,5)}–{booking.end_time.slice(0,5)}</span>
                      </li>
                    ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {role !== "employee" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-sm font-semibold">Bookings — last 7 days</CardTitle></CardHeader>
            <CardContent className="h-64">
              {weeklyUsage.data && (
                <Bar
                  data={{
                    labels: Object.keys(weeklyUsage.data).map((d) => format(new Date(d), "EEE d")),
                    datasets: [{
                      label: "Bookings", data: Object.values(weeklyUsage.data),
                      backgroundColor: "#6A1B9A", borderRadius: 6,
                    }],
                  }}
                  options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }}
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Equipment by category</CardTitle></CardHeader>
            <CardContent className="h-64">
              {stats.data && Object.keys(stats.data.categoryCounts).length > 0 && (
                <Doughnut
                  data={{
                    labels: Object.keys(stats.data.categoryCounts),
                    datasets: [{
                      data: Object.values(stats.data.categoryCounts),
                      backgroundColor: ["#6A1B9A","#9C27B0","#BA68C8","#4A148C","#7B1FA2","#8E24AA","#AB47BC","#CE93D8"],
                    }],
                  }}
                  options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } } }}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">My upcoming bookings</CardTitle>
            <Link to="/bookings" className="text-xs text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent>
            {(stats.data?.myUpcoming ?? []).length === 0
              ? <div className="text-sm text-muted-foreground">No upcoming bookings.</div>
              : <ul className="divide-y">
                  {stats.data!.myUpcoming.map((b: { id: string; equipment: { name: string } | null; booking_date: string; start_time: string; end_time: string; quantity: number }) => (
                    <li key={b.id} className="py-2.5 flex items-center justify-between text-sm">
                      <div>
                        <div className="font-medium">{b.equipment?.name ?? "Equipment"}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(b.booking_date), "d MMM")} · {b.start_time.slice(0,5)}–{b.end_time.slice(0,5)}</div>
                      </div>
                      <div className="text-xs px-2 py-1 rounded bg-accent text-accent-foreground">Qty {b.quantity}</div>
                    </li>
                  ))}
                </ul>}
          </CardContent>
        </Card>

        {(role === "admin" || role === "manager") && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><Activity className="h-4 w-4" /> Recent activity</CardTitle></CardHeader>
            <CardContent>
              {(recentActivity.data ?? []).length === 0
                ? <div className="text-sm text-muted-foreground">No activity yet.</div>
                : <ul className="divide-y">
                    {recentActivity.data!.map((a) => (
                      <li key={a.id} className="py-2 text-sm">
                        <div className="flex justify-between gap-3">
                          <div>
                            <div className="font-medium capitalize">{a.action.replaceAll("_"," ")}</div>
                            <div className="text-xs text-muted-foreground">{a.description ?? ""}</div>
                          </div>
                          <div className="text-[11px] text-muted-foreground whitespace-nowrap">{format(new Date(a.created_at), "d MMM HH:mm")}</div>
                        </div>
                      </li>
                    ))}
                  </ul>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
