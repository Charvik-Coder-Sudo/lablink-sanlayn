import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelBooking, listBookings, markReturned } from "@/lib/bookings";
import { useSessionUser } from "@/lib/use-session";
import { isAdmin, isPrivileged } from "@/lib/session";
import { invalidateBookingRelatedQueries } from "@/lib/query-invalidation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useState } from "react";
import { format, parseISO } from "date-fns";

interface BookingsSearch {
  status?: string;
}

export const Route = createFileRoute("/_authenticated/bookings")({
  validateSearch: (search: Record<string, unknown>): BookingsSearch => ({
    status: typeof search.status === "string" ? search.status : undefined,
  }),
  component: BookingsPage,
});

function BookingsPage() {
  const { data: user } = useSessionUser();
  const canManage = user ? isPrivileged(user.roles) : false;
  const isManager = user ? !isAdmin(user.roles) && isPrivileged(user.roles) : false;
  const routeSearch = Route.useSearch();
  const [scope, setScope] = useState<"mine" | "all">(canManage ? "all" : "mine");
  const [status, setStatus] = useState<string>(routeSearch.status ?? "all");
  const [search, setSearch] = useState("");
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["bookings", scope, status, user?.department],
    queryFn: () => listBookings({
      scope,
      status: status === "all" ? undefined : status,
      limit: 200,
      managerDepartment: isManager ? user?.department : undefined,
    }),
  });

  const filtered = (q.data?.rows ?? []).filter((b) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      b.equipment?.name?.toLowerCase().includes(s) ||
      b.equipment?.equipment_code?.toLowerCase().includes(s) ||
      b.profile?.full_name?.toLowerCase().includes(s) ||
      b.id.toLowerCase().includes(s)
    );
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelBooking(id),
    onSuccess: () => { toast.success("Booking cancelled"); invalidateBookingRelatedQueries(qc); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ret = useMutation({
    mutationFn: (id: string) => markReturned(id),
    onSuccess: () => { toast.success("Marked returned"); invalidateBookingRelatedQueries(qc); },
    onError: (e: Error) => toast.error(e.message),
  });

  function canCancel(b: { user_id: string; status: string; booking_date: string; start_time: string; profile?: { department?: string | null } | null }) {
    if (b.status !== "booked") return false;
    if (isAdmin(user?.roles ?? [])) return true;
    if (isManager && b.profile?.department && b.profile.department !== user?.department) return false;
    if (canManage) return true;
    if (b.user_id !== user?.id) return false;
    return new Date(`${b.booking_date}T${b.start_time}`) > new Date();
  }

  // A user can self-service "return" their own booking once it has started — no admin
  // intervention required. Distinct from cancel, which only applies before the start time.
  function canReturnEarly(b: { user_id: string; status: string; booking_date: string; start_time: string }) {
    if (b.status !== "booked") return false;
    if (b.user_id !== user?.id) return false;
    return new Date(`${b.booking_date}T${b.start_time}`) <= new Date();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Bookings</h1>
        <p className="text-sm text-muted-foreground">Manage equipment reservations.</p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-center">
          {canManage && (
            <Tabs value={scope} onValueChange={(v) => setScope(v as "mine" | "all")} className="w-full sm:w-auto">
              <TabsList className="w-full sm:w-auto">
                <TabsTrigger value="all" className="flex-1 sm:flex-none">All bookings</TabsTrigger>
                <TabsTrigger value="mine" className="flex-1 sm:flex-none">My bookings</TabsTrigger>
              </TabsList>
              <TabsContent value="all" /><TabsContent value="mine" />
            </Tabs>
          )}
          <Input placeholder="Search equipment, user, booking id…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-64" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="booked">Booked</SelectItem>
              <SelectItem value="returned">Returned</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card><div className="text-center py-10 text-muted-foreground text-sm">No bookings.</div></Card>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-3">
            {filtered.map((b) => (
              <Card key={b.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{b.equipment?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{b.equipment?.equipment_code}</div>
                    </div>
                    <Badge variant={b.status === "booked" ? "default" : b.status === "cancelled" ? "destructive" : "secondary"} className="capitalize shrink-0">{b.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>{b.profile?.full_name ?? "—"}{b.profile?.department ? ` · ${b.profile.department}` : ""}</div>
                    <div>
                      {format(parseISO(b.booking_date), "d MMM yyyy")}
                      {b.end_date !== b.booking_date && <> – {format(parseISO(b.end_date), "d MMM yyyy")}</>}
                      {" · "}{b.start_time.slice(0,5)}–{b.end_time.slice(0,5)} · Qty {b.quantity}
                    </div>
                  </div>
                  {(canManage || canCancel(b) || canReturnEarly(b)) && (b.status === "booked") && (
                    <div className="flex items-center gap-2 pt-1">
                      {canManage && <Button size="sm" variant="outline" className="flex-1" onClick={() => ret.mutate(b.id)}>Return</Button>}
                      {!canManage && canReturnEarly(b) && <ReturnEarlyButton onConfirm={() => ret.mutate(b.id)} pending={ret.isPending} className="flex-1" />}
                      {canCancel(b) && <Button size="sm" variant="ghost" className="flex-1 text-destructive" onClick={() => cancel.mutate(b.id)}>Cancel</Button>}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tablet/desktop: full table */}
          <Card className="hidden md:block">
            <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Booking</th>
                <th className="text-left px-4 py-3">Equipment</th>
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Date / Time</th>
                <th className="text-right px-4 py-3">Qty</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{b.id.slice(0,8)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{b.equipment?.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{b.equipment?.equipment_code}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{b.profile?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{b.profile?.department ?? ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      {format(parseISO(b.booking_date), "d MMM yyyy")}
                      {b.end_date !== b.booking_date && <> – {format(parseISO(b.end_date), "d MMM yyyy")}</>}
                    </div>
                    <div className="text-xs text-muted-foreground">{b.start_time.slice(0,5)}–{b.end_time.slice(0,5)}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{b.quantity}</td>
                  <td className="px-4 py-3">
                    <Badge variant={b.status === "booked" ? "default" : b.status === "cancelled" ? "destructive" : "secondary"} className="capitalize">{b.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {canManage && b.status === "booked" && (
                      <Button size="sm" variant="outline" onClick={() => ret.mutate(b.id)}>Return</Button>
                    )}
                    {!canManage && canReturnEarly(b) && (
                      <ReturnEarlyButton onConfirm={() => ret.mutate(b.id)} pending={ret.isPending} />
                    )}
                    {canCancel(b) && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel.mutate(b.id)}>Cancel</Button>
                    )}
                  </td>
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

function ReturnEarlyButton({ onConfirm, pending, className }: { onConfirm: () => void; pending: boolean; className?: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className={className} disabled={pending}>Return Early</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Return this booking now?</AlertDialogTitle>
          <AlertDialogDescription>
            This ends your booking before its scheduled time and frees the equipment for others immediately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Return now</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
