import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccessory } from "@/lib/accessories";
import { accessoryDaySchedule, createAccessoryBooking, listAccessoryBookings } from "@/lib/accessory-bookings";
import { supabase } from "@/integrations/supabase/client";
import { fetchAccessoryBookingSlots, computeAccessoryAvailability } from "@/lib/accessory-availability";
import { EquipmentAvailabilityBadge } from "@/components/equipment-availability-badge";
import { BookingTimeline } from "@/components/booking-timeline";
import { useState } from "react";
import { format } from "date-fns";
import { validateBookingDateTimeRange } from "@/lib/booking-validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, CalendarCheck2, ImageOff } from "lucide-react";

export const Route = createFileRoute("/_authenticated/accessories/$id")({
  component: AccessoryDetailPage,
});

const LAB_START = "08:00", LAB_END = "20:00";

function toMinutes(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }

function AccessoryDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [quantity, setQuantity] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const accessory = useQuery({ queryKey: ["accessory", id], queryFn: () => getAccessory(id) });
  const schedule = useQuery({ queryKey: ["accessory-schedule", id, fromDate], queryFn: () => accessoryDaySchedule(id, fromDate) });
  const availability = useQuery({
    queryKey: ["accessory-avail", id, fromDate, toDate, startTime, endTime],
    enabled: !!accessory.data,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("accessory_available_qty", {
        _accessory_id: id, _from_date: fromDate, _to_date: toDate, _start: startTime, _end: endTime,
      });
      if (error) throw error;
      return data as number;
    },
  });

  const currentStatus = useQuery({
    queryKey: ["accessory-booking-slots", [id]],
    enabled: !!accessory.data,
    queryFn: () => fetchAccessoryBookingSlots([id]),
    refetchInterval: 60_000,
  });

  const upcoming = useQuery({
    queryKey: ["accessory-upcoming-reservations", id],
    enabled: !!accessory.data,
    queryFn: () => listAccessoryBookings({ accessoryId: id, status: "booked", from: today, limit: 20 }),
  });

  const book = useMutation({
    mutationFn: (input: {
      accessory_id: string;
      booking_date: string;
      end_date: string;
      start_time: string;
      end_time: string;
      quantity: number;
      project_name: string;
      purpose: string;
    }) => createAccessoryBooking(input),
    onSuccess: () => {
      toast.success("Booking confirmed");
      setProjectName("");
      setPurpose("");
      setValidationError(null);
      qc.invalidateQueries({ queryKey: ["accessory-schedule", id] });
      qc.invalidateQueries({ queryKey: ["accessory-avail", id] });
      qc.invalidateQueries({ queryKey: ["accessory-booking-slots"] });
      qc.invalidateQueries({ queryKey: ["accessory-upcoming-reservations", id] });
    },
    onError: (e: Error) => {
      const map: Record<string, string> = {
        outside_lab_hours: "Bookings must be between 08:00 and 20:00",
        invalid_time_range: "End time must be after start time",
        invalid_date_range: "To Date must be on or after From Date",
        cannot_book_in_past: "Cannot book in the past",
        insufficient_quantity: "Not enough accessories available for that slot",
        accessory_unavailable: "Accessory is not available for booking",
        duplicate_booking: "You already have an overlapping booking for this accessory — edit or cancel it instead",
        not_authenticated: "You must be signed in to book accessories",
        accessory_not_found: "Accessory not found",
        project_name_required: "Project name is required",
        purpose_required: "Purpose is required",
      };
      toast.error(map[e.message] ?? e.message);
    },
  });

  if (accessory.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!accessory.data) return <div className="text-muted-foreground">Accessory not found.</div>;

  const a = accessory.data;
  const nextAvailableSlot = computeNextAvailable(schedule.data ?? [], a.quantity);
  const rangeValidation = validateBookingDateTimeRange({ fromDate, toDate, startTime, endTime });
  const liveAvailability = computeAccessoryAvailability(currentStatus.data?.[id] ?? [], a.quantity);
  const canSubmit = Boolean(projectName.trim()) && Boolean(purpose.trim()) && rangeValidation.isValid && (availability.data ?? 0) >= quantity && a.status === "active";
  const now = new Date();
  const futureReservations = (upcoming.data?.rows ?? []).filter((b) => new Date(`${b.booking_date}T${b.start_time}`) > now);

  function submitBooking() {
    const validationResult = validateBookingDateTimeRange({ fromDate, toDate, startTime, endTime });
    if (!validationResult.isValid) {
      setValidationError(validationResult.error ?? null);
      return;
    }
    if (!projectName.trim()) { setValidationError("Project name is required."); return; }
    if (!purpose.trim()) { setValidationError("Purpose is required."); return; }
    setValidationError(null);
    book.mutate({
      accessory_id: id,
      booking_date: fromDate,
      end_date: toDate,
      start_time: startTime,
      end_time: endTime,
      quantity,
      project_name: projectName,
      purpose,
    });
  }

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <Link to="/accessories" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to accessories</Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg sm:text-xl">{a.description}</CardTitle>
                <div className="text-sm text-muted-foreground mt-0.5">{a.make} {a.model}</div>
              </div>
              <Badge variant={a.status === "active" ? "default" : "secondary"} className="capitalize shrink-0">{a.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="sm:col-span-2">
              {a.photo_url ? (
                <img src={a.photo_url} alt={a.description} className="h-40 w-40 rounded-md object-cover border" />
              ) : (
                <div className="h-40 w-40 rounded-md border bg-muted grid place-items-center text-muted-foreground">
                  <ImageOff className="h-8 w-8" />
                </div>
              )}
            </div>
            <Info label="Make">{a.make ?? "—"}</Info>
            <Info label="Model">{a.model ?? "—"}</Info>
            <Info label="Device Serial No.">{a.serial_number ?? "—"}</Info>
            <Info label="Total Quantity">{a.quantity}</Info>
            <Info label="Booked Quantity">{liveAvailability.totalQty - liveAvailability.availableQty}</Info>
            <Info label="Available Quantity">{liveAvailability.availableQty}</Info>
            {a.remarks && <Info label="Remarks" className="sm:col-span-2">{a.remarks}</Info>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><CalendarCheck2 className="h-4 w-4" /> Book accessory</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>From Date</Label><Input type="date" min={today} value={fromDate} onChange={(ev) => setFromDate(ev.target.value)} /></div>
              <div><Label>To Date</Label><Input type="date" min={fromDate || today} value={toDate} onChange={(ev) => setToDate(ev.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start</Label><Input type="time" min={LAB_START} max={LAB_END} value={startTime} onChange={(ev) => setStartTime(ev.target.value)} /></div>
              <div><Label>End</Label><Input type="time" min={LAB_START} max={LAB_END} value={endTime} onChange={(ev) => setEndTime(ev.target.value)} /></div>
            </div>
            <div><Label>Quantity Required</Label><Input type="number" min={1} max={a.quantity} value={quantity} onChange={(ev) => setQuantity(parseInt(ev.target.value || "1", 10))} /></div>
            <div><Label>Project Name</Label><Input required value={projectName} onChange={(ev) => setProjectName(ev.target.value)} placeholder="e.g. Radar Automation" /></div>
            <div><Label>Purpose</Label><Textarea rows={2} required value={purpose} onChange={(ev) => setPurpose(ev.target.value)} placeholder="e.g. Bench test setup" /></div>
            <div className="rounded-md border border-border/60 bg-muted/30 p-3">
              <div className="font-medium text-sm">{a.description}</div>
              <div className="mt-2">
                <EquipmentAvailabilityBadge
                  availability={a.status !== "active"
                    ? { state: "unavailable", totalQty: a.quantity, availableQty: 0, currentBookings: [], bookedQty: 0, reasonLabel: a.status === "maintenance" ? "Under maintenance" : "Retired" }
                    : liveAvailability}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">Available for selected slot: <span className="font-medium text-foreground">{availability.data ?? "—"}</span></div>
            {!rangeValidation.isValid && <div className="text-xs text-destructive">{rangeValidation.error}</div>}
            {validationError && <div className="text-xs text-destructive">{validationError}</div>}
            {/* Desktop/tablet: inline button. Mobile uses the fixed bottom action bar instead. */}
            <Button className="w-full hidden md:inline-flex" onClick={submitBooking} disabled={book.isPending || !canSubmit}>
              Create booking
            </Button>
            <div className="text-[11px] text-muted-foreground">Lab hours: 08:00 – 20:00</div>
          </CardContent>
        </Card>
      </div>

      {/* Mobile: sticky bottom action bar, thumb-reachable, sits above the bottom nav */}
      <div
        className="md:hidden fixed inset-x-0 bottom-14 z-30 border-t bg-card p-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {!rangeValidation.isValid && <div className="text-xs text-destructive mb-1.5">{rangeValidation.error}</div>}
        {validationError && <div className="text-xs text-destructive mb-1.5">{validationError}</div>}
        <Button className="w-full" size="lg" onClick={submitBooking} disabled={book.isPending || !canSubmit}>
          Create booking {availability.data !== undefined && `· ${availability.data} available`}
        </Button>
      </div>

      {liveAvailability.currentBookings.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Current Borrowers</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {liveAvailability.currentBookings.map((b) => (
              <div key={b.bookingId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <div>
                  <div className="font-medium">{b.name}{b.department ? ` · ${b.department}` : ""}</div>
                  <div className="text-xs text-muted-foreground">Project: {b.projectName} · Qty {b.quantity}</div>
                </div>
                <div className="text-xs text-muted-foreground">Returns: <span className="font-medium text-foreground">{b.returnsAtLabel}</span></div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {futureReservations.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Upcoming Reservations</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {futureReservations.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <div>
                  <div className="font-medium">{b.profile?.full_name ?? "—"}{b.profile?.department ? ` · ${b.profile.department}` : ""}</div>
                  <div className="text-xs text-muted-foreground">Project: {b.project_name} · Qty {b.quantity}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(b.booking_date), "d MMM")} {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Booking Timeline — {format(new Date(fromDate), "EEEE, d MMM yyyy")}</CardTitle>
            <div className="text-xs text-muted-foreground">Next available: <span className="font-medium text-foreground">{nextAvailableSlot}</span></div>
          </div>
        </CardHeader>
        <CardContent>
          <BookingTimeline slots={schedule.data ?? []} labStart={LAB_START} labEnd={LAB_END} />
          {(schedule.data ?? []).length === 0
            ? <div className="text-sm text-muted-foreground mt-3">No bookings for this day — full capacity available.</div>
            : <div className="overflow-x-auto mt-4">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                    <tr><th className="py-2 pr-4">Time</th><th className="py-2 pr-4">Booked by</th><th className="py-2 pr-4">Project</th><th className="py-2 pr-4">Purpose</th><th className="py-2 pr-4 text-right">Qty</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {schedule.data!.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}
                          {s.end_date !== s.booking_date && <span className="text-muted-foreground"> (multi-day, through {format(new Date(s.end_date), "d MMM")})</span>}
                        </td>
                        <td className="py-2 pr-4">{s.profile?.full_name ?? "—"}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{s.project_name}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{s.purpose}</td>
                        <td className="py-2 pr-4 text-right">{s.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5">{children}</div></div>;
}

function computeNextAvailable(schedule: { start_time: string; end_time: string; quantity: number }[], _total: number): string {
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();
  const dayStart = Math.max(currentMin, toMinutes(LAB_START));
  const sorted = [...schedule].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  let cursor = dayStart;
  for (const s of sorted) {
    if (toMinutes(s.start_time) > cursor) {
      const h = Math.floor(cursor / 60), m = cursor % 60;
      return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    }
    cursor = Math.max(cursor, toMinutes(s.end_time));
  }
  if (cursor >= toMinutes(LAB_END)) return "Tomorrow 08:00";
  const h = Math.floor(cursor / 60), m = cursor % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
