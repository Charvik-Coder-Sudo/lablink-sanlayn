import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAccessory } from "@/lib/accessories";
import { createAccessoryBooking } from "@/lib/accessory-bookings";
import { fetchAccessoryBookingSlots, computeAccessoryAvailability } from "@/lib/accessory-availability";
import { computeSlotAvailability, type EquipmentAvailability } from "@/lib/equipment-availability";
import { invalidateBookingRelatedQueries } from "@/lib/query-invalidation";
import { SmartAvailabilityBadge } from "@/components/smart-availability-badge";
import { BookingCalendar } from "@/components/booking-calendar";
import { useState } from "react";
import { format, startOfMonth, endOfMonth, addDays } from "date-fns";
import { validateBookingDateTimeRange } from "@/lib/booking-validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { ArrowLeft, CalendarCheck2, ImageOff } from "lucide-react";

export const Route = createFileRoute("/_authenticated/accessories/$id")({
  component: AccessoryDetailPage,
});

const LAB_START = "08:00", LAB_END = "20:00";

function AccessoryDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()));
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [quantity, setQuantity] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const accessory = useQuery({ queryKey: ["accessory", id], queryFn: () => getAccessory(id) });

  const winFrom = [format(startOfMonth(calMonth), "yyyy-MM-dd"), today, fromDate].sort()[0];
  const winTo = [format(endOfMonth(calMonth), "yyyy-MM-dd"), toDate, format(addDays(new Date(), 1), "yyyy-MM-dd")].sort().at(-1)!;
  const windowSlots = useQuery({
    queryKey: ["accessory-booking-slots", "window", id, winFrom, winTo],
    enabled: !!accessory.data,
    queryFn: () => fetchAccessoryBookingSlots([id], { from: winFrom, to: winTo }),
    refetchInterval: 60_000,
  });

  const book = useMutation({
    mutationFn: (input: {
      accessory_id: string; booking_date: string; end_date: string; start_time: string;
      end_time: string; quantity: number; project_name: string; purpose: string;
    }) => createAccessoryBooking(input),
    onSuccess: () => {
      toast.success("Booking confirmed");
      setProjectName(""); setPurpose(""); setValidationError(null);
      invalidateBookingRelatedQueries(qc);
    },
    onError: (er: Error) => {
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
      toast.error(map[er.message] ?? er.message);
    },
  });

  if (accessory.isLoading) return <div className="text-muted-foreground">Loading…</div>;
  if (!accessory.data) return <div className="text-muted-foreground">Accessory not found.</div>;

  const a = accessory.data;
  const now = new Date();
  const slots = windowSlots.data?.[id] ?? [];
  const isUnavailable = a.status !== "active";
  const rangeValidation = validateBookingDateTimeRange({ fromDate, toDate, startTime, endTime });

  const nowAvailability = computeAccessoryAvailability(slots, a.quantity, now);
  const slotAvailability: EquipmentAvailability = isUnavailable
    ? { state: "unavailable", totalQty: a.quantity, availableQty: 0, bookedQty: a.quantity, currentBookings: [] }
    : computeSlotAvailability(slots, a.quantity, fromDate, toDate, startTime, endTime, now);

  const availableForSlot = slotAvailability.availableQty;
  const fullyBooked = !isUnavailable && availableForSlot <= 0;
  const canSubmit = Boolean(projectName.trim()) && Boolean(purpose.trim()) && rangeValidation.isValid && availableForSlot >= quantity && !isUnavailable;

  function selectDate(dateStr: string) {
    setFromDate(dateStr);
    setToDate((prev) => (prev < dateStr ? dateStr : prev));
  }

  function submitBooking() {
    const v = validateBookingDateTimeRange({ fromDate, toDate, startTime, endTime });
    if (!v.isValid) { setValidationError(v.error ?? null); return; }
    if (!projectName.trim()) { setValidationError("Project name is required."); return; }
    if (!purpose.trim()) { setValidationError("Purpose is required."); return; }
    setValidationError(null);
    book.mutate({ accessory_id: id, booking_date: fromDate, end_date: toDate, start_time: startTime, end_time: endTime, quantity, project_name: projectName, purpose });
  }

  const disabledReason = isUnavailable
    ? (a.status === "maintenance" ? "This accessory is under maintenance." : "This accessory is retired.")
    : fullyBooked
      ? `Fully booked for the selected slot.${slotAvailability.nextAvailableLabel ? ` Available after ${slotAvailability.nextAvailableLabel}.` : ""}`
      : availableForSlot < quantity
        ? `Only ${availableForSlot} unit${availableForSlot === 1 ? "" : "s"} available for the selected slot.`
        : null;

  return (
    <div className="space-y-5 pb-24 md:pb-0">
      <Link to="/accessories" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to accessories</Link>

      {/* 1. Name */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {a.photo_url ? (
            <img src={a.photo_url} alt={a.description} className="h-14 w-14 rounded-md object-cover border shrink-0" />
          ) : (
            <div className="h-14 w-14 rounded-md border bg-muted grid place-items-center text-muted-foreground shrink-0"><ImageOff className="h-5 w-5" /></div>
          )}
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold">{a.description}</h1>
            <div className="text-sm text-muted-foreground mt-0.5">{a.make} {a.model}</div>
          </div>
        </div>
        <Badge variant={a.status === "active" ? "default" : "secondary"} className="capitalize shrink-0">{a.status}</Badge>
      </div>

      {/* 2. Availability badge */}
      <SmartAvailabilityBadge availability={nowAvailability} status={a.status} itemLabel="accessory" />

      {/* 3 + 4. Calendar with daily schedule */}
      <BookingCalendar
        slots={slots}
        totalQuantity={a.quantity}
        maintenance={isUnavailable}
        month={calMonth}
        onMonthChange={setCalMonth}
        selectedDate={fromDate}
        onSelectDate={selectDate}
        labStart={LAB_START}
        labEnd={LAB_END}
      />

      {/* 5. Current active bookings */}
      {nowAvailability.currentBookings.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Current Users {nowAvailability.currentBookings.length > 1 ? `(${nowAvailability.currentBookings.length})` : ""}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {nowAvailability.currentBookings.map((b) => (
              <div key={b.bookingId} className="rounded-md border p-3 text-sm space-y-0.5">
                <div className="font-medium">{b.name}{b.department ? <span className="text-muted-foreground font-normal"> · {b.department}</span> : null}</div>
                <div className="text-xs"><span className="text-muted-foreground">Project:</span> {b.projectName} · <span className="text-muted-foreground">Qty</span> {b.quantity}</div>
                <div className="text-xs text-muted-foreground">{b.fromLabel} → {b.returnsAtLabel}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 6. Accessory information */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Accessory Information</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <Info label="Make">{a.make ?? "—"}</Info>
          <Info label="Model">{a.model ?? "—"}</Info>
          <Info label="Device Serial No.">{a.serial_number ?? "—"}</Info>
          <Info label="Total Quantity">{a.quantity}</Info>
          {a.remarks && <Info label="Remarks" className="sm:col-span-2">{a.remarks}</Info>}
        </CardContent>
      </Card>

      {/* 7. Booking form */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold flex items-center gap-2"><CalendarCheck2 className="h-4 w-4" /> Book accessory</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>From Date</Label><Input type="date" min={today} value={fromDate} onChange={(ev) => selectDate(ev.target.value)} /></div>
            <div><Label>To Date</Label><Input type="date" min={fromDate || today} value={toDate} onChange={(ev) => setToDate(ev.target.value)} /></div>
            <div><Label>Start</Label><Input type="time" min={LAB_START} max={LAB_END} value={startTime} onChange={(ev) => setStartTime(ev.target.value)} /></div>
            <div><Label>End</Label><Input type="time" min={LAB_START} max={LAB_END} value={endTime} onChange={(ev) => setEndTime(ev.target.value)} /></div>
            <div><Label>Quantity Required</Label><Input type="number" min={1} max={a.quantity} value={quantity} onChange={(ev) => setQuantity(parseInt(ev.target.value || "1", 10))} /></div>
            <div className="flex items-end text-xs text-muted-foreground pb-2">Selected slot: <span className="font-medium text-foreground ml-1">{availableForSlot} / {a.quantity} available</span></div>
            <div className="sm:col-span-2"><Label>Project Name</Label><Input required value={projectName} onChange={(ev) => setProjectName(ev.target.value)} placeholder="e.g. Radar Automation" /></div>
            <div className="sm:col-span-2"><Label>Purpose</Label><Textarea rows={2} required value={purpose} onChange={(ev) => setPurpose(ev.target.value)} placeholder="e.g. Bench test setup" /></div>
          </div>
          {!rangeValidation.isValid && <div className="text-xs text-destructive">{rangeValidation.error}</div>}
          {validationError && <div className="text-xs text-destructive">{validationError}</div>}
          <div className="hidden md:block">
            <BookAction label={isUnavailable ? "Unavailable" : fullyBooked ? "Fully Booked" : "Book Accessory"} disabledReason={disabledReason} canSubmit={canSubmit} pending={book.isPending} onSubmit={submitBooking} />
          </div>
          <div className="text-[11px] text-muted-foreground">Lab hours: 08:00 – 20:00</div>
        </CardContent>
      </Card>

      {/* Mobile: sticky bottom action bar */}
      <div className="md:hidden fixed inset-x-0 bottom-14 z-30 border-t bg-card p-3" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        {!rangeValidation.isValid && <div className="text-xs text-destructive mb-1.5">{rangeValidation.error}</div>}
        {validationError && <div className="text-xs text-destructive mb-1.5">{validationError}</div>}
        <BookAction size="lg" label={isUnavailable ? "Unavailable" : fullyBooked ? "Fully Booked" : `Book Accessory · ${availableForSlot} available`} disabledReason={disabledReason} canSubmit={canSubmit} pending={book.isPending} onSubmit={submitBooking} />
      </div>
    </div>
  );
}

function BookAction({ label, disabledReason, canSubmit, pending, onSubmit, size }: { label: string; disabledReason: string | null; canSubmit: boolean; pending: boolean; onSubmit: () => void; size?: "lg" }) {
  const disabled = pending || !canSubmit;
  if (disabled && disabledReason) {
    return (
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block w-full" tabIndex={0}>
              <Button className="w-full pointer-events-none" size={size} variant="outline" disabled>{label}</Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return <Button className="w-full" size={size} onClick={onSubmit} disabled={disabled}>{label}</Button>;
}

function Info({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-0.5">{children}</div></div>;
}
