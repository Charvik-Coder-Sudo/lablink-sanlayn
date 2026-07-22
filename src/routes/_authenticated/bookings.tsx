import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelBooking, listBookings, markReturned, adminUpdateBooking } from "@/lib/bookings";
import { useSessionUser } from "@/lib/use-session";
import { isAdmin, isPrivileged } from "@/lib/session";
import { invalidateBookingRelatedQueries } from "@/lib/query-invalidation";
import { computeBookingDisplayStatus, BOOKING_DISPLAY_STATUS_CONFIG } from "@/lib/booking-status";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";

interface BookingsSearch {
  status?: string;
}

type BookingRow = Awaited<ReturnType<typeof listBookings>>["rows"][number];

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
      b.project_name?.toLowerCase().includes(s) ||
      b.id.toLowerCase().includes(s)
    );
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => cancelBooking(id, reason),
    onSuccess: () => { toast.success("Booking cancelled"); invalidateBookingRelatedQueries(qc); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ret = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => markReturned(id, reason),
    onSuccess: () => { toast.success("Marked returned"); invalidateBookingRelatedQueries(qc); },
    onError: (e: Error) => toast.error(e.message),
  });

  function canCancel(b: BookingRow) {
    if (b.status !== "booked") return false;
    if (isAdmin(user?.roles ?? [])) return true;
    if (isManager && b.profile?.department && b.profile.department !== user?.department) return false;
    if (canManage) return true;
    if (b.user_id !== user?.id) return false;
    return new Date(`${b.booking_date}T${b.start_time}`) > new Date();
  }

  // A user can self-service "return" their own booking once it has started — no admin
  // intervention required. Admins/managers can force-return anyone's booking anytime.
  function canReturn(b: BookingRow) {
    if (b.status !== "booked") return false;
    if (canManage) return true;
    if (b.user_id !== user?.id) return false;
    return new Date(`${b.booking_date}T${b.start_time}`) <= new Date();
  }

  function exportBookings() {
    const ws = XLSX.utils.json_to_sheet(filtered.map((b) => ({
      "Booking ID": b.id,
      Equipment: b.equipment?.name ?? "",
      "Asset ID": b.equipment?.equipment_code ?? "",
      User: b.profile?.full_name ?? "",
      Department: b.profile?.department ?? "",
      "Project Name": b.project_name,
      Purpose: b.purpose,
      "From Date": b.booking_date,
      "To Date": b.end_date,
      "Start Time": b.start_time,
      "End Time": b.end_time,
      Quantity: b.quantity,
      Status: computeBookingDisplayStatus(b),
      "Created At": b.created_at,
      "Returned At": b.returned_at ?? "",
      "Cancelled At": b.cancelled_at ?? "",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bookings");
    XLSX.writeFile(wb, `bookings_export_${Date.now()}.xlsx`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Bookings</h1>
          <p className="text-sm text-muted-foreground">Manage equipment reservations.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportBookings} disabled={filtered.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Export
        </Button>
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
          <Input placeholder="Search equipment, user, project, booking id…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-64" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="booked">Booked / In Use / Overdue</SelectItem>
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
                    <DisplayStatusBadge booking={b} />
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>{b.profile?.full_name ?? "—"}{b.profile?.department ? ` · ${b.profile.department}` : ""}</div>
                    <div>Project: {b.project_name}</div>
                    <div>
                      {format(parseISO(b.booking_date), "d MMM yyyy")}
                      {b.end_date !== b.booking_date && <> – {format(parseISO(b.end_date), "d MMM yyyy")}</>}
                      {" · "}{b.start_time.slice(0,5)}–{b.end_time.slice(0,5)} · Qty {b.quantity}
                    </div>
                  </div>
                  {(canManage || canCancel(b) || canReturn(b)) && (b.status === "booked") && (
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      {canReturn(b) && <ReturnButton onConfirm={(reason) => ret.mutate({ id: b.id, reason })} pending={ret.isPending} className="flex-1" label={canManage && b.user_id !== user?.id ? "Force Return" : "Return"} />}
                      {canCancel(b) && <CancelButton onConfirm={(reason) => cancel.mutate({ id: b.id, reason })} pending={cancel.isPending} className="flex-1" />}
                      {canManage && <EditBookingDialog booking={b} onDone={() => invalidateBookingRelatedQueries(qc)} />}
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
                <th className="text-left px-4 py-3">Project</th>
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
                  <td className="px-4 py-3 max-w-[160px] truncate" title={b.project_name}>{b.project_name}</td>
                  <td className="px-4 py-3">
                    <div>
                      {format(parseISO(b.booking_date), "d MMM yyyy")}
                      {b.end_date !== b.booking_date && <> – {format(parseISO(b.end_date), "d MMM yyyy")}</>}
                    </div>
                    <div className="text-xs text-muted-foreground">{b.start_time.slice(0,5)}–{b.end_time.slice(0,5)}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{b.quantity}</td>
                  <td className="px-4 py-3"><DisplayStatusBadge booking={b} /></td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {b.status === "booked" && canReturn(b) && (
                      <ReturnButton onConfirm={(reason) => ret.mutate({ id: b.id, reason })} pending={ret.isPending} label={canManage && b.user_id !== user?.id ? "Force Return" : "Return"} />
                    )}
                    {b.status === "booked" && canCancel(b) && (
                      <CancelButton onConfirm={(reason) => cancel.mutate({ id: b.id, reason })} pending={cancel.isPending} />
                    )}
                    {b.status === "booked" && canManage && (
                      <EditBookingDialog booking={b} onDone={() => invalidateBookingRelatedQueries(qc)} />
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

function DisplayStatusBadge({ booking }: { booking: { status: string; booking_date: string; end_date: string; start_time: string; end_time: string } }) {
  const display = computeBookingDisplayStatus(booking);
  const cfg = BOOKING_DISPLAY_STATUS_CONFIG[display];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap ${cfg.className}`}>{cfg.label}</span>;
}

function ReturnButton({ onConfirm, pending, className, label = "Return" }: { onConfirm: (reason?: string) => void; pending: boolean; className?: string; label?: string }) {
  const [reason, setReason] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className={className} disabled={pending}>{label}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Return this booking now?</AlertDialogTitle>
          <AlertDialogDescription>
            This ends the booking before its scheduled end and frees the equipment immediately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label>Reason (optional)</Label>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Finished early" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(reason || undefined)}>Return now</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CancelButton({ onConfirm, pending, className }: { onConfirm: (reason?: string) => void; pending: boolean; className?: string }) {
  const [reason, setReason] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className={`text-destructive ${className ?? ""}`} disabled={pending}>Cancel</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label>Reason (optional)</Label>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No longer needed" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep booking</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(reason || undefined)}>Cancel booking</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditBookingDialog({ booking, onDone }: { booking: BookingRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(booking.quantity);
  const [bookingDate, setBookingDate] = useState(booking.booking_date);
  const [endDate, setEndDate] = useState(booking.end_date);
  const [startTime, setStartTime] = useState(booking.start_time.slice(0, 5));
  const [endTime, setEndTime] = useState(booking.end_time.slice(0, 5));
  const [projectName, setProjectName] = useState(booking.project_name);
  const [purpose, setPurpose] = useState(booking.purpose);
  const [override, setOverride] = useState(false);

  const mut = useMutation({
    mutationFn: () => adminUpdateBooking({
      bookingId: booking.id,
      quantity,
      booking_date: bookingDate,
      end_date: endDate,
      start_time: startTime,
      end_time: endTime,
      project_name: projectName,
      purpose,
      override,
    }),
    onSuccess: () => { toast.success("Booking updated"); setOpen(false); onDone(); },
    onError: (e: Error) => {
      const map: Record<string, string> = {
        insufficient_quantity: "Not enough equipment available for that slot — enable Override to force it through",
        invalid_time_range: "End time must be after start time",
        invalid_date_range: "To Date must be on or after From Date",
        outside_lab_hours: "Bookings must be between 08:00 and 20:00",
        project_name_required: "Project name is required",
        purpose_required: "Purpose is required",
        not_authorized: "You don't have permission to edit this booking",
        equipment_unavailable: "Equipment is not active — enable Override to force it through",
      };
      toast.error(map[e.message] ?? e.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Edit</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit booking</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>From Date</Label><Input type="date" required value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>To Date</Label><Input type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Start</Label><Input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>End</Label><Input type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" min={1} required value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value || "1", 10))} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Project Name</Label><Input required value={projectName} onChange={(e) => setProjectName(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Purpose</Label><Textarea rows={2} required value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox id="override" checked={override} onCheckedChange={(v) => setOverride(v === true)} />
            <Label htmlFor="override" className="text-sm font-normal">Override conflicts (skip quantity/availability check)</Label>
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={mut.isPending}>Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
