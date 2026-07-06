import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSessionUser } from "@/lib/use-session";
import { highestRole, isAdmin, isPrivileged, type AppRole } from "@/lib/session";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard, Boxes, CalendarCheck2, BarChart3, Users, UploadCloud,
  ClipboardList, User, LogOut, Menu,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; roles?: AppRole[] };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/equipment", label: "Equipment", icon: Boxes },
  { to: "/bookings", label: "Bookings", icon: CalendarCheck2 },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin", "manager"] },
  { to: "/admin/users", label: "Users", icon: Users, roles: ["admin"] },
  { to: "/admin/import", label: "Import Users", icon: UploadCloud, roles: ["admin"] },
  { to: "/admin/audit", label: "Audit Log", icon: ClipboardList, roles: ["admin"] },
  { to: "/profile", label: "My Profile", icon: User },
];

function AuthenticatedLayout() {
  const { data: user, isLoading } = useSessionUser();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!user) return null;

  const role = highestRole(user.roles);
  const items = NAV.filter((i) => !i.roles || i.roles.some((r) => user.roles.includes(r)));

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-transform lg:static lg:flex lg:translate-x-0",
        open ? "flex translate-x-0" : "hidden lg:flex -translate-x-full",
      )}>
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="text-lg font-bold tracking-tight leading-none">SANLAYAN</div>
          <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/60">
            Lab Management System
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{ className: "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground" }}
            >
              <item.icon className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" />
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/50">Signed in as</div>
          <div className="mt-1 text-sm font-medium truncate">{user.fullName}</div>
          <div className="text-[11px] text-sidebar-foreground/50 capitalize">{role}</div>
          <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card/95 backdrop-blur px-4 lg:px-8 h-14">
          <button className="lg:hidden p-2 -ml-2 rounded hover:bg-accent" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <span className="lg:hidden text-sm font-bold tracking-tight">SANLAYAN</span>
            <span className="hidden lg:inline text-sm font-semibold text-muted-foreground">Lab Equipment Booking</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-medium truncate max-w-[180px]">{user.fullName}</div>
              <div className="text-[11px] text-muted-foreground capitalize truncate max-w-[180px]">{role} · {user.department ?? "—"}</div>
            </div>
            <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground grid place-items-center text-sm font-semibold shadow-sm">
              {user.fullName.slice(0,1).toUpperCase()}
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8"><Outlet /></main>
      </div>
    </div>
  );
}

export { isAdmin, isPrivileged };
