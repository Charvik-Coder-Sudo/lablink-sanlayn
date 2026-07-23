import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSessionUser } from "@/lib/use-session";
import { highestRole, isAdmin, isPrivileged, type AppRole } from "@/lib/session";
import { useQueryClient } from "@tanstack/react-query";
import { BrandMark } from "@/components/brand-mark";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard, Boxes, Wrench, CalendarCheck2, BarChart3, Users, UploadCloud,
  ClipboardList, User, LogOut, MoreHorizontal, History,
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
  { to: "/accessories", label: "Accessories", icon: Wrench },
  { to: "/bookings", label: "Bookings", icon: CalendarCheck2 },
  { to: "/reports", label: "Reports", icon: BarChart3, roles: ["admin", "manager"] },
  { to: "/admin/usage", label: "Usage History", icon: History, roles: ["admin", "manager"] },
  { to: "/admin/users", label: "Users", icon: Users, roles: ["admin"] },
  { to: "/admin/import", label: "Import Users", icon: UploadCloud, roles: ["admin"] },
  { to: "/admin/audit", label: "Audit Log", icon: ClipboardList, roles: ["admin"] },
  { to: "/profile", label: "My Profile", icon: User },
];

const PRIMARY_MOBILE_PATHS = ["/dashboard", "/equipment", "/accessories", "/bookings"];

function AuthenticatedLayout() {
  const { data: user, isLoading } = useSessionUser();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [moreOpen, setMoreOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <BrandMark size={32} />
        <span>Loading…</span>
      </div>
    );
  }
  if (!user) return null;

  const role = highestRole(user.roles);
  const items = NAV.filter((i) => !i.roles || i.roles.some((r) => user.roles.includes(r)));
  const primaryMobileItems = items.filter((i) => PRIMARY_MOBILE_PATHS.includes(i.to));

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar: persistent from tablet size up. Sticky + viewport-height so the footer
          never gets pushed below the fold by tall page content. */}
      <aside className="hidden md:flex md:flex-col md:w-56 lg:w-64 md:shrink-0 md:sticky md:top-0 md:h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="px-5 py-5 border-b border-sidebar-border shrink-0">
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
              className="group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{ className: "!bg-accent !text-primary font-semibold hover:!bg-accent hover:!text-primary before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-6 before:w-[3px] before:rounded-r-full before:bg-primary" }}
            >
              <item.icon className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" />
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4 shrink-0">
          <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/50">Signed in as</div>
          <div className="mt-1 text-sm font-medium truncate">{user.fullName}</div>
          <div className="text-[11px] text-sidebar-foreground/50 capitalize">{role}</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card/95 backdrop-blur px-4 md:px-8 h-14">
          <div className="min-w-0 flex items-center gap-2">
            <span className="md:hidden inline-flex items-center gap-2 text-sm font-bold tracking-tight"><BrandMark size={20} /> SANLAYAN</span>
            <span className="hidden md:inline text-sm font-semibold text-muted-foreground">Lab Equipment Booking</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="flex items-center gap-3 rounded-md p-1 -m-1 hover:bg-accent transition-colors" aria-label="Account menu">
                <div className="hidden sm:block text-right">
                  <div className="text-xs font-medium truncate max-w-[180px]">{user.fullName}</div>
                  <div className="text-[11px] text-muted-foreground capitalize truncate max-w-[180px]">{role} · {user.department ?? "—"}</div>
                </div>
                <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground grid place-items-center text-sm font-semibold shadow-sm shrink-0">
                  {user.fullName.slice(0,1).toUpperCase()}
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-medium truncate">{user.fullName}</div>
                <div className="text-xs font-normal text-muted-foreground capitalize truncate">{role} · {user.department ?? "—"}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/profile" className="flex items-center gap-2 cursor-pointer">
                  <User className="h-4 w-4" /> My Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive cursor-pointer">
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8"><Outlet /></main>
      </div>

      {/* Bottom navigation: phones/small tablets only */}
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t bg-card shadow-[0_-1px_8px_rgba(0,0,0,0.06)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primaryMobileItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] text-[10px] font-medium text-muted-foreground active:bg-accent"
            activeProps={{ className: "text-primary" }}
          >
            <item.icon className="h-5 w-5" />
            <span className="truncate max-w-full px-1">{item.label}</span>
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[56px] text-[10px] font-medium text-muted-foreground active:bg-accent",
            moreOpen && "text-primary",
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="md:hidden rounded-t-xl max-h-[85vh] overflow-y-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <SheetHeader><SheetTitle>Menu</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-1">
            {items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium text-foreground hover:bg-accent"
                activeProps={{ className: "bg-accent text-primary" }}
              >
                <item.icon className="h-5 w-5 shrink-0" /> {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => { setMoreOpen(false); signOut(); }}
              className="w-full flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-5 w-5 shrink-0" /> Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export { isAdmin, isPrivileged };
